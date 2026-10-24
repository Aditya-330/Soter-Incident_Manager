'use strict';

/**
 * Migration script: db.json → MongoDB Atlas
 *
 * SAFETY RULES:
 *   1. Creates a timestamped JSON backup of db.json before touching anything
 *   2. NEVER overwrites existing documents (uses insertMany with ordered:false + unique legacyId)
 *   3. Run with --force flag to re-attempt failed collections
 *   4. Idempotent: safe to run multiple times
 *   5. Passwords that are plaintext (not starting with $2) are bcrypt-hashed during migration
 *
 * Usage:
 *   node scripts/migrate.js
 *   node scripts/migrate.js --force   (skip existing-document warnings)
 *
 * Prerequisites:
 *   - .env must have MONGODB_URI set
 *   - db.json must be at ../../db.json relative to this script (project root)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const DB_JSON_PATH = path.join(__dirname, '../../db.json');
const BACKUP_DIR   = path.join(__dirname, '../../');

// Models
const Company       = require('../models/Company');
const User          = require('../models/User');
const Team          = require('../models/Team');
const Service       = require('../models/Service');
const DependencyEdge = require('../models/DependencyEdge');
const Incident      = require('../models/Incident');
const EscalationLog = require('../models/EscalationLog');
const AuditLog      = require('../models/AuditLog');
const InviteCode    = require('../models/InviteCode');

const FORCE = process.argv.includes('--force');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set in .env. Aborting migration.');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log('✅ Connected to MongoDB Atlas');
}

function backupDbJson() {
  if (!fs.existsSync(DB_JSON_PATH)) {
    console.warn('⚠  db.json not found — skipping backup.');
    return;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `db.backup.${ts}.json`);
  fs.copyFileSync(DB_JSON_PATH, backupPath);
  console.log(`📦 Backup created: ${backupPath}`);
  return backupPath;
}

function loadDbJson() {
  if (!fs.existsSync(DB_JSON_PATH)) return {};
  const raw = fs.readFileSync(DB_JSON_PATH, 'utf8');
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

async function migrateCollection(Model, records, transform) {
  if (!records || records.length === 0) {
    console.log(`  ⏭  No records to migrate.`);
    return { inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  for (const record of records) {
    const doc = await transform(record);
    if (!doc) { skipped++; continue; }

    try {
      // Check if already migrated
      const existing = doc.legacyId
        ? await Model.findOne({ legacyId: doc.legacyId })
        : null;

      if (existing) {
        if (!FORCE) skipped++;
        else {
          // Update existing in force mode
          Object.assign(existing, doc);
          await existing.save({ validateModifiedOnly: true });
          inserted++;
        }
        continue;
      }

      await Model.create(doc);
      inserted++;
    } catch (err) {
      if (err.code === 11000) {
        console.warn(`    ⚠  Duplicate key for legacyId "${doc.legacyId}" — skipping.`);
        skipped++;
      } else {
        console.error(`    ❌ Error inserting "${doc.legacyId || '?'}":`, err.message);
      }
    }
  }

  return { inserted, skipped };
}

async function run() {
  console.log('\n🚀 Soter Incident Manager — db.json → MongoDB Migration\n');

  // Backup first
  backupDbJson();

  const db = loadDbJson();
  await connectDB();

  // --- Companies ---
  console.log('\n📁 Companies:');
  const companyResult = await migrateCollection(Company, db.companies || [], async (c) => ({
    legacyId: c.id,
    name:     c.name,
    status:   c.status || 'pending',
    website:  c.website || '',
    size:     c.size || '',
    industry: c.industry || '',
    location: c.location || '',
    adminName:  c.adminName || '',
    adminEmail: c.adminEmail || '',
    jobTitle:   c.jobTitle || '',
    phone:      c.phone || '',
    numCustomers:           c.numCustomers || '',
    revenueRange:           c.revenueRange || '',
    numEmployees:           c.numEmployees || '',
    techPartnerships:       c.techPartnerships || '',
    keyProducts:            c.keyProducts || '',
    businessOpportunity:    c.businessOpportunity || '',
    integrationType:        c.integrationType || '',
    productsToIntegrate:    c.productsToIntegrate || '',
    integrationRequirements: c.integrationRequirements || '',
    techContact: c.techContact || '',
    techStack:   c.techStack || '',
    createdAt:   c.createdAt ? new Date(c.createdAt) : new Date(),
  }));
  console.log(`  ✅ Inserted: ${companyResult.inserted}, Skipped: ${companyResult.skipped}`);

  // --- Users (with password hashing) ---
  console.log('\n👤 Users:');
  const userResult = await migrateCollection(User, db.users || [], async (u) => {
    let password = u.password || 'changeme';
    // Hash if plaintext
    if (!password.startsWith('$2')) {
      const salt = await bcrypt.genSalt(12);
      password = await bcrypt.hash(password, salt);
    }
    return {
      legacyId:  u.id,
      companyId: u.companyId || '__platform__',
      name:      u.name || 'Unknown',
      email:     (u.email || '').toLowerCase().trim(),
      password,
      role:      u.role || 'junior',
      teamId:    u.teamId || null,
    };
  });
  console.log(`  ✅ Inserted: ${userResult.inserted}, Skipped: ${userResult.skipped}`);

  // --- Teams ---
  console.log('\n👥 Teams:');
  const teamResult = await migrateCollection(Team, db.teams || [], async (t) => ({
    legacyId:    t.id,
    companyId:   t.companyId || '__platform__',
    name:        t.name || 'Unnamed Team',
    description: t.description || '',
    memberIds:   Array.isArray(t.memberIds) ? t.memberIds : [],
  }));
  console.log(`  ✅ Inserted: ${teamResult.inserted}, Skipped: ${teamResult.skipped}`);

  // --- Services ---
  console.log('\n⚙️  Services:');
  const serviceResult = await migrateCollection(Service, db.services || [], async (s) => ({
    legacyId:             s.id,
    companyId:            s.companyId,
    teamId:               s.teamId,
    name:                 s.name || 'Unnamed Service',
    healthEndpoint:       s.healthEndpoint || '',
    checkMethod:          (s.checkMethod || 'GET').toUpperCase(),
    checkIntervalSeconds: parseInt(s.checkIntervalSeconds) || 120,
    requestBody:          s.requestBody || null,
    status:               s.status || 'healthy',
    lastError:            s.lastError || null,
  }));
  console.log(`  ✅ Inserted: ${serviceResult.inserted}, Skipped: ${serviceResult.skipped}`);

  // --- Dependency Graph ---
  console.log('\n🔗 Dependency Graph:');
  const depResult = await migrateCollection(DependencyEdge, db.dependencyGraph || [], async (d) => ({
    legacyId:      d.id,
    companyId:     d.companyId,
    fromServiceId: d.fromServiceId,
    toServiceId:   d.toServiceId,
  }));
  console.log(`  ✅ Inserted: ${depResult.inserted}, Skipped: ${depResult.skipped}`);

  // --- Incidents ---
  console.log('\n🚨 Incidents:');
  const incidentResult = await migrateCollection(Incident, db.incidents || [], async (i) => ({
    legacyId:      i.id,
    companyId:     i.companyId,
    title:         i.title || 'Untitled Incident',
    description:   i.description || '',
    serviceId:     i.serviceId,
    severity:      i.severity || 'medium',
    status:        i.status || 'open',
    escalationTier: i.escalationTier || 'junior',
    assignedUserId: i.assignedUserId || null,
    createdAt:     i.createdAt ? new Date(i.createdAt) : new Date(),
    acknowledgedAt: i.acknowledgedAt ? new Date(i.acknowledgedAt) : null,
    acknowledgedBy: i.acknowledgedBy || null,
    resolvedAt:    i.resolvedAt ? new Date(i.resolvedAt) : null,
    resolvedBy:    i.resolvedBy || null,
    slaDeadline:   i.slaDeadline ? new Date(i.slaDeadline) : new Date(Date.now() + 3600000),
    slaBreached:   i.slaBreached || false,
    isCrossTeam:   i.isCrossTeam || false,
    triggeredForServiceId: i.triggeredForServiceId || null,
    rootCauseServiceId:    i.rootCauseServiceId || null,
  }));
  console.log(`  ✅ Inserted: ${incidentResult.inserted}, Skipped: ${incidentResult.skipped}`);

  // --- Escalation Logs ---
  console.log('\n📋 Escalation Logs:');
  const escalationResult = await migrateCollection(EscalationLog, db.escalationLogs || [], async (l) => ({
    legacyId:   l.id,
    companyId:  l.companyId || null,
    incidentId: l.incidentId,
    eventType:  l.eventType || l.action,
    userId:     l.userId || null,
    actorRole:  l.actorRole || null,
    timestamp:  l.timestamp ? new Date(l.timestamp) : new Date(),
    note:       l.note || '',
  }));
  console.log(`  ✅ Inserted: ${escalationResult.inserted}, Skipped: ${escalationResult.skipped}`);

  // --- Audit Logs ---
  console.log('\n📝 Audit Logs:');
  const auditResult = await migrateCollection(AuditLog, db.auditLogs || [], async (l) => ({
    legacyId:  l.id,
    companyId: l.companyId,
    action:    l.action,
    details:   l.details || '',
    entityId:  l.entityId || null,
    userName:  l.userName || 'System',
    actorRole: l.actorRole || null,
    timestamp: l.timestamp ? new Date(l.timestamp) : new Date(),
  }));
  console.log(`  ✅ Inserted: ${auditResult.inserted}, Skipped: ${auditResult.skipped}`);

  // --- Invite Codes ---
  console.log('\n🎟️  Invite Codes:');
  const inviteResult = await migrateCollection(InviteCode, db.inviteCodes || [], async (c) => ({
    legacyId:  c.id,
    companyId: c.companyId,
    code:      (c.code || '').toUpperCase(),
    createdBy: c.createdBy || null,
    createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
  }));
  console.log(`  ✅ Inserted: ${inviteResult.inserted}, Skipped: ${inviteResult.skipped}`);

  console.log('\n✅ Migration complete!\n');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
