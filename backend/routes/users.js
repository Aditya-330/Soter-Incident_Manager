'use strict';

/**
 * Users route — extends CRUD factory with special password handling.
 *
 * Security properties:
 *   - ALL routes require a valid JWT (authenticate middleware).
 *   - Company isolation: users can only see/modify users in their own company.
 *   - platform_superadmin can access all users (optionally filter by companyId).
 *   - Privilege escalation prevention: only platform_superadmin can set
 *     platform_superadmin role; only company_admin/superadmin can set
 *     teamadmin/superadmin/company_admin roles.
 *   - PATCH/PUT /users/:id: if 'password' field present, bcrypt-hash it before saving.
 *   - All user responses omit the password field (handled by User.toJSON()).
 */

const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const User     = require('../models/User');
const { authenticate, requireRole, ROLE_LEVELS } = require('../middleware/auth');

const router = express.Router();

// All routes require JWT authentication
router.use(authenticate);

async function findByAnyId(idStr) {
  let doc = await User.findOne({ legacyId: idStr });
  if (doc) return doc;
  if (mongoose.isValidObjectId(idStr)) doc = await User.findById(idStr);
  return doc;
}

function serialize(doc) {
  const obj = doc.toJSON ? doc.toJSON() : doc.toObject();
  obj.id = doc.legacyId || doc._id.toString();
  delete obj._id;
  delete obj.__v;
  delete obj.legacyId;
  delete obj.password; // always strip
  return obj;
}

function buildFilter(q) {
  const filter = {};
  for (const [k, v] of Object.entries(q)) {
    if (k === 'companyId') continue; // never trust client-supplied
    if (v !== '' && v !== undefined) filter[k] = v;
  }
  return filter;
}

/**
 * Determine effective company scope from the authenticated JWT.
 * - platform_superadmin: optional query filter, otherwise all companies
 * - everyone else: strictly their own companyId
 */
function getCompanyScope(req) {
  if (req.user.role === 'platform_superadmin') {
    return req.query.companyId || null;
  }
  return req.user.companyId;
}

/**
 * Validate that a requested role assignment is allowed for the requesting user.
 * Prevents privilege escalation.
 */
function validateRoleAssignment(requestedRole, actorRole) {
  if (!requestedRole) return true; // no change

  const actorLevel = ROLE_LEVELS[actorRole] || 0;
  const targetLevel = ROLE_LEVELS[requestedRole] || 0;

  // Nobody can assign platform_superadmin via this route
  if (requestedRole === 'platform_superadmin') return false;

  // Only platform_superadmin can assign company_admin (they reach here from above guard)
  if (requestedRole === 'company_admin' && actorLevel < ROLE_LEVELS['platform_superadmin']) return false;

  // Only company_admin and above can assign superadmin/teamadmin
  if (['superadmin', 'teamadmin'].includes(requestedRole) && actorLevel < ROLE_LEVELS['company_admin']) return false;

  return true;
}

// GET /users?key=value (company-scoped)
router.get('/', async (req, res, next) => {
  try {
    const companyScope = getCompanyScope(req);
    const filter = buildFilter(req.query);
    if (companyScope) filter.companyId = companyScope;

    const docs = await User.find(filter).lean();
    res.json(docs.map((d) => {
      const obj = { ...d };
      obj.id = obj.legacyId || obj._id.toString();
      delete obj._id; delete obj.__v; delete obj.legacyId; delete obj.password;
      return obj;
    }));
  } catch (err) { next(err); }
});

// GET /users/:id (company-scoped)
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await findByAnyId(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: 'User not found.' });

    const companyScope = getCompanyScope(req);
    // Deny-by-default: non-superadmins can only access users in their own company.
    // Records with missing companyId are treated as platform-level orphans and denied.
    if (companyScope && doc.companyId !== companyScope) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    res.json(serialize(doc));
  } catch (err) { next(err); }
});

// POST /users — admin-creates a user (only company_admin+ may create users directly)
router.post('/', requireRole('company_admin'), async (req, res, next) => {
  try {
    const data = { ...req.body };
    if (data.id && !data.legacyId) data.legacyId = data.id;
    delete data.id; delete data._id;

    // Force companyId from JWT for non-superadmins
    if (req.user.role !== 'platform_superadmin') {
      data.companyId = req.user.companyId;
    }

    // Validate role assignment
    if (data.role && !validateRoleAssignment(data.role, req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to assign this role.' });
    }

    const doc = await User.create(data);
    res.status(201).json(serialize(doc));
  } catch (err) { next(err); }
});

// PUT /users/:id — full replace (company-scoped, privilege escalation protection)
router.put('/:id', requireRole('company_admin'), async (req, res, next) => {
  try {
    const doc = await findByAnyId(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: 'User not found.' });

    const companyScope = getCompanyScope(req);
    // Deny-by-default: records with missing companyId are platform orphans, deny to company users.
    if (companyScope && doc.companyId !== companyScope) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const data = { ...req.body };
    delete data._id; delete data.id; delete data.legacyId;
    delete data.companyId; // companyId is immutable after creation

    if (data.role && !validateRoleAssignment(data.role, req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to assign this role.' });
    }

    if (data.password && !data.password.startsWith('$2')) {
      const salt = await bcrypt.genSalt(12);
      data.password = await bcrypt.hash(data.password, salt);
    }

    Object.assign(doc, data);
    doc.legacyId = doc.legacyId; // preserve
    await doc.save({ validateModifiedOnly: true });
    res.json(serialize(doc));
  } catch (err) { next(err); }
});

// PATCH /users/:id — partial update (company-scoped, privilege escalation protection)
// Non-admin users may patch their own profile only (name, password)
router.patch('/:id', async (req, res, next) => {
  try {
    const doc = await findByAnyId(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: 'User not found.' });

    const companyScope = getCompanyScope(req);
    // Deny-by-default: records with missing companyId are platform orphans, deny to company users.
    if (companyScope && doc.companyId !== companyScope) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const actorLevel = ROLE_LEVELS[req.user.role] || 0;
    const isSelf = req.user._id.toString() === doc._id.toString();
    const isAdmin = actorLevel >= ROLE_LEVELS['company_admin'];

    // Non-admins can only patch their own record and cannot change role/companyId/teamId
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
    }

    const data = { ...req.body };
    delete data._id; delete data.id; delete data.legacyId;
    delete data.companyId; // immutable

    // Non-admins cannot change role or teamId
    if (!isAdmin) {
      delete data.role;
      delete data.teamId;
    }

    if (data.role && !validateRoleAssignment(data.role, req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to assign this role.' });
    }

    if (data.password && !data.password.startsWith('$2')) {
      const salt = await bcrypt.genSalt(12);
      data.password = await bcrypt.hash(data.password, salt);
    }

    Object.assign(doc, data);
    await doc.save({ validateModifiedOnly: true });
    res.json(serialize(doc));
  } catch (err) { next(err); }
});

// DELETE /users/:id (only company_admin+)
router.delete('/:id', requireRole('company_admin'), async (req, res, next) => {
  try {
    const doc = await findByAnyId(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: 'User not found.' });

    const companyScope = getCompanyScope(req);
    // Deny-by-default: records with missing companyId are platform orphans, deny to company users.
    if (companyScope && doc.companyId !== companyScope) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    // Prevent self-deletion
    if (req.user._id.toString() === doc._id.toString()) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own account.' });
    }

    // Prevent deleting platform superadmins
    if (doc.role === 'platform_superadmin') {
      return res.status(403).json({ success: false, error: 'Platform superadmin accounts cannot be deleted via this API.' });
    }

    await doc.deleteOne();
    res.json({});
  } catch (err) { next(err); }
});

module.exports = router;
