'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  legacyId:  { type: String, sparse: true, index: true },

  companyId: { type: String, required: true, index: true }, // '__platform__' for superadmin
  name:      { type: String, required: true, trim: true },
  email:     { type: String, required: true, trim: true, lowercase: true },
  password:  { type: String, required: true },
  role: {
    type: String,
    enum: ['platform_superadmin', 'company_admin', 'superadmin', 'teamadmin', 'senior', 'junior'],
    default: 'junior',
  },
  teamId: { type: String, default: null }, // legacyId or null
}, { timestamps: false });

// Unique email constraint
userSchema.index({ email: 1 }, { unique: true });

// Hash password before save (only if modified)
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  // If already bcrypt hash, skip (handles migration where we pre-hash)
  if (this.password.startsWith('$2')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Compare password helper
userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Never return password in JSON responses
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
