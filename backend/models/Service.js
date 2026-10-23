'use strict';

const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  legacyId:  { type: String, sparse: true, index: true },

  companyId:  { type: String, required: true, index: true },
  teamId:     { type: String, required: true },
  name:       { type: String, required: true, trim: true },

  healthEndpoint:       { type: String, default: '' },
  checkMethod:          { type: String, enum: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH'], default: 'GET' },
  checkIntervalSeconds: { type: Number, default: 120, min: 1 },
  requestBody:          { type: String, default: null }, // JSON string or null

  status:    { type: String, enum: ['healthy', 'degraded', 'down'], default: 'healthy' },
  lastError: { type: String, default: null },
}, { timestamps: false });

module.exports = mongoose.model('Service', serviceSchema);
