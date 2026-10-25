# Soter Incident Manager — Modernized

A full-stack incident management platform built with vanilla HTML/CSS/JS (frontend) and Node.js + Express + MongoDB Atlas (backend).

---

## Architecture

```
soter-incident-manager/
├── frontend/          # Static HTML/CSS/JS — served as a static site
│   ├── index.html
│   ├── dashboard.html
│   ├── ... (all HTML pages)
│   ├── js/            # Frontend JS modules
│   ├── css/           # Styles
│   └── serve.js       # Minimal Node static server (dev use)
│
├── backend/           # Express REST API + MongoDB
│   ├── server.js      # Entry point
│   ├── config/db.js   # MongoDB Atlas connection
│   ├── models/        # Mongoose schemas (9 collections)
│   ├── routes/        # REST API + /proxy health-check route
│   ├── middleware/    # JWT auth, error handler
│   ├── utils/seed.js  # Platform superadmin seeder
│   └── scripts/migrate.js  # One-time db.json → MongoDB migration
│
├── render.yaml        # Render.com deployment config
└── db.json            # Legacy json-server data (migration source)
```

---

## Quick Start (Local Development)

### Prerequisites
- Node.js ≥ 18
- A [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (free tier is fine)

### 1. Configure the backend environment

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/soter?retryWrites=true&w=majority
JWT_SECRET=your_super_secure_secret_here
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3000
PLATFORM_ADMIN_EMAIL=admin@soter.io
PLATFORM_ADMIN_PASSWORD=change_this_in_production
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. (Optional) Migrate existing data from db.json

> ⚠️ Only run this once. The script creates a backup and is idempotent.

```bash
cd backend
npm run migrate
```

### 4. Start the backend

```bash
cd backend
npm run dev    # uses nodemon for auto-reload
# or: npm start
```

Backend runs at **http://localhost:5000**

### 5. Serve the frontend

Open `frontend/index.html` directly in your browser, **or** run the minimal static server:

```bash
cd frontend
node serve.js
```

Frontend runs at **http://localhost:3000**

### 6. Log in

| Role | Email | Password |
|------|-------|----------|
| Platform Superadmin | `admin@soter.io` | `admin123` (change in `.env`) |

---

## API Overview

All REST endpoints follow json-server semantics for full frontend compatibility.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Login → returns JWT + user |
| `POST` | `/api/auth/register-company` | Register new company (pending) |
| `POST` | `/api/auth/signup` | Join workspace via invite code |
| `GET/POST` | `/proxy` | Health-check proxy (CORS bridge) |
| `GET/POST/PUT/PATCH/DELETE` | `/api/companies/:id?` | Company CRUD |
| `GET/POST/PUT/PATCH/DELETE` | `/api/users/:id?` | User CRUD |
| `GET/POST/PUT/PATCH/DELETE` | `/api/teams/:id?` | Team CRUD |
| `GET/POST/PUT/PATCH/DELETE` | `/api/services/:id?` | Service CRUD |
| `GET/POST/PUT/PATCH/DELETE` | `/api/incidents/:id?` | Incident CRUD |
| `GET/POST/PUT/PATCH/DELETE` | `/api/escalationLogs/:id?` | Escalation log CRUD |
| `GET/POST/PUT/PATCH/DELETE` | `/api/auditLogs/:id?` | Audit log CRUD |
| `GET/POST/PUT/PATCH/DELETE` | `/api/inviteCodes/:id?` | Invite code CRUD |
| `GET/POST/PUT/PATCH/DELETE` | `/api/dependencyGraph/:id?` | Service dependency edges |

All legacy paths (without `/api/` prefix) are also supported for frontend backwards-compatibility.

---

## Deployment (Render.com)

1. Push your code to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint
3. Select `render.yaml` from your repo
4. Set the following env vars in the Render dashboard for `soter-backend`:
   - `MONGODB_URI` — your Atlas connection string
   - `PLATFORM_ADMIN_PASSWORD` — a strong password

---

## Security Features

- **Passwords**: bcrypt (cost factor 12) — never stored in plaintext
- **Auth tokens**: JWT with configurable expiry (`JWT_EXPIRES_IN`)
- **Proxy SSRF protection**: private IP blocklist (RFC 1918, localhost, link-local), protocol allowlist (https only in prod), DNS resolution check, request timeouts
- **Rate limiting**: 500 requests / 15 minutes global, stricter on `/proxy`
- **CORS**: allowlist-only, configurable via `CORS_ORIGIN` env var

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | ✅ | MongoDB Atlas connection string |
| `JWT_SECRET` | ✅ | Secret for signing JWTs |
| `PORT` | No | Server port (default: 5000) |
| `NODE_ENV` | No | `development` or `production` |
| `JWT_EXPIRES_IN` | No | JWT expiry (default: `7d`) |
| `CORS_ORIGIN` | No | Comma-separated allowed origins |
| `PLATFORM_ADMIN_EMAIL` | No | Platform admin email (default: `admin@soter.io`) |
| `PLATFORM_ADMIN_PASSWORD` | No | Platform admin password (default: `admin123`) |
