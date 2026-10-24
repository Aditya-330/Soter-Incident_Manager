'use strict';

const mongoose = require('mongoose');

let isConnected = false;

/**
 * Connect to MongoDB.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.test=false]
 *   When true, use TEST_MONGODB_URI (dedicated test database).
 *   Fails if TEST_MONGODB_URI is not set, is empty, or is identical to MONGODB_URI
 *   (which would silently write test data to the production database).
 */
async function connectDB(opts = {}) {
  if (isConnected) return;

  let uri;

  if (opts.test) {
    const testUri = process.env.TEST_MONGODB_URI;
    const prodUri  = process.env.MONGODB_URI;

    if (!testUri || testUri.trim() === '') {
      throw new Error(
        '[DB] TEST_MONGODB_URI is not set. ' +
        'Set it to a dedicated test-only MongoDB database before running tests. ' +
        'Do NOT point it at your production MONGODB_URI.'
      );
    }

    // Normalise both URIs (strip trailing slashes, lowercase) before comparing
    const normalise = (u) => u.trim().replace(/\/+$/, '').toLowerCase();
    if (normalise(testUri) === normalise(prodUri || '')) {
      throw new Error(
        '[DB] TEST_MONGODB_URI must not equal MONGODB_URI. ' +
        'Running tests against the production database is not allowed.'
      );
    }

    uri = testUri;
    console.log('[DB] Test mode — connecting to TEST database.');
  } else {
    uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('[DB] MONGODB_URI is not set in environment variables');
    }
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    console.log('[DB] Connected to MongoDB Atlas');

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      console.warn('[DB] Disconnected from MongoDB');
    });

    mongoose.connection.on('error', (err) => {
      console.error('[DB] Connection error:', err.message);
      isConnected = false;
    });
  } catch (err) {
    console.error('[DB] Failed to connect to MongoDB:', err.message);
    throw err;
  }
}

module.exports = { connectDB };
