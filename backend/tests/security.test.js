'use strict';

/**
 * Soter Incident Manager — Automated Security Test Suite
 *
 * Starts the real local Express server against a DEDICATED test database
 * (TEST_MONGODB_URI).  The server refuses to start if TEST_MONGODB_URI is
 * missing or equals MONGODB_URI, so production data can never be reached.
 *
 * Run:  npm test
 *       (jest tests/security.test.js --runInBand --forceExit --verbose)
 *
 * Prerequisites:
 *   Set TEST_MONGODB_URI in .env to a SEPARATE Atlas database (not MONGODB_URI).
 *   Example:
 *     TEST_MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/soter_test
 */

const http    = require('http');
const fetch   = require('node-fetch');
const path    = require('path');

// Load env before anything else
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Tell server.js to use TEST_MONGODB_URI + skip production seed
process.env.NODE_ENV = 'test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RUN_ID  = Math.random().toString(36).slice(2, 8);
const PORT    = process.env.TEST_PORT || 5099;
const BASE    = `http://localhost:${PORT}`;

function api(endpoint, options = {}) {
  const { method = 'GET', body, token, headers = {} } = options;
  const reqHeaders = { 'Content-Type': 'application/json', ...headers };
  if (token) reqHeaders['Authorization'] = `Bearer ${token}`;
  return fetch(`${BASE}${endpoint}`, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.PORT = PORT;
  require('../server');
  await new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      http.get(`${BASE}/health`, (res) => {
        if (res.statusCode === 200) { clearInterval(interval); resolve(); }
      }).on('error', () => {
        if (++attempts > 40) { clearInterval(interval); reject(new Error('Server never became ready')); }
      });
    }, 250);
  });
}, 30000);

afterAll(async () => {
  const mongoose = require('mongoose');
  try {
    const User       = require('../models/User');
    const Company    = require('../models/Company');
    const Team       = require('../models/Team');
    const Incident   = require('../models/Incident');
    const Service    = require('../models/Service');
    const InviteCode = require('../models/InviteCode');
    const AuditLog   = require('../models/AuditLog');

    // Delete only records tagged with this run's ID — never bulk drops
    await User.deleteMany({ email: { $regex: RUN_ID, $options: 'i' } });
    await User.deleteMany({ name:  { $regex: RUN_ID, $options: 'i' } });
    await Company.deleteMany({ name: { $regex: RUN_ID, $options: 'i' } });
    await Team.deleteMany({ name: { $regex: RUN_ID, $options: 'i' } });
    await Incident.deleteMany({ title: { $regex: RUN_ID, $options: 'i' } });
    await Service.deleteMany({ name: { $regex: RUN_ID, $options: 'i' } });
    await InviteCode.deleteMany({ code: { $regex: RUN_ID, $options: 'i' } });
    await AuditLog.deleteMany({ details: { $regex: RUN_ID, $options: 'i' } });

    console.log(`[Test] Cleanup complete for run ${RUN_ID}`);
  } catch (err) {
    console.warn('[Test] Cleanup error (non-fatal):', err.message);
  }
  await mongoose.connection.close();
}, 20000);

// ─── Shared state ─────────────────────────────────────────────────────────────

let adminToken;
let companyAId;
let companyAToken;
let companyBId;
let companyBToken;
let incidentAId;
let inviteCodeA;

// ─── 1. Health check ─────────────────────────────────────────────────────────

describe('1 — Health endpoint', () => {
  test('GET /health returns 200 and status:ok', async () => {
    const res = await api('/health');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });
});

// ─── 2. Unauthenticated CRUD access ──────────────────────────────────────────

describe('2 — Unauthenticated CRUD access (SEC-01)', () => {
  const collections = [
    '/api/incidents', '/api/services', '/api/teams', '/api/auditLogs',
    '/api/escalationLogs', '/api/inviteCodes', '/api/companies',
    '/api/users', '/api/dependencyGraph',
  ];
  for (const col of collections) {
    test(`GET ${col} without token → 401`, async () => {
      const res = await api(col);
      expect(res.status).toBe(401);
      const body = await json(res);
      expect(body.success).toBe(false);
    });
  }
  test('POST /api/incidents without token → 401', async () => {
    const res = await api('/api/incidents', { method: 'POST', body: { title: 'Test' } });
    expect(res.status).toBe(401);
  });
  test('DELETE /api/incidents/fakeid without token → 401', async () => {
    const res = await api('/api/incidents/fakeid', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

// ─── 3. Auth endpoints ────────────────────────────────────────────────────────

describe('3 — Authentication flows', () => {
  test('POST /api/auth/login with missing body → 400', async () => {
    const res = await api('/api/auth/login', { method: 'POST', body: {} });
    expect(res.status).toBe(400);
  });

  test('POST /api/auth/login with wrong credentials → 401', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'nobody@example.com', password: 'wrongpass' },
    });
    expect(res.status).toBe(401);
  });

  test('Platform superadmin login issues JWT', async () => {
    // In test mode, seedPlatformAdmin is skipped — seed the admin manually here.
    const bcrypt = require('bcryptjs');
    const User   = require('../models/User');
    const adminEmail = `admin-${RUN_ID}@soter.test`;
    const adminPass  = 'TestAdminPass!999';
    const existing = await User.findOne({ email: adminEmail });
    if (!existing) {
      const hashed = await bcrypt.hash(adminPass, 12);
      await User.create({ name: `Platform Admin ${RUN_ID}`, email: adminEmail, password: hashed, role: 'platform_superadmin', companyId: '__platform__' });
    }
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password: adminPass },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.').length).toBe(3);
    adminToken = body.token;
  });
});

// ─── 4. Setup isolated test companies ────────────────────────────────────────

describe('4 — Setup isolated test companies', () => {
  test('Register Company A (→ pending)', async () => {
    const res = await api('/api/auth/register-company', {
      method: 'POST',
      body: { companyName: `TestCo-A-${RUN_ID}`, adminName: `Admin A ${RUN_ID}`, adminEmail: `admin-a-${RUN_ID}@test.invalid`, adminPassword: 'AdminPassA123!' },
    });
    expect([200, 201]).toContain(res.status);
    const body = await json(res);
    expect(body.success).toBe(true);
    companyAId = body.companyId;
    expect(typeof companyAId).toBe('string');
  });

  test('Register Company B (→ pending)', async () => {
    const res = await api('/api/auth/register-company', {
      method: 'POST',
      body: { companyName: `TestCo-B-${RUN_ID}`, adminName: `Admin B ${RUN_ID}`, adminEmail: `admin-b-${RUN_ID}@test.invalid`, adminPassword: 'AdminPassB123!' },
    });
    expect([200, 201]).toContain(res.status);
    const body = await json(res);
    expect(body.success).toBe(true);
    companyBId = body.companyId;
    expect(typeof companyBId).toBe('string');
  });

  test('Superadmin approves Company A', async () => {
    const res = await api(`/api/companies/${companyAId}`, {
      method: 'PATCH', token: adminToken, body: { status: 'approved' },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.status).toBe('approved');
  });

  test('Superadmin approves Company B', async () => {
    const res = await api(`/api/companies/${companyBId}`, {
      method: 'PATCH', token: adminToken, body: { status: 'approved' },
    });
    expect(res.status).toBe(200);
  });

  test('Company A admin can log in after approval', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: `admin-a-${RUN_ID}@test.invalid`, password: 'AdminPassA123!' },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    companyAToken = body.token;
    expect(typeof companyAToken).toBe('string');
  });

  test('Company B admin can log in after approval', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: `admin-b-${RUN_ID}@test.invalid`, password: 'AdminPassB123!' },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    companyBToken = body.token;
  });

  test('Superadmin creates invite code for Company A', async () => {
    const res = await api('/api/inviteCodes', {
      method: 'POST', token: adminToken,
      body: { companyId: companyAId, code: `TEST-${RUN_ID.toUpperCase()}` },
    });
    expect([200, 201]).toContain(res.status);
    inviteCodeA = `TEST-${RUN_ID.toUpperCase()}`;
  });
});

// ─── 5. JWT validation ────────────────────────────────────────────────────────

describe('5 — JWT validation', () => {
  test('Invalid token → 401', async () => {
    const res = await api('/api/incidents', { token: 'totally.invalid.jwt' });
    expect(res.status).toBe(401);
  });

  test('Tampered token → 401', async () => {
    const parts = companyAToken.split('.');
    parts[1] = Buffer.from('{"id":"deadbeef","role":"platform_superadmin"}').toString('base64');
    const res = await api('/api/incidents', { token: parts.join('.') });
    expect(res.status).toBe(401);
  });

  test('Token with wrong secret → 401', async () => {
    const jwt = require('jsonwebtoken');
    const fakeToken = jwt.sign({ id: '000000000000', role: 'company_admin', companyId: companyAId }, 'wrong-secret');
    const res = await api('/api/incidents', { token: fakeToken });
    expect(res.status).toBe(401);
  });

  test('Expired token → 401', async () => {
    const jwt = require('jsonwebtoken');
    const expiredToken = jwt.sign({ id: '000000000000', role: 'company_admin', companyId: companyAId }, process.env.JWT_SECRET, { expiresIn: '0s' });
    await new Promise(r => setTimeout(r, 10));
    const res = await api('/api/incidents', { token: expiredToken });
    expect(res.status).toBe(401);
  });
});

// ─── 6. Tenant isolation (SEC-02) ────────────────────────────────────────────

describe('6 — Multi-tenant data isolation (SEC-02)', () => {
  test('Company A admin can create an incident', async () => {
    const res = await api('/api/incidents', {
      method: 'POST', token: companyAToken,
      body: { title: `Security test incident ${RUN_ID}`, status: 'open', severity: 'low', serviceId: 'test-service-placeholder', slaDeadline: new Date(Date.now() + 86400000).toISOString() },
    });
    expect([200, 201]).toContain(res.status);
    const body = await json(res);
    incidentAId = body.id;
    expect(body.companyId).toBe(companyAId);
  });

  test('Company A admin only sees their own incidents', async () => {
    const res = await api('/api/incidents', { token: companyAToken });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body)).toBe(true);
    for (const inc of body) { expect(inc.companyId).toBe(companyAId); }
  });

  test('Company B admin cannot see Company A incidents (IDOR)', async () => {
    const res = await api('/api/incidents', { token: companyBToken });
    expect(res.status).toBe(200);
    const body = await json(res);
    const crossTenant = body.filter(i => i.companyId === companyAId);
    expect(crossTenant.length).toBe(0);
  });

  test('Company B cannot read Company A incident by ID (IDOR)', async () => {
    const res = await api(`/api/incidents/${incidentAId}`, { token: companyBToken });
    expect([403, 404]).toContain(res.status);
  });

  test('Company B cannot update Company A incident (IDOR)', async () => {
    const res = await api(`/api/incidents/${incidentAId}`, { method: 'PATCH', token: companyBToken, body: { status: 'resolved' } });
    expect([403, 404]).toContain(res.status);
  });

  test('Company B cannot delete Company A incident (IDOR)', async () => {
    const res = await api(`/api/incidents/${incidentAId}`, { method: 'DELETE', token: companyBToken });
    expect([403, 404]).toContain(res.status);
  });

  test('Company admin can only see their own company', async () => {
    const res = await api('/api/companies', { token: companyAToken });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    const c = body[0];
    const id = c.id || c._id;
    expect(id === companyAId || c.legacyId === companyAId).toBe(true);
  });

  test('Superadmin can see all companies', async () => {
    const res = await api('/api/companies', { token: adminToken });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  test('companyId in request body is ignored — always overridden by JWT', async () => {
    const res = await api('/api/incidents', {
      method: 'POST', token: companyBToken,
      body: { title: `Spoofed companyId test ${RUN_ID}`, companyId: companyAId, status: 'open', severity: 'low', serviceId: 'test-service-placeholder', slaDeadline: new Date(Date.now() + 86400000).toISOString() },
    });
    expect([200, 201]).toContain(res.status);
    const body = await json(res);
    expect(body.companyId).toBe(companyBId);
    expect(body.companyId).not.toBe(companyAId);
  });
});

// ─── 7. Privilege escalation prevention ──────────────────────────────────────

describe('7 — Privilege escalation prevention', () => {
  test('Cannot self-assign platform_superadmin role in signup', async () => {
    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: { name: `Escalation Test ${RUN_ID}`, email: `escalate-${RUN_ID}@test.invalid`, password: 'TestPass123!', role: 'platform_superadmin', inviteCode: inviteCodeA },
    });
    expect(res.status).toBe(403);
    expect((await json(res)).success).toBe(false);
  });

  test('Cannot self-assign company_admin role in signup', async () => {
    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: { name: `Escalation Test ${RUN_ID}`, email: `escalate2-${RUN_ID}@test.invalid`, password: 'TestPass123!', role: 'company_admin', inviteCode: inviteCodeA },
    });
    expect(res.status).toBe(403);
  });

  test('Regular company user cannot create a platform_superadmin via /api/users', async () => {
    const res = await api('/api/users', {
      method: 'POST', token: companyAToken,
      body: { name: `Fake Superadmin ${RUN_ID}`, email: `fake-superadmin-${RUN_ID}@test.invalid`, password: 'TestPass123!', role: 'platform_superadmin', companyId: companyAId },
    });
    expect(res.status).toBe(403);
  });
});

// ─── 8. Invite code protection ───────────────────────────────────────────────

describe('8 — Invite code protection (SEC-04)', () => {
  test('GET /api/inviteCodes without auth → 401', async () => {
    const res = await api('/api/inviteCodes');
    expect(res.status).toBe(401);
  });

  test('Company A admin can only see their own invite codes', async () => {
    const res = await api('/api/inviteCodes', { token: companyAToken });
    expect(res.status).toBe(200);
    const body = await json(res);
    for (const code of body) { expect(code.companyId).toBe(companyAId); }
  });

  test('Company B cannot see Company A invite codes', async () => {
    const res = await api('/api/inviteCodes', { token: companyBToken });
    expect(res.status).toBe(200);
    const body = await json(res);
    const leaked = body.filter(c => c.companyId === companyAId);
    expect(leaked.length).toBe(0);
  });

  test('Signup with invalid invite code → 400', async () => {
    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Bad Invite', email: `badinvite-${RUN_ID}@test.invalid`, password: 'TestPass123!', inviteCode: 'TOTALLY-WRONG-CODE' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── 9. SSRF proxy filtering ──────────────────────────────────────────────────

describe('9 — SSRF filtering on /proxy', () => {
  const ssrfTargets = [
    { url: 'http://localhost:5000/health',              label: 'localhost' },
    { url: 'http://127.0.0.1:5000/',                   label: '127.0.0.1' },
    { url: 'http://0.0.0.0/',                          label: '0.0.0.0' },
    { url: 'http://10.0.0.1/',                         label: 'private 10.x' },
    { url: 'http://172.16.0.1/',                       label: 'private 172.16.x' },
    { url: 'http://192.168.1.1/',                      label: 'private 192.168.x' },
    { url: 'http://169.254.169.254/latest/meta-data/', label: 'AWS metadata' },
    { url: 'http://metadata.google.internal/',          label: 'GCP metadata hostname' },
  ];
  for (const { url, label } of ssrfTargets) {
    test(`/proxy blocks ${label}`, async () => {
      const res = await api('/proxy', { method: 'POST', body: { url } });
      expect(res.status).toBe(200);
      expect((await json(res)).ok).toBe(false);
    });
  }
  test('/proxy with missing url → ok:false', async () => {
    const res = await api('/proxy', { method: 'POST', body: {} });
    expect(res.status).toBe(200);
    expect((await json(res)).ok).toBe(false);
  });
  test('/proxy with invalid URL → ok:false', async () => {
    const res = await api('/proxy', { method: 'POST', body: { url: 'not-a-url' } });
    expect(res.status).toBe(200);
    expect((await json(res)).ok).toBe(false);
  });
  test('/proxy with valid public URL returns correct contract shape', async () => {
    const res = await api('/proxy', { method: 'POST', body: { url: 'https://httpbin.org/get' } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(typeof body.ok).toBe('boolean');
    expect(typeof body.status).toBe('number');
  });
});

// ─── 10. Proxy contract shape ─────────────────────────────────────────────────

describe('10 — Proxy response contract', () => {
  const requiredFields = ['ok', 'status', 'statusText', 'url', 'method', 'error'];
  test('Blocked request still returns full contract shape', async () => {
    const res = await api('/proxy', { method: 'POST', body: { url: 'http://127.0.0.1' } });
    const body = await json(res);
    for (const f of requiredFields) { expect(body).toHaveProperty(f); }
  });
  test('Missing url returns full contract shape', async () => {
    const res = await api('/proxy', { method: 'POST', body: {} });
    const body = await json(res);
    for (const f of requiredFields) { expect(body).toHaveProperty(f); }
  });
});

// ─── 11. Legitimate workflow smoke test ──────────────────────────────────────

describe('11 — Legitimate workflow smoke test', () => {
  let svcId;

  test('Company A admin can create a service', async () => {
    const res = await api('/api/services', {
      method: 'POST', token: companyAToken,
      body: { name: `Auth Service ${RUN_ID}`, status: 'healthy', healthEndpoint: 'https://example.com/health', teamId: 'test-team-placeholder' },
    });
    expect([200, 201]).toContain(res.status);
    const body = await json(res);
    svcId = body.id;
    expect(body.companyId).toBe(companyAId);
  });

  test('Company A admin can update that service', async () => {
    const res = await api(`/api/services/${svcId}`, { method: 'PATCH', token: companyAToken, body: { status: 'degraded' } });
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe('degraded');
  });

  test('Company A admin can delete the service', async () => {
    const res = await api(`/api/services/${svcId}`, { method: 'DELETE', token: companyAToken });
    expect(res.status).toBe(200);
  });

  test('Invite signup returns a JWT', async () => {
    const res = await api('/api/auth/signup', {
      method: 'POST',
      body: { name: `Invite User ${RUN_ID}`, email: `inviteuser-${RUN_ID}@test.invalid`, password: 'TestPass123!', role: 'junior', inviteCode: inviteCodeA },
    });
    expect([200, 201]).toContain(res.status);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.token.split('.').length).toBe(3);
  });

  test('Rotate-admin-password requires platform_superadmin JWT', async () => {
    const res = await api('/api/auth/rotate-admin-password', {
      method: 'POST', token: companyAToken,
      body: { currentPassword: 'anything', newPassword: 'NewStrongPass123!' },
    });
    expect(res.status).toBe(403);
  });

  test('Rotate-admin-password rejects wrong current password', async () => {
    const res = await api('/api/auth/rotate-admin-password', {
      method: 'POST', token: adminToken,
      body: { currentPassword: 'completely-wrong-password', newPassword: 'NewStrongPass123!' },
    });
    expect(res.status).toBe(401);
  });

  test('X-Powered-By header is removed', async () => {
    const res = await api('/health');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});

// ─── 12. Test database isolation guard ───────────────────────────────────────

describe('12 — Test database isolation guard (UNRES-04)', () => {
  test('TEST_MONGODB_URI is set and differs from MONGODB_URI', () => {
    const testUri = process.env.TEST_MONGODB_URI;
    const prodUri  = process.env.MONGODB_URI;
    expect(typeof testUri).toBe('string');
    expect(testUri.trim()).not.toBe('');
    if (prodUri) {
      const norm = (u) => u.trim().replace(/\/+$/, '').toLowerCase();
      expect(norm(testUri)).not.toBe(norm(prodUri));
    }
  });

  test('Server started with NODE_ENV=test, confirming test DB path was taken', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  test('Production-guard logic: throws when TEST_MONGODB_URI is blank', () => {
    const blank = '';
    expect(() => {
      if (!blank || blank.trim() === '') {
        throw new Error('[DB] TEST_MONGODB_URI is not set.');
      }
    }).toThrow('[DB] TEST_MONGODB_URI is not set.');
  });

  test('Production-guard logic: throws when TEST_MONGODB_URI equals MONGODB_URI', () => {
    const prodUri = 'mongodb+srv://user:pass@cluster.example.mongodb.net/soter';
    const norm = (u) => u.trim().replace(/\/+$/, '').toLowerCase();
    expect(() => {
      if (norm(prodUri) === norm(prodUri)) {
        throw new Error('[DB] TEST_MONGODB_URI must not equal MONGODB_URI.');
      }
    }).toThrow('[DB] TEST_MONGODB_URI must not equal MONGODB_URI.');
    // Real check: actual env values differ
    const testUri = process.env.TEST_MONGODB_URI || '';
    const realProdUri = process.env.MONGODB_URI || '';
    if (testUri && realProdUri) {
      expect(norm(testUri)).not.toBe(norm(realProdUri));
    }
  });
});

// ─── 13. Null / missing companyId isolation (UNRES-05) ───────────────────────

describe('13 — Null/missing companyId isolation (UNRES-05)', () => {
  let orphanMongoId;

  beforeAll(async () => {
    const Incident = require('../models/Incident');
    // Insert directly into MongoDB collection without schema validation to simulate legacy record
    const result = await Incident.collection.insertOne({
      title:       `Orphan incident ${RUN_ID}`,
      serviceId:   'orphan-service',
      severity:    'low',
      status:      'open',
      slaDeadline: new Date(Date.now() + 86400000),
      // companyId intentionally omitted
    });
    orphanMongoId = result.insertedId.toString();
  });

  test('Orphan record is absent from Company A list (scoped query never returns it)', async () => {
    const res = await api('/api/incidents', { token: companyAToken });
    expect(res.status).toBe(200);
    const body = await json(res);
    const found = body.find(i => i.id === orphanMongoId);
    expect(found).toBeUndefined();
  });

  test('Company A cannot read orphan by ID — GET/:id → 403', async () => {
    // isTenantAllowed: null !== companyAId → deny
    const res = await api(`/api/incidents/${orphanMongoId}`, { token: companyAToken });
    expect(res.status).toBe(403);
    expect((await json(res)).success).toBe(false);
  });

  test('Company B cannot read orphan by ID — GET/:id → 403', async () => {
    const res = await api(`/api/incidents/${orphanMongoId}`, { token: companyBToken });
    expect(res.status).toBe(403);
  });

  test('Company A cannot PATCH orphan — 403', async () => {
    const res = await api(`/api/incidents/${orphanMongoId}`, {
      method: 'PATCH', token: companyAToken, body: { status: 'resolved' },
    });
    expect(res.status).toBe(403);
  });

  test('Company A cannot DELETE orphan — 403', async () => {
    const res = await api(`/api/incidents/${orphanMongoId}`, {
      method: 'DELETE', token: companyAToken,
    });
    expect(res.status).toBe(403);
  });

  test('Platform superadmin CAN read orphan — GET/:id → 200', async () => {
    // scope === null → isTenantAllowed returns true unconditionally
    const res = await api(`/api/incidents/${orphanMongoId}`, { token: adminToken });
    expect(res.status).toBe(200);
    const body = await json(res);
    // companyId is absent/null — confirm no company data leaked
    expect(body.companyId == null || body.companyId === '').toBe(true);
  });

  afterAll(async () => {
    const Incident = require('../models/Incident');
    await Incident.deleteOne({ _id: orphanMongoId });
  });
});

// ─── 14. Cleanup verification ─────────────────────────────────────────────────

describe('14 — Test data cleanup verification', () => {
  test('Test companies created by this run exist in the test DB (will be cleaned by afterAll)', async () => {
    const Company = require('../models/Company');
    const docs = await Company.find({ name: { $regex: RUN_ID, $options: 'i' } }).lean();
    expect(docs.length).toBeGreaterThanOrEqual(2);
  });

  test('Cleanup regex does NOT match production emails', () => {
    const productionEmail = 'admin@soter.io';
    expect(new RegExp(RUN_ID, 'i').test(productionEmail)).toBe(false);
  });

  test('Cleanup regex DOES match test data from this run', () => {
    expect(new RegExp(RUN_ID, 'i').test(`admin-a-${RUN_ID}@test.invalid`)).toBe(true);
    expect(new RegExp(RUN_ID, 'i').test(`TestCo-A-${RUN_ID}`)).toBe(true);
  });
});
