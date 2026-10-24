'use strict';

const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  legacyId:   { type: String, sparse: true, index: true },

  companyId:   { type: String, required: true, index: true },
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  memberIds:   [{ type: String }], // array of legacyIds or user _id strings
}, { timestamps: false });

module.exports = mongoose.model('Team', teamSchema);
