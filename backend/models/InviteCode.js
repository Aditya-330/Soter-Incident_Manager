'use strict';

const mongoose = require('mongoose');

const inviteCodeSchema = new mongoose.Schema({
  legacyId:  { type: String, sparse: true, index: true },

  companyId:  { type: String, required: true, index: true },
  code:       { type: String, required: true, uppercase: true, trim: true, unique: true },
  createdBy:  { type: String, default: null },
  createdAt:  { type: Date, default: Date.now },
}, { timestamps: false });

module.exports = mongoose.model('InviteCode', inviteCodeSchema);
