# Soter Backend

REST API & Incident Management backend service for the **Soter Incident Management Platform**. Built with Node.js, Express, MongoDB Atlas, and Mongoose.

---

## 🛠 Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB Atlas (Mongoose ODM)
- **Authentication & Security:** JWT (`jsonwebtoken`), bcrypt password hashing (`bcryptjs`), CORS (`cors`), Rate Limiting (`express-rate-limit`), SSRF Protection

---

## 📁 Project Structure

```
backend/
├── config/
│   └── db.js              # MongoDB Atlas connection & event handlers
├── middleware/
│   ├── auth.js            # JWT verification & RBAC authorization
│   └── errorHandler.js    # Centralized error handler
├── models/
│   ├── AuditLog.js        # Audit trail logs
│   ├── Company.js         # Company workspace entity
│   ├── DependencyEdge.js  # Service dependency graph
│   ├── EscalationLog.js   # Incident escalation steps
│   ├── Incident.js        # Incident reports & severity
│   ├── InviteCode.js      # Onboarding invite codes
│   ├── Service.js         # Service catalog & health probe config
│   ├── Team.js            # Teams & member lists
│   └── User.js            # User accounts & roles
├── routes/
│   ├── auth.js            # Login, registration, signup endpoints
│   ├── crudFactory.js     # Universal REST CRUD factory
│   ├── proxy.js           # SSRF-protected health-check probe proxy
│   └── users.js           # User management with bcrypt handling
├── scripts/
│   └── migrate.js         # Migration utility from legacy db.json to MongoDB
├── utils/
│   └── seed.js            # Safe database seeder for platform superadmin
├── .env.example           # Template for environment configuration
├── .gitignore             # Git ignore file
├── package.json           # Dependencies and scripts
└── server.js              # Main Express application entry point
```

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+)
- MongoDB Atlas cluster connection string

### 2. Installation
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```
Update `.env` with your MongoDB connection string and JWT secret:
```ini
PORT=5001
NODE_ENV=development
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/soter?retryWrites=true&w=majority
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
```

### 4. Run the Server
```bash
# Development mode
npm run dev

# Or start directly
npm start
```
The server will run on `http://localhost:5001`.

---

## 📡 API Overview

### Health
- `GET /health` — Check server status and uptime

### Authentication (`/api/auth`)
- `POST /api/auth/login` — Log in with email and password
- `POST /api/auth/register-company` — Register a new company workspace
- `POST /api/auth/signup` — Join an existing workspace via invite code

### Health Probe Proxy (`/proxy`)
- `GET /proxy?url=<target_url>` — Safe probe proxy with SSRF protection
- `POST /proxy` — Request body `{"url": "..."}`

### Core CRUD Collections
Available at both `/<resource>` and `/api/<resource>`:
- `/companies`
- `/users`
- `/teams`
- `/services`
- `/dependencyGraph`
- `/incidents`
- `/escalationLogs`
- `/auditLogs`
- `/inviteCodes`

---

## 🔒 Security Features
- **SSRF Prevention:** Private IP and AWS/cloud metadata address blocklists for external health probes.
- **Password Security:** Salted bcrypt hashing with automatic pre-save hooks; passwords stripped from all API outputs.
- **JWT Authorization:** Role-based access control (RBAC).
- **Rate Limiting:** IP-based request throttling against brute force.
