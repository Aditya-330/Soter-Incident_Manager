# On-Call Incident Escalation Manager — Phase 1 (json-server)

A lightweight incident escalation tool built with HTML5, CSS3, Vanilla JavaScript, and **json-server** for persistence. No frameworks, no Express, no build tools — static HTML/CSS/JS served directly, talking to json-server's REST API over `fetch()`.

## Key Features

### Core
- **4-Level Role Hierarchy:** Super Admin > Team Admin > Senior Engineer > Junior Engineer.
- **SLA Countdown Timers:** Real-time SLA countdowns based on incident severity (Critical=5m, High=15m, Medium=30m, Low=60m).
- **Immutable Audit Trail:** Logs every action with relative timestamps, merged view of system + escalation events.
- **Live Stats & Analytics:** Uses `reduce()` and `filter()` to compute open/resolved incident counts in real-time.
- **Member Management:** Admins can assign users to teams dynamically.
- **Premium UI:** Dark/Light mode toggle, CSS keyframe animations, glassmorphism cards, and responsive layout.
- **Keyboard Shortcuts:** Power user shortcuts (`Ctrl+N` for new incident, `/` to search).

### New in Phase 1
- **json-server Persistence:** All data stored in `db.json` via REST API — no more localStorage.
- **Multi-Tenant Companies:** Each company gets isolated data. Register your company, then invite team members via codes.
- **Cross-Team Dependency-Aware Escalation:** When a service goes down, its dependency graph is walked and upstream teams are paged IN PARALLEL — not sequentially. Each gets independent SLA timers and escalation ladders.
- **Cycle Detection:** A→B→A dependency loops are detected and prevent infinite notifications.
- **Notification Trail:** Per-incident timeline showing who got paged, on what basis (primary vs. dependency), and their ack/escalation status.
- **Health Monitoring:** Real-time service health dashboard with automatic incident creation when outages are detected.
- **Invite Code System:** Company-scoped invite codes for secure signup. Superadmins can generate and manage codes.

## How to Run

1. **Install dependencies:**
   ```bash
   cd oncall-b2b-ca1
   npm install
   ```

2. **Start json-server** (Terminal 1):
   ```bash
   npm start
   ```
   This starts json-server on `http://localhost:3001` watching `db.json`.

3. **Serve static files** (Terminal 2):
   ```bash
   python3 -m http.server 8000
   ```

4. Visit `http://localhost:8000`

## Seeded Accounts (Acme Corp)

- **Super Admin:** `super@oncall.io` (pw: `admin`)
- **Team Admin:** `alice@oncall.io` (pw: `admin`)
- **Team Admin:** `bob@oncall.io` (pw: `admin`)
- **Senior Eng:** `charlie@oncall.io` (pw: `password`)
- **Senior Eng:** `diana@oncall.io` (pw: `password`)
- **Junior Eng:** `eve@oncall.io` (pw: `password`)
- **Junior Eng:** `frank@oncall.io` (pw: `password`)

**Default Invite Code:** `ACME-JOIN-2026`

> **⚠️ Security Warning:** This is a **client-side simulation**. Passwords are stored in plain text in `db.json`. A real system requires a backend to hash passwords.

## File Structure

```
oncall-b2b-ca1/
├── index.html          (Landing page with feature showcase)
├── register.html       (NEW: Company registration flow)
├── login.html          (Login with sessionStorage)
├── signup.html         (Signup via invite code)
├── dashboard.html      (Main hub: stats, search, incidents, notification trails)
├── admin.html          (Manage teams, services, members, invite codes)
├── audit.html          (View merged audit + escalation trail)
├── db.json             (NEW: json-server database)
├── package.json        (NEW: json-server dependency)
├── css/
│   └── style.css       (Premium dark/light theme + cross-team styles)
├── js/
│   ├── storage.js      (NEW: fetch-based API client for json-server)
│   ├── auth.js         (Async role hierarchy auth via fetch)
│   ├── teams.js        (Async team + member logic)
│   ├── services.js     (Async service CRUD + dependencyGraph)
│   ├── incidents.js    (Async incidents + cross-team escalation engine)
│   ├── admin.js        (Async admin forms + invite code management)
│   ├── health.js       (Ambient health monitor with auto-incident creation)
│   ├── audit.js        (Merged audit + escalation log viewer)
│   └── utils.js        (Time formatting, shortcuts, async export)
├── README.md
└── docs/
    ├── GIT_COMMITS.md  (Commit log per contributor)
    └── GIT_BRANCHES_AND_COMMITS.md (Branching & Git Flow specification)
```

## db.json Resources

| Resource | Description |
|----------|-------------|
| `companies` | Multi-tenant company records |
| `users` | Users scoped to a company |
| `teams` | Teams scoped to a company |
| `services` | Services with health status |
| `dependencyGraph` | Service-to-service dependency edges |
| `incidents` | Incidents with cross-team fields |
| `escalationLogs` | Incident-specific escalation events |
| `auditLogs` | General system audit events |
| `inviteCodes` | Company-scoped invite codes for signup |


<img width="1280" height="723" alt="PHOTO-2026-08-23-20-58-18" src="https://github.com/user-attachments/assets/cc43a91d-6134-40b8-bcd6-28fd1d2f68e1" />
<img width="1280" height="723" alt="PHOTO-2026-08-23-20-58-18" src="https://github.com/user-attachments/assets/6b1be918-1db4-432d-b52b-159d871cf9e5" />
<img width="1456" height="837" alt="PHOTO-2026-08-23-20-58-17" src="https://github.com/user-attachments/assets/649f816e-8d18-4339-8aca-2b59db771583" />


## Contributors

| Member | Role | Key Modules |
|--------|------|-------------|
| **Ravish** | Storage/API, Health, Styling | `storage.js`, `services.js`, `health.js`, `style.css`, `db.json` |
| **Aditya** | Teams/Admin, UI Forms, Docs | `teams.js`, `admin.js`, `utils.js`, `signup.html` |
| **Radhika** | Auth, Incidents/Escalation, Audit | `auth.js`, `incidents.js`, `audit.js`, `dashboard.html`, `register.html` |
