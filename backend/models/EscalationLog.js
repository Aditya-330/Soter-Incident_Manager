'use strict';

const mongoose = require('mongoose');

const escalationLogSchema = new mongoose.Schema({
  legacyId:   { type: String, sparse: true, index: true },

  companyId:  { type: String, index: true },
  incidentId: { type: String, required: true, index: true },
  eventType: {
    type: String,
    enum: [
      'INCIDENT_CREATED',
      'INCIDENT_ACKNOWLEDGED',
      'INCIDENT_ESCALATED',
      'INCIDENT_RESOLVED',
      'CROSS_TEAM_NOTIFIED',
      'SLA_BREACHED',
    ],
    required: true,
  },
  userId:    { type: String, default: null },
  actorRole: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
  note:      { type: String, default: '' },
}, { timestamps: false });

module.exports = mongoose.model('EscalationLog', escalationLogSchema);
