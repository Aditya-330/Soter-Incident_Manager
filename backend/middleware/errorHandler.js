'use strict';

/**
 * Global error-handling middleware.
 * Catches all errors passed via next(err) and returns consistent JSON.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error('[ErrorHandler]', err.message);

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message).join('; ');
    return res.status(400).json({ success: false, error: messages });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({ success: false, error: `Duplicate value for ${field}.` });
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, error: 'Invalid ID format.' });
  }

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error.';

  res.status(status).json({ success: false, error: message });
}

module.exports = errorHandler;
