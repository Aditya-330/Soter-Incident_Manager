'use strict';

const mongoose = require('mongoose');

// Matches db.json "companies" collection
const companySchema = new mongoose.Schema({
  // Support both legacy string IDs (migration) and MongoDB _id
  legacyId: { type: String, sparse: true, index: true },

  name:      { type: String, required: true, trim: true },
  status:    { type: String, enum: ['pending', 'approved', 'rejected', 'inactive'], default: 'pending' },
  website:   { type: String, default: '' },
  size:      { type: String, default: '' },
  industry:  { type: String, default: '' },
  location:  { type: String, default: '' },

  // Admin who registered
  adminName:  { type: String, default: '' },
  adminEmail: { type: String, default: '' },
  jobTitle:   { type: String, default: '' },
  phone:      { type: String, default: '' },

  // Business info
  numCustomers:          { type: String, default: '' },
  revenueRange:          { type: String, default: '' },
  numEmployees:          { type: String, default: '' },
  techPartnerships:      { type: String, default: '' },
  keyProducts:           { type: String, default: '' },
  businessOpportunity:   { type: String, default: '' },
  integrationType:       { type: String, default: '' },
  productsToIntegrate:   { type: String, default: '' },
  integrationRequirements: { type: String, default: '' },
  techContact:           { type: String, default: '' },
  techStack:             { type: String, default: '' },

  createdAt: { type: Date, default: Date.now },
}, { timestamps: false });

module.exports = mongoose.model('Company', companySchema);
