// backend/index.js
require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const webpush = require('web-push');

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
    // Create table if it doesn't exist (including expiry_date)
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      expiry_info TEXT,
      expiry_date TEXT
    )`, (err) => {
      if (err) {
        console.error("Error creating table:", err);
      } else {
        console.log("Products table is ready.");
      }
    });
    // Attempt to add expiry_date column if it doesn't exist (ignore error if already present)
    db.run("ALTER TABLE products ADD COLUMN expiry_date TEXT", (err) => {
      if (err) {
        console.warn("expiry_date column may already exist:", err.message);
      } else {
        console.log("expiry_date column added successfully.");
      }
    });
  }
});

// Helper function to parse a duration from expiry_info (e.g., "7", "14 days")
function parseExpiry(expiryStr) {
  const match = expiryStr.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

// Function to retrieve expiry info and expiry_date from the database
function getExpiryFromDB(productName) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT expiry_info, expiry_date FROM products WHERE name = ?`, [productName], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row ? row : null);
      }
    });
  });
}

// Function to insert new expiry info and expiry_date into the database
function insertExpiryIntoDB(productName, expiryInfo, expiryDate) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO products (name, expiry_info, expiry_date) VALUES (?, ?, ?)`, [productName, expiryInfo, expiryDate], function(err) {
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
    // Parse the number of days from the expiryInfo
    const days = parseExpiry(expiryInfo);
    // Compute the expiry date based on today
    const expiryDateObj = new Date();
    expiryDateObj.setDate(expiryDateObj.getDate() + days);
    const expiryDate = expiryDateObj.toISOString().split('T')[0]; // Format YYYY-MM-DD
    return { expiryInfo, expiryDate };
  } catch (error) {
    console.error("Error calling LLM API:", error);
    throw error;
  }
}

// Function to scrape an image URL from Adobe Stock using Puppeteer
async function getFoodImage(foodName) {
  const searchUrl = `https://stock.adobe.com/search?k=${encodeURIComponent(foodName + " cartoon")}`;
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(searchUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('img');

    // Gather image URLs and filter out unwanted ones
    const imageUrl = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const validImages = images.filter(img => {
        const src = img.src.toLowerCase();
        return src && src.includes('ftcdn.net') &&
          !src.includes('logo') &&
          !src.includes('funny') &&
          !src.includes('character');
      });
      // If more than one valid image, return the second one to avoid the possibility of a logo being first.
      if (validImages.length >= 2) {
        return validImages[1].src;
      } else if (validImages.length === 1) {
        return validImages[0].src;
      }
      return null;
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
    // Fetch image URL concurrently.
    const imagePromise = getFoodImage(productName);

    // Retrieve expiry info from DB or via the LLM.
    let expiryData = await getExpiryFromDB(productName);
    let source = "database";
    if (!expiryData) {
      expiryData = await getExpiryFromLLM(productName);
      source = "LLM";
      await insertExpiryIntoDB(productName, expiryData.expiryInfo, expiryData.expiryDate);
    }

    // Wait for the image URL.
    const imageUrl = await imagePromise;

    res.json({
      productName,
      expiryInfo: expiryData.expiry_info || expiryData.expiryInfo,
      expiryDate: expiryData.expiry_date || expiryData.expiryDate,
      imageUrl,
      source
    });
  } catch (error) {
    console.error("Error in /api/get-expiry:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// --- Notification Setup ---

// Configure Nodemailer (example uses Gmail)
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,    // Your email address
    pass: process.env.EMAIL_PASS     // Your email password or app-specific password
  }
});

// Configure web-push with your VAPID keys
webpush.setVapidDetails(
  'mailto:your-email@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Hard-coded subscribers for demonstration
const emailSubscribers = ['user1@example.com', 'user2@example.com'];
const pushSubscriptions = [
  // Example push subscription objects
  // {
  //   endpoint: 'https://fcm.googleapis.com/fcm/send/...',
  //   keys: { p256dh: '...', auth: '...' }
  // }
];

// Helper to get tomorrow's date as YYYY-MM-DD
function getTomorrowDateString() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

// Schedule a daily job at 8:00 AM to send notifications for products expiring tomorrow
cron.schedule('0 8 * * *', () => {
  console.log('Running daily expiry notification job...');
  const tomorrowDate = getTomorrowDateString();

  // Query for products where expiry_date equals tomorrow's date
  db.all(`SELECT * FROM products WHERE expiry_date = ?`, [tomorrowDate], async (err, rows) => {
    if (err) {
      console.error("Error querying products:", err);
      return;
    }

    if (!rows || rows.length === 0) {
      console.log("No products expiring tomorrow.");
      return;
    }

    for (const product of rows) {
      const subject = `Expiry Alert: ${product.name} expires tomorrow!`;
      const text = `Your product "${product.name}" is set to expire on ${product.expiry_date}. Please use it soon!`;

      // Send email notifications
      for (const email of emailSubscribers) {
        try {
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: subject,
            text: text
          });
          console.log(`Email sent to ${email} for product ${product.name}`);
        } catch (emailError) {
          console.error(`Error sending email to ${email}:`, emailError);
        }
      }

      // Prepare push notification payload
      const payload = JSON.stringify({
        title: 'Expiry Alert',
        body: `${product.name} expires tomorrow!`
      });

      // Send push notifications
      for (const subscription of pushSubscriptions) {
        try {
          await webpush.sendNotification(subscription, payload);
          console.log(`Push notification sent for product ${product.name}`);
        } catch (pushError) {
          console.error("Error sending push notification:", pushError);
        }
      }
    }
  });
});

console.log("Notification scheduler is set up.");

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Temporary route to test email notifications
// app.get('/test-email', async (req, res) => {
//     try {
//       await transporter.sendMail({
//         from: process.env.EMAIL_USER,          // Your Gmail address (e.g., noreply.yourapp@gmail.com)
//         to: process.env.EMAIL_USER,            // Send a test email to yourself
//         subject: 'Test Email from Node.js App',
//         text: 'This is a test email sent from your Node.js application using Nodemailer with Gmail.'
//       });
//       res.send('Test email sent successfully!');
//     } catch (error) {
//       console.error("Error sending test email:", error);
//       res.status(500).send('Failed to send test email.');
//     }
//   });
  