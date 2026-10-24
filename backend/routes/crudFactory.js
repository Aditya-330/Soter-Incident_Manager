'use strict';

/**
 * Secure Generic CRUD route factory.
 *
 * ALL routes require a valid JWT (authenticate middleware).
 * Company-level tenant isolation is enforced server-side from req.user.companyId
 * for every read, create, update, and delete — the client-supplied companyId is
 * NEVER trusted.
 *
 * platform_superadmin may access all companies.
 *
 * Creates Express routes:
 *   GET    /collection?filters   → filtered list scoped to caller's company
 *   GET    /collection/:id       → get by _id or legacyId (company-scoped)
 *   POST   /collection           → create (companyId forced from JWT)
 *   PUT    /collection/:id       → replace (company-scoped, companyId locked)
 *   PATCH  /collection/:id       → partial update (company-scoped)
 *   DELETE /collection/:id       → delete (company-scoped)
 */

const express  = require('express');
const mongoose = require('mongoose');
const { authenticate } = require('../middleware/auth');

// Detect the Company model by its modelName so we can use a different
// filter strategy (Company docs don't have a companyId field — they ARE companies).
const Company = require('../models/Company');

/**
 * Resolve a document by _id or legacyId.
 */
async function findByAnyId(Model, idStr) {
  let doc = await Model.findOne({ legacyId: idStr });
  if (doc) return doc;
  if (mongoose.isValidObjectId(idStr)) {
    doc = await Model.findById(idStr);
  }
  return doc;
}

/**
 * Build a Mongoose filter from query params.
 * NOTE: companyId is stripped from user-supplied params and re-injected
 * from the verified JWT inside each handler.
 */
function buildFilter(queryParams) {
  const filter = {};
  for (const [key, value] of Object.entries(queryParams)) {
    if (key === 'companyId') continue; // never trust client-supplied companyId
    if (value === '' || value === undefined) continue;
    filter[key] = value;
  }
  return filter;
}

/**
 * Strip _id / __v / companyId from payload before writing to DB.
 * companyId is re-injected from the verified JWT.
 * Preserves 'id' → 'legacyId' mapping.
 */
function sanitizeBody(body) {
  const cleaned = { ...body };
  delete cleaned._id;
  delete cleaned.__v;
  delete cleaned.companyId; // always force from JWT, never trust client
  if (cleaned.id && !cleaned.legacyId) {
    cleaned.legacyId = cleaned.id;
  }
  delete cleaned.id;
  return cleaned;
}

/**
 * Serialize a Mongoose document back to the shape the frontend expects.
 * Frontend uses doc.id (the legacy ID) as the primary key for all operations.
 */
function serialize(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = obj.legacyId || obj._id.toString();
  delete obj._id;
  delete obj.__v;
  delete obj.legacyId;
  return obj;
}

/**
 * Determine the effective company scope for a request.
 *
 * - platform_superadmin: can see all companies — returns null (no filter)
 *   OR can filter by ?companyId= query param if provided.
 * - All other roles: strictly scoped to their own companyId from JWT.
 */
function getCompanyScope(req) {
  if (req.user.role === 'platform_superadmin') {
    // Allow optional filter by query param for superadmin drill-down
    return req.query.companyId || null;
  }
  return req.user.companyId;
}

/**
 * Build a MongoDB filter that correctly scopes a list query.
 *
 * For most models the filter is simply { companyId: scope }.
 *
 * For the Company model itself, the documents don't carry a companyId field
 * — they ARE the company.  A company_admin's companyId in the JWT is the
 * MongoDB _id (or legacyId) of their Company document.  We therefore match
 * on { _id } OR { legacyId } instead.
 *
 * platform_superadmin (scope === null) → no extra filter (return all).
 */
function buildScopedFilter(Model, baseFilter, scope) {
  if (!scope) return baseFilter; // superadmin — no restriction

  if (Model === Company || Model.modelName === 'Company') {
    // Match the company whose _id or legacyId equals the caller's companyId
    return {
      ...baseFilter,
      $or: [
        { _id: mongoose.isValidObjectId(scope) ? new mongoose.Types.ObjectId(scope) : undefined },
        { legacyId: scope },
      ].filter((c) => Object.values(c)[0] !== undefined),
    };
  }

  // Normal models: filter by companyId field
  return { ...baseFilter, companyId: scope };
}

/**
 * For a single-document fetch on the Company model, verify the caller owns it.
 * Returns true if access is permitted.
 */
function canAccessCompanyDoc(doc, scope) {
  if (!scope) return true; // superadmin
  const docId = doc._id ? doc._id.toString() : null;
  const legacyId = doc.legacyId || null;
  return docId === scope || legacyId === scope;
}

/**
 * Tenant-isolation guard for non-Company models.
 *
 * Policy:
 *   - platform_superadmin (scope === null): always allowed — can access all records
 *     including platform-level records and legacy orphans with no companyId.
 *   - All other roles (scope is a non-empty string):
 *     DENY access unless doc.companyId strictly equals the caller's scope.
 *     Records with a missing, null, or empty companyId are treated as
 *     platform-level orphans and are NOT accessible by company-scoped users.
 *
 * Returns true if access is permitted.
 */
function isTenantAllowed(doc, scope) {
  if (!scope) return true; // platform_superadmin — unrestricted
  // Deny if doc has no companyId (orphan record) OR companyId belongs to another tenant
  return doc.companyId === scope;
}

function createCRUDRouter(Model) {
  const router = express.Router();
  const isCompanyModel = (Model === Company || Model.modelName === 'Company');

  // All routes require a valid JWT
  router.use(authenticate);

  // GET /collection?filters — list/filter (company-scoped)
  router.get('/', async (req, res, next) => {
    try {
      const companyScope = getCompanyScope(req);
      const baseFilter  = buildFilter(req.query);
      const filter      = buildScopedFilter(Model, baseFilter, companyScope);

      const docs = await Model.find(filter).lean();
      const result = docs.map((d) => {
        const obj = { ...d };
        obj.id = obj.legacyId || obj._id.toString();
        delete obj._id;
        delete obj.__v;
        delete obj.legacyId;
        return obj;
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /collection/:id (company-scoped)
  router.get('/:id', async (req, res, next) => {
    try {
      const doc = await findByAnyId(Model, req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found.' });

      const companyScope = getCompanyScope(req);

      // Enforce company isolation
      if (isCompanyModel) {
        if (!canAccessCompanyDoc(doc, companyScope)) {
          return res.status(403).json({ success: false, error: 'Access denied.' });
        }
      } else if (!isTenantAllowed(doc, companyScope)) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      res.json(serialize(doc));
    } catch (err) {
      next(err);
    }
  });

  // POST /collection (companyId forced from JWT)
  router.post('/', async (req, res, next) => {
    try {
      const data = sanitizeBody(req.body);

      // Force companyId from JWT for non-superadmins
      // Superadmin may specify via body (e.g. platform admin creating a resource)
      if (req.user.role !== 'platform_superadmin') {
        data.companyId = req.user.companyId;
      } else {
        // Allow explicit companyId in body for superadmin, but only if it's a string
        if (req.body.companyId && typeof req.body.companyId === 'string') {
          data.companyId = req.body.companyId;
        } else {
          data.companyId = req.user.companyId;
        }
      }

      const doc = await Model.create(data);
      res.status(201).json(serialize(doc));
    } catch (err) {
      next(err);
    }
  });

  // PUT /collection/:id — full replace (company-scoped, companyId locked)
  router.put('/:id', async (req, res, next) => {
    try {
      const doc = await findByAnyId(Model, req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found.' });

      const companyScope = getCompanyScope(req);
      if (isCompanyModel) {
        if (!canAccessCompanyDoc(doc, companyScope)) {
          return res.status(403).json({ success: false, error: 'Access denied.' });
        }
      } else if (!isTenantAllowed(doc, companyScope)) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      const data = sanitizeBody(req.body);
      data.legacyId   = doc.legacyId;   // Preserve legacyId
      data.companyId  = doc.companyId;  // Never allow changing companyId
      Object.assign(doc, data);
      await doc.save();
      res.json(serialize(doc));
    } catch (err) {
      next(err);
    }
  });

  // PATCH /collection/:id — partial update (company-scoped)
  router.patch('/:id', async (req, res, next) => {
    try {
      const doc = await findByAnyId(Model, req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found.' });

      const companyScope = getCompanyScope(req);
      if (isCompanyModel) {
        if (!canAccessCompanyDoc(doc, companyScope)) {
          return res.status(403).json({ success: false, error: 'Access denied.' });
        }
      } else if (!isTenantAllowed(doc, companyScope)) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      const data = sanitizeBody(req.body);
      Object.assign(doc, data);
      await doc.save();
      res.json(serialize(doc));
    } catch (err) {
      next(err);
    }
  });

  // DELETE /collection/:id (company-scoped)
  router.delete('/:id', async (req, res, next) => {
    try {
      const doc = await findByAnyId(Model, req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found.' });

      const companyScope = getCompanyScope(req);
      if (isCompanyModel) {
        if (!canAccessCompanyDoc(doc, companyScope)) {
          return res.status(403).json({ success: false, error: 'Access denied.' });
        }
      } else if (!isTenantAllowed(doc, companyScope)) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      await doc.deleteOne();
      res.json({});
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createCRUDRouter, findByAnyId, serialize };
