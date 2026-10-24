'use strict';

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const { connectDB }   = require('./config/db');
const errorHandler    = require('./middleware/errorHandler');
const { createCRUDRouter } = require('./routes/crudFactory');
const { seedPlatformAdmin } = require('./utils/seed');

// Models
const Company        = require('./models/Company');
const Team           = require('./models/Team');
const Service        = require('./models/Service');
const DependencyEdge = require('./models/DependencyEdge');
const Incident       = require('./models/Incident');
const EscalationLog  = require('./models/EscalationLog');
const AuditLog       = require('./models/AuditLog');
const InviteCode     = require('./models/InviteCode');

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── CORS ────────────────────────────────────────────────────────────────────
// Strictly enumerate allowed origins — wildcard with credentials is forbidden.
// CORS_ORIGIN env var is a comma-separated list; must include the deployed
// frontend URL (e.g. https://soter-frontend.onrender.com) set in Render dashboard.
const rawOrigins = process.env.CORS_ORIGIN ||
  'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001';

const allowedOrigins = rawOrigins
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow non-browser callers (curl, Postman) — origin is undefined for same-origin
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Log CORS violations without leaking details in the response body
    console.warn(`[CORS] Rejected origin: ${origin}`);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Security headers ────────────────────────────────────────────────────────
// Remove Express fingerprint header
app.disable('x-powered-by');

// ─── Global rate limiter ─────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per window for all environments (tighter in prod)
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests — please try again later.' },
});
app.use(globalLimiter);

// ─── Auth routes get a tighter rate limit (brute-force protection) ────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // 30 login attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many authentication attempts — please try again later.' },
});

// ─── Request logger (development) ────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ─── Health / sanity route (PUBLIC — intentional) ────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ─── Proxy route (PUBLIC — required by health-check engine design) ────────────
// The proxy is intentionally public: it's the outbound health-check relay that
// the frontend uses from the browser. It has its own SSRF protection.
app.use('/proxy', require('./routes/proxy'));

// ─── Auth routes (PUBLIC) ─────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, require('./routes/auth'));

// ─── CRUD API routes (ALL PROTECTED — authenticate is applied inside crudFactory) ───
// Each collection is exposed under /api/<name> AND legacy /<name> (no /api prefix)
// so that the existing frontend works without changing API_BASE path structure.
const collections = [
  { path: 'companies',       model: Company       },
  { path: 'teams',           model: Team          },
  { path: 'services',        model: Service       },
  { path: 'dependencyGraph', model: DependencyEdge },
  { path: 'incidents',       model: Incident      },
  { path: 'escalationLogs',  model: EscalationLog },
  { path: 'auditLogs',       model: AuditLog      },
  { path: 'inviteCodes',     model: InviteCode    },
];

for (const { path: p, model } of collections) {
  const router = createCRUDRouter(model);
  app.use(`/api/${p}`, router);
  app.use(`/${p}`, router); // legacy path compatibility
}

// Users has a special router (password handling + privilege escalation protection)
const usersRouter = require('./routes/users');
app.use('/api/users', usersRouter);
app.use('/users', usersRouter); // legacy path compatibility

// ─── Global error handler ────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    const isTestEnv = process.env.NODE_ENV === 'test';
    await connectDB(isTestEnv ? { test: true } : {});

    // Skip seeding in test mode — tests manage their own data via the API
    if (!isTestEnv) {
      await seedPlatformAdmin();
    }

    app.listen(PORT, () => {
      console.log(`[Server] Soter backend running on http://localhost:${PORT}`);
      console.log(`[Server] NODE_ENV=${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] CORS allowed origins: ${allowedOrigins.join(', ')}`);
    });
  } catch (err) {
    console.error('[Server] Fatal startup error:', err.message);
    process.exit(1);
  }
})();
