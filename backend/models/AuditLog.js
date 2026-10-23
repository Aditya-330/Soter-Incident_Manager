'use strict';

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  legacyId:  { type: String, sparse: true, index: true },

  companyId: { type: String, required: true, index: true },
  action:    { type: String, required: true },
  details:   { type: String, default: '' },
  entityId:  { type: String, default: null },
  userName:  { type: String, default: 'System' },
  actorRole: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: false });

module.exports = mongoose.model('AuditLog', auditLogSchema);
