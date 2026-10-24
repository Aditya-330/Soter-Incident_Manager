'use strict';

/**
 * Seeder: ensures platform superadmin exists in MongoDB.
 *
 * Called automatically on server startup (after DB connection).
 * Safe to run multiple times — checks for existence before inserting.
 *
 * Credentials come from environment variables:
 *   PLATFORM_ADMIN_EMAIL     (default: admin@soter.io)
 *   PLATFORM_ADMIN_PASSWORD  (default: admin123 — CHANGE IN PRODUCTION)
 *   PLATFORM_ADMIN_NAME      (default: Platform Admin)
 *
 * In production: set PLATFORM_ADMIN_PASSWORD to a strong value in .env
 */

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Team = require('../models/Team');

const PLATFORM_COMPANY_ID = '__platform__';

async function seedPlatformAdmin() {
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL || 'admin@soter.io';
  const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'admin123';
  const adminName = process.env.PLATFORM_ADMIN_NAME || 'Platform Admin';

  try {
    const existing = await User.findOne({ role: 'platform_superadmin' });
    if (existing) {
      console.log('[Seed] Platform superadmin already exists — skipping seed.');
      return;
    }

    // Ensure platform team exists
    let platformTeam = await Team.findOne({ companyId: PLATFORM_COMPANY_ID });
    if (!platformTeam) {
      platformTeam = await Team.create({
        legacyId: 'JfPkGedKBi4',
        companyId: PLATFORM_COMPANY_ID,
        name: 'Platform Admin',
        description: 'Platform-level superadmin team',
        memberIds: [],
      });
      console.log('[Seed] Created platform admin team.');
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashed = await bcrypt.hash(adminPassword, salt);

    const admin = await User.create({
      legacyId: '0fA-SsE-tHQ',
      companyId: PLATFORM_COMPANY_ID,
      name: adminName,
      email: adminEmail,
      password: hashed,
      role: 'platform_superadmin',
      teamId: platformTeam.legacyId || platformTeam._id.toString(),
    });

    // Add admin to platform team memberIds
    platformTeam.memberIds.push(admin._id.toString());
    await platformTeam.save();

    console.log(`[Seed] Created platform superadmin: ${adminEmail}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Seed] ⚠  Default password: "${adminPassword}" — change this in production!`);
    }
  } catch (err) {
    console.error('[Seed] Error seeding platform admin:', err.message);
  }
}

module.exports = { seedPlatformAdmin };
