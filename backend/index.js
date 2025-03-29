// backend/index.js
require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

// Use the port from .env or default to 5001
const PORT = process.env.PORT || 5001;

// Initialize and connect to SQLite database
const db = new sqlite3.Database('./expiry.db', (err) => {
  if (err) {
    console.error("Error opening database", err);
  } else {
    console.log("Connected to SQLite database.");
    // Create table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      expiry_info TEXT
    )`);
    // (Optional) Create a table for caching image URLs if desired
  }
});

// Function to retrieve expiry info from the database
function getExpiryFromDB(productName) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT expiry_info FROM products WHERE name = ?`, [productName], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row ? row.expiry_info : null);
      }
    });
  });
}

// Function to insert new expiry info into the database
function insertExpiryIntoDB(productName, expiryInfo) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (name, expiry_info) VALUES (?, ?)`, [productName, expiryInfo], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}

// Function to call the LLM (using OpenAI API) for expiry information
async function getExpiryFromLLM(productName) {
  const prompt = `Provide the estimated expiry period (in days) for the grocery product "${productName}". Only provide the number of days.`;

  try {
    const response = await axios.post('https://api.openai.com/v1/completions', {
      model: "gpt-3.5-turbo-instruct",
      prompt: prompt,
      max_tokens: 10,
      temperature: 0.5,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });
    const expiryInfo = response.data.choices[0].text.trim();
    return expiryInfo;
  } catch (error) {
    console.error("Error calling LLM API:", error);
    throw error;
  }
}

// Function to scrape an image URL from Adobe Stock using Puppeteer
async function getFoodImage(foodName) {
  // Construct the Adobe Stock search URL with "cartoon" appended for style.
  const searchUrl = `https://stock.adobe.com/search?k=${encodeURIComponent(foodName + " cartoon")}`;

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    // Go to the Adobe Stock search page and wait until network is idle
    await page.goto(searchUrl, { waitUntil: 'networkidle2' });
    // Wait for image elements to load
    await page.waitForSelector('img');

    // Evaluate the page to collect image URLs and filter out likely logos
    const imageUrl = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const validImages = images.filter(img => {
        const src = img.src.toLowerCase();
        // Adjust this condition based on Adobe Stock's structure.
        return src && src.includes('ftcdn.net') && !src.includes('logo') && !src.includes('funny') && !src.includes('character');
      });
      return validImages.length > 0 ? validImages[1].src : null;
    });

    await browser.close();
    return imageUrl;
  } catch (error) {
    console.error("Error scraping image:", error);
    return null;
  }
}

// API endpoint: Fetch the image first and then try getting expiry details.
// If expiry lookup fails, it doesn't block returning the image.
app.post('/api/get-expiry', async (req, res) => {
  const { productName } = req.body;
  if (!productName) {
    return res.status(400).json({ error: "Product name is required" });
  }

  try {
    // Start by fetching the image URL regardless of expiry info.
    const imagePromise = getFoodImage(productName);

    // Retrieve expiry info from DB, or if not present, call the LLM.
    let expiryInfo;
    let source;
    try {
      expiryInfo = await getExpiryFromDB(productName);
      source = "database";
      if (!expiryInfo) {
        expiryInfo = await getExpiryFromLLM(productName);
        source = "LLM";
        await insertExpiryIntoDB(productName, expiryInfo);
      }
    } catch (err) {
      console.error("Error retrieving expiry details:", err);
      expiryInfo = "Unavailable";
      source = "error";
    }

    // Wait for the image URL retrieval to complete.
    const imageUrl = await imagePromise;

    // Return response: even if expiryInfo is unavailable, imageUrl is provided.
    res.json({ productName, imageUrl, expiryInfo, source });
  } catch (error) {
    console.error("Error in /api/get-expiry:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
