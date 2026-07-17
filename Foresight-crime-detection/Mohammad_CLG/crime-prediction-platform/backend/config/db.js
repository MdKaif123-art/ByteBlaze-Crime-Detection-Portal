const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Connect to MongoDB.
 *
 * This backend can still run without MongoDB for ML proxy routes.
 * If MONGO_URI is not provided, we log a warning and continue.
 */
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    logger.warn('MONGO_URI not set. Skipping MongoDB connection (ML proxy routes will still work).');
    return;
  }

  try {
    await mongoose.connect(uri);
    logger.info('MongoDB connected.');
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
    // Don't hard-crash the server; allow ML routes to work.
  }
}

module.exports = connectDB;

