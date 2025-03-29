// backend/index.js
require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const app = express();
app.use(express.json());

// Use the port from .env or default to 5001
const PORT = 5001;

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
  

// API endpoint: Checks DB first; if not found, calls the LLM.
app.post('/api/get-expiry', async (req, res) => {
  const { productName } = req.body;
  if (!productName) {
    return res.status(400).json({ error: "Product name is required" });
  }

  try {
    // Check for expiry info in the database
    let expiryInfo = await getExpiryFromDB(productName);
    if (expiryInfo) {
      return res.json({ productName, expiryInfo, source: "database" });
    }

    // Call the LLM to get expiry info if not found in DB
    expiryInfo = await getExpiryFromLLM(productName);

    // Store the new info in the database
    await insertExpiryIntoDB(productName, expiryInfo);

    res.json({ productName, expiryInfo, source: "LLM" });
  } catch (error) {
    console.error("Error in /api/get-expiry:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
