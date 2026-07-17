const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env.example') });

const Crime = require('../models/Crime');
const connectDB = require('../config/db');

// Connect to DB
connectDB();

const seedData = async () => {
  try {
    // Clear out
    await Crime.deleteMany({});
    
    // Creating some sample data so the frontend can work immediately without full data sets
    const sampleCrimes = [
      {
        crime_id: 'FIR_SAMPLE_1',
        district_name: 'Bengaluru City',
        latitude: 12.9716,
        longitude: 77.5946,
        timestamp: new Date(),
        crime_type: 'ROBBERY',
        severity: 8,
        processed: true,
        coordinates_geocoded: false
      },
      {
        crime_id: 'FIR_SAMPLE_2',
        district_name: 'Bengaluru City',
        latitude: 12.9650,
        longitude: 77.6000,
        timestamp: new Date(Date.now() - 86400000), // 1 day ago
        crime_type: 'THEFT',
        severity: 4,
        processed: true,
        coordinates_geocoded: false
      }
    ];

    await Crime.insertMany(sampleCrimes);
    console.log('Sample Data Seeded!');
    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

seedData();
