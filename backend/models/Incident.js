'use strict';

const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  legacyId:  { type: String, sparse: true, index: true },

  companyId: { type: String, required: true, index: true },
  title:     { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  serviceId:  { type: String, required: true },
  severity:   { type: String, enum: ['critical', 'high', 'medium', 'low'], required: true },
  status:     { type: String, enum: ['open', 'acknowledged', 'escalated', 'resolved'], default: 'open' },

  escalationTier: {
    type: String,
    enum: ['junior', 'senior', 'teamadmin', 'company_admin', 'superadmin', 'platform_superadmin'],
    default: 'junior',
  },
  assignedUserId: { type: String, default: null },

  createdAt:   { type: Date, default: Date.now },
  acknowledgedAt: { type: Date, default: null },
  acknowledgedBy: { type: String, default: null },
  resolvedAt:  { type: Date, default: null },
  resolvedBy:  { type: String, default: null },

  slaDeadline: { type: Date, required: true },
  slaBreached: { type: Boolean, default: false },

  isCrossTeam:          { type: Boolean, default: false },
  triggeredForServiceId: { type: String, default: null },
  rootCauseServiceId:   { type: String, default: null },
}, { timestamps: false });

module.exports = mongoose.model('Incident', incidentSchema);
