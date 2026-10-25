'use strict';

const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');

const User       = require('../models/User');
const Company    = require('../models/Company');
const Team       = require('../models/Team');
const InviteCode = require('../models/InviteCode');
const AuditLog   = require('../models/AuditLog');

const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function generateToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, companyId: user.companyId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
}

/**
 * Resolve a company by its legacyId OR MongoDB _id string.
 * Supports legacy migration IDs and native 24-character hex ObjectIds.
 */
async function findCompanyById(idStr) {
  if (!idStr) return null;
  let company = await Company.findOne({ legacyId: idStr });
  if (!company && idStr.match(/^[a-f\d]{24}$/i)) {
    company = await Company.findById(idStr);
  }
  return company;
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { success, token, user, redirect }
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const passwordMatch = await user.comparePassword(password);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // Platform superadmin: no company check needed
    if (user.role === 'platform_superadmin') {
      const token = generateToken(user);
      return res.json({
        success: true,
        token,
        user: user.toJSON(),
        redirect: 'platform-admin.html',
      });
    }

    // Company status check for non-platform users
    if (user.companyId) {
      const company = await findCompanyById(user.companyId);
      if (company) {
        if (company.status === 'pending') {
          return res.status(403).json({
            success: false,
            status: 'pending',
            error: 'Your company registration is currently pending review. You will receive access once approved by the platform team.',
          });
        }
        if (company.status === 'rejected') {
          return res.status(403).json({
            success: false,
            status: 'rejected',
            error: 'Your company registration request was not approved. Please contact platform support.',
          });
        }
        if (company.status !== 'approved') {
          return res.status(403).json({
            success: false,
            status: 'inactive',
            error: `Your company workspace is not active. Status: ${company.status}`,
          });
        }
      }
    }

    // Log audit
    await AuditLog.create({
      companyId: user.companyId,
      action: 'USER_LOGIN',
      details: `User ${user.name} logged in`,
      entityId: null,
      userName: user.name,
      actorRole: user.role,
    }).catch(() => {}); // non-fatal

    const token = generateToken(user);
    return res.json({
      success: true,
      token,
      user: user.toJSON(),
      redirect: 'dashboard.html',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/register-company
 * Registers a new company + admin user (status: pending)
 */
router.post('/register-company', async (req, res, next) => {
  try {
    const {
      companyName, adminName, adminEmail, adminPassword,
      website, size, industry, location, jobTitle, phone,
      numCustomers, revenueRange, numEmployees, techPartnerships,
      keyProducts, businessOpportunity, integrationType,
      productsToIntegrate, integrationRequirements, techContact, techStack,
    } = req.body;

    if (!companyName || !adminName || !adminEmail || !adminPassword) {
      return res.status(400).json({
        success: false,
        error: 'Company name, admin name, email, and password are required.',
      });
    }

    // Check email uniqueness
    const existingUser = await User.findOne({ email: adminEmail.trim().toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    // Create company (pending)
    const company = await Company.create({
      name: companyName,
      status: 'pending',
      website:               website || '',
      size:                  size || '',
      industry:              industry || '',
      location:              location || '',
      adminName,
      adminEmail:            adminEmail.trim().toLowerCase(),
      jobTitle:              jobTitle || '',
      phone:                 phone || '',
      numCustomers:          numCustomers || '',
      revenueRange:          revenueRange || '',
      numEmployees:          numEmployees || '',
      techPartnerships:      techPartnerships || '',
      keyProducts:           keyProducts || '',
      businessOpportunity:   businessOpportunity || '',
      integrationType:       integrationType || '',
      productsToIntegrate:   productsToIntegrate || '',
      integrationRequirements: integrationRequirements || '',
      techContact:           techContact || '',
      techStack:             techStack || '',
    });

    // Create default admin team
    const team = await Team.create({
      companyId:   company._id.toString(),
      name:        'Admin',
      description: 'Default admin team',
      memberIds:   [],
    });

    // Create admin user (password hashed by pre-save hook)
    const adminUser = await User.create({
      companyId: company._id.toString(),
      name:      adminName,
      email:     adminEmail.trim().toLowerCase(),
      password:  adminPassword,
      role:      'company_admin',
      teamId:    team._id.toString(),
    });

    // Add admin to team
    team.memberIds.push(adminUser._id.toString());
    await team.save();

    // Audit log
    await AuditLog.create({
      companyId: company._id.toString(),
      action: 'COMPANY_REGISTERED_PENDING',
      details: `Company "${companyName}" submitted for approval by ${adminName}`,
      entityId: company._id.toString(),
      userName: adminName,
      actorRole: 'company_admin',
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      pending: true,
      companyId: company._id.toString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/signup
 * Join an existing company workspace via invite code.
 *
 * FIX: Now returns a JWT token so the session is immediately valid.
 * The company workspace must be approved.
 * Admin roles cannot be self-assigned.
 */
router.post('/signup', async (req, res, next) => {
  try {
    const { name, email, password, role, inviteCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
    }

    // Find invite code
    const invite = await InviteCode.findOne({ code: (inviteCode || '').trim().toUpperCase() });
    if (!invite) {
      return res.status(400).json({ success: false, error: 'Invalid invite code.' });
    }

    const company = await findCompanyById(invite.companyId);
    if (!company || company.status !== 'approved') {
      return res.status(403).json({ success: false, error: 'This company workspace is pending review or inactive.' });
    }

    // Block admin role self-assignment
    const blockedRoles = ['platform_superadmin', 'company_admin', 'superadmin', 'teamadmin'];
    if (blockedRoles.includes(role)) {
      return res.status(403).json({ success: false, error: 'Admin roles can only be assigned by company administrators.' });
    }

    const existingUser = await User.findOne({ email: email.trim().toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    const newUser = await User.create({
      companyId: invite.companyId,
      name,
      email: email.trim().toLowerCase(),
      password,
      role: role || 'junior',
      teamId: null,
    });

    await AuditLog.create({
      companyId: invite.companyId,
      action: 'USER_REGISTERED',
      details: `User ${name} registered as ${role || 'junior'}`,
      entityId: newUser._id.toString(),
      userName: name,
      actorRole: role || 'junior',
    }).catch(() => {});

    // FIX: Return a signed JWT so signup establishes an authenticated session
    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      token,
      user: newUser.toJSON(),
      redirect: 'dashboard.html',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/rotate-admin-password
 *
 * Secure platform superadmin credential rotation.
 * Requires: existing valid superadmin JWT + current password verification.
 * Does NOT log the new password anywhere.
 *
 * Body: { currentPassword, newPassword }
 */
router.post('/rotate-admin-password', authenticate, requireRole('platform_superadmin'), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required.' });
    }

    if (newPassword.length < 12) {
      return res.status(400).json({ success: false, error: 'New password must be at least 12 characters.' });
    }

    // Re-fetch with password field for verification
    const admin = await User.findById(req.user._id);
    if (!admin) {
      return res.status(403).json({ success: false, error: 'Admin account not found.' });
    }

    const currentMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!currentMatch) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }

    // Hash and save — pre-save hook is bypassed since we set the already-hashed value
    const salt = await bcrypt.genSalt(12);
    admin.password = await bcrypt.hash(newPassword, salt);
    await admin.save({ validateModifiedOnly: true });

    // Audit — log the rotation event WITHOUT logging credentials
    await AuditLog.create({
      companyId: '__platform__',
      action: 'ADMIN_PASSWORD_ROTATED',
      details: `Platform superadmin password rotated`,
      entityId: admin._id.toString(),
      userName: admin.name,
      actorRole: 'platform_superadmin',
    }).catch(() => {});

    return res.json({ success: true, message: 'Password rotated successfully. Please update your Render environment variable.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
