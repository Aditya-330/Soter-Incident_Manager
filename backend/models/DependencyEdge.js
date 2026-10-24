'use strict';

const mongoose = require('mongoose');

// Represents a directed edge: fromService depends on toService
const dependencyEdgeSchema = new mongoose.Schema({
  legacyId:      { type: String, sparse: true, index: true },

  companyId:     { type: String, required: true, index: true },
  fromServiceId: { type: String, required: true }, // the dependent service
  toServiceId:   { type: String, required: true }, // the upstream dependency
}, { timestamps: false });

// Prevent duplicate edges
dependencyEdgeSchema.index({ fromServiceId: 1, toServiceId: 1 }, { unique: true });

module.exports = mongoose.model('DependencyEdge', dependencyEdgeSchema);
