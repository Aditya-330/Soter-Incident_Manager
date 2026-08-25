# Soter Incident Manager — Complete Codebase Architecture & Viva Guide

---

## 📑 Table of Contents
1. [Executive Summary & High-Level Architecture](#1-executive-summary--high-level-architecture)
2. [Deep Dive: The Proxy Server Engine (`proxy-server.js` & `server.js`)](#2-deep-dive-the-proxy-server-engine)
   - *Why is the proxy needed? (The CORS & Browser limitation)*
   - *How GET Probes work (Step-by-step + Code)*
   - *How POST Probes work (Step-by-step + Code)*
   - *Error Handling, Timeouts & Protocol Switching*
3. [File-by-File Technical Breakdown](#3-file-by-file-technical-breakdown)
   - *Root / Server Files (`server.js`, `proxy-server.js`, `package.json`, `db.json`)*
   - *Client JavaScript Modules (`js/storage.js`, `js/auth.js`, `js/incidents.js`, `js/health.js`, `js/services.js`, `js/teams.js`, `js/admin.js`, `js/audit.js`, `js/utils.js`)*
   - *User Interface HTML Pages (`index.html`, `login.html`, `signup.html`, `register.html`, `dashboard.html`, `admin.html`, `services.html`, `teams.html`, `audit.html`, `platform-admin.html`, `trigger.html`, `pricing.html`, `customers.html`)*
   - *Styling System (`css/style.css`)*
4. [Core Algorithms & Advanced System Logic](#4-core-algorithms--advanced-system-logic)
   - *Multi-Tier Escalation Ladder & SLA Calculation*
   - *Cross-Team Dependency Graph Resolution & Cycle Detection*
   - *Bidirectional Incident Visibility Algorithm*
   - *Ambient Health Monitoring & Automatic Incident Generation*
5. [Database Schema (`db.json`) & Entity Relationships](#5-database-schema-dbjson--entity-relationships)
6. [Top 10 Professor / Viva Questions & Bulletproof Answers](#6-top-10-professor--viva-questions--bulletproof-answers)

---

## 1. Executive Summary & High-Level Architecture

**Soter Incident Manager** is a multi-tenant B2B SaaS platform designed to simulate modern on-call alerting and cross-team incident escalation (analogous to PagerDuty or OpsGenie).

### System Topology
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BROWSER CLIENT (Vanilla Web)                        │
│   HTML5 + CSS3 (Modern Theme) + Vanilla JavaScript ES5/ES6 (Zero Bundlers)   │
│   Pages: Dashboard, Services, Admin, Teams, Audit, Platform Admin, Trigger  │
└──────────────────────┬───────────────────────────────┬──────────────────────┘
                       │                               │
                       │ REST API Requests             │ Health Probe Relay
                       │ (fetch / CRUD)                │ (/proxy POST payload)
                       ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       UNIFIED BACKEND SERVER (`server.js`)                   │
│                                                                             │
│  ┌──────────────────────────────────────┐ ┌──────────────────────────────┐  │
│  │         JSON-SERVER ENGINE           │ │   HEALTH CHECK CORS PROXY    │  │
│  │  Port: process.env.PORT || 3001      │ │   Endpoint: /proxy           │  │
│  │  Storage: db.json (REST Collections) │ │   Node.js HTTP/HTTPS Client  │  │
│  └──────────────────────────────────────┘ └──────────────┬───────────────┘  │
└──────────────────────────────────────────────────────────┼──────────────────┘
                                                           │
                                                           │ Probes (GET/POST)
                                                           ▼
                                            ┌─────────────────────────────┐
                                            │   EXTERNAL MONITORED APIs   │
                                            │  (e.g., Netlify endpoints,  │
                                            │   payment/checkout micro-   │
                                            │   services, 3rd-party APIs) │
                                            └─────────────────────────────┘
```

### Key Architectural Strengths:
1. **Zero-Build Architecture:** Runs natively in any browser without Webpack, Babel, Vite, or React overhead.
2. **Multi-Tenancy Isolation:** All tenant data (`users`, `teams`, `services`, `incidents`, `logs`) is strictly scoped by `companyId`.
3. **Automated Health Probing:** Continuous ambient polling of monitored microservices with real-time status code extraction.
4. **Graph-Aware Cross-Team Escalation:** When a dependency fails, downstream and upstream engineering teams are paged simultaneously with independent SLA countdown clocks.

---

## 2. Deep Dive: The Proxy Server Engine

### 🔍 Why was the Proxy Server necessary? (The Core Problem)
Browsers enforce the **Same-Origin Policy (SOP)** and **CORS (Cross-Origin Resource Sharing)**.
* When client JavaScript inside `dashboard.html` or `services.html` executes a `fetch('https://external-api.com/health')`, the browser automatically blocks the response if the target server does not send `Access-Control-Allow-Origin: *`.
* Furthermore, with opaque requests (`mode: 'no-cors'`), the browser returns `status: 0` and redacts whether the API responded with `200 OK`, `500 Server Error`, or `404 Not Found`.
* **The Solution:** A lightweight Node.js proxy server that receives the target URL from the frontend, performs a backend-to-backend request (where CORS does not exist), captures the real HTTP status code, and sends a clean JSON report back to the frontend with `Access-Control-Allow-Origin: *`.

---

### 📡 How `GET` Health Checks Work

#### Client-Side Flow (`js/health.js`):
1. `runDueHealthChecks()` iterates over all registered services in `db.json`.
2. For a service configured with `checkMethod: "GET"` and URL `https://soter-demo-store-1787161869.netlify.app/health/checkout`, it dispatches:
```javascript
var proxyPayload = {
  url: "https://soter-demo-store-1787161869.netlify.app/health/checkout",
  method: "GET"
};

var response = await fetch(HEALTH_PROXY_URL + '/proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(proxyPayload)
});
```

#### Server-Side Processing (`server.js` & `proxy-server.js`):
1. The `/proxy` route extracts `targetUrl` and `method`:
```javascript
server.all('/proxy', function(req, res) {
  var targetUrl = (req.body && req.body.url) || req.query.url;
  var method = ((req.body && req.body.method) || req.query.method || 'GET').toUpperCase();
  var customBody = (req.body && req.body.body !== undefined) ? req.body.body : req.query.body;
  processProxy(targetUrl, method, customBody, res);
});
```
2. `processProxy` parses the target URL using `new URL(targetUrl)`.
3. It detects whether the protocol is `https:` or `http:`, dynamically selecting `require('https')` or `require('http')`.
4. For `GET`, `bodyData` remains `null`.
5. It sets custom probe headers:
```javascript
var options = {
  hostname: target.hostname,
  port: target.port || (target.protocol === 'https:' ? 443 : 80),
  path: target.pathname + (target.search || ''),
  method: 'GET',
  timeout: 6000,
  headers: {
    'User-Agent': 'Soter-HealthCheck/1.0',
    'Accept': '*/*'
  }
};
```
6. Node dispatches `lib.request(options)`.
7. When the target responds with status code `200`:
   - `isOk = statusCode >= 200 && statusCode < 400;` (True).
   - Returns JSON:
```json
{
  "status": 200,
  "statusText": "OK",
  "ok": true,
  "url": "https://soter-demo-store-1787161869.netlify.app/health/checkout",
  "method": "GET",
  "error": null
}
```

---

### 📦 How `POST` Health Checks Work

#### Client-Side Flow (`js/health.js`):
When a service requires a POST body (e.g. testing checkout order submission):
1. `service.requestBody` contains:
```json
{
  "items": [
    {
      "productId": "prod_001",
      "quantity": 2
    },
    {
      "productId": "prod_002",
      "quantity": 1
    }
  ],
  "shipping": {
    "name": "Jane Doe",
    "address": "123 Main St",
    "city": "San Francisco",
    "state": "CA",
    "zip": "94105",
    "method": "express"
  }
}
```
2. The client packages this body into `proxyPayload.body` and sends it to `/proxy`.

#### Server-Side Processing (`server.js` & `proxy-server.js`):
1. The proxy receives the request body and serializes it to string.
2. It calculates the exact byte length using `Buffer.byteLength(bodyData)`:
```javascript
if (method !== 'GET' && method !== 'HEAD') {
  if (customBody !== undefined && customBody !== null && customBody !== '') {
    bodyData = (typeof customBody === 'object') ? JSON.stringify(customBody) : String(customBody);
  } else {
    bodyData = JSON.stringify({ _healthCheck: true, _ts: Date.now() });
  }
  options.headers['Content-Type'] = 'application/json';
  options.headers['Content-Length'] = Buffer.byteLength(bodyData);
}
```
3. Node opens the socket stream and writes the payload:
```javascript
var proxyReq = lib.request(options, function(proxyRes) { ... });
if (bodyData) {
  proxyReq.write(bodyData); // Streams payload into target socket
}
proxyReq.end();
```
4. Target microservice receives the JSON payload, processes it, and returns `200` or `201`.
5. The proxy captures the response status and responds to the Soter client.

---

### 🛡️ Error Handling, Timeouts & Protocol Switching in Proxy
* **Network Failures (DNS/Connection Refused):** `proxyReq.on('error', ...)` catches low-level socket errors and safely returns `status: 0, ok: false, error: err.message` without crashing the Node process.
* **Hung Requests (Timeout):** `REQUEST_TIMEOUT_MS = 6000` (6s). `proxyReq.on('timeout')` fires, executes `proxyReq.destroy()`, and returns `Request timed out after 6000ms`.
* **CORS Preflight:** Handles `OPTIONS` HTTP requests with HTTP 204 and CORS headers (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`).

---

## 3. File-by-File Technical Breakdown

### A. Root & Server Files

#### 1. `server.js`
* **Purpose:** The primary entry point for deployment on Render and local execution (`npm start`).
* **What it does:**
  - Uses `json-server` programmatically to serve the REST API from `db.json`.
  - Serves static frontend files (`index.html`, `css/`, `js/`) from the current directory.
  - Mounts the `/proxy` route to handle health check probes.
  - Contains `ensureSeedData()` which executes on server startup to verify that `db.json` contains valid collections and guarantees that `Platform Admin` (`admin@soter.io` / `admin123`) is never lost.
  - Listens on `process.env.PORT || 3001`.

#### 2. `proxy-server.js`
* **Purpose:** Standalone health check proxy server (if running independently on port `3002`).
* **What it does:** Pure standard-library Node.js script (`http`, `https`, `url`) implementing the CORS-bypass probe engine.

#### 3. `package.json`
* **Purpose:** Defines project metadata, npm scripts (`start`, `dev`, `json-server`, `proxy`), and dependencies (`json-server: ^0.17.4`).

#### 4. `db.json`
* **Purpose:** Persistent database for `json-server`.
* **Contains 9 root collections:** `companies`, `users`, `teams`, `services`, `dependencyGraph`, `incidents`, `escalationLogs`, `auditLogs`, `inviteCodes`.

---

### B. Client JavaScript Modules (`js/`)

#### 1. `js/storage.js`
* **Purpose:** The central data layer and REST API client.
* **Key Functions:**
  - `api.get(resource, queryParams)`: Performs HTTP GET with URL query parameters.
  - `api.getById(resource, id)`: Fetches a single record by primary key.
  - `api.post(resource, data)`: Creates a record with payload sanitization (`sanitizePayload` turns `null` IDs into safe empty strings).
  - `api.patch(resource, id, data)`: Partial update.
  - `api.delete(resource, id)`: Removes a record.
  - `getCurrentUser()` / `getCurrentCompanyId()`: Reads active session state from `sessionStorage`.
  - `generateId()`: Produces timestamped pseudo-random IDs (`Date.now().toString(36) + ...`).
  - `showToast(msg, type)`: Ambient floating UI notifications.

#### 2. `js/auth.js`
* **Purpose:** Authentication, role-based access control (RBAC), company registration wizard, and route guards.
* **Key Functions:**
  - `login(email, password)`: Validates credentials, checks company approval status (`pending`, `approved`, `rejected`), stores session, and redirects (`platform-admin.html` for superadmins, `dashboard.html` for company staff). Includes auto-recovery for `admin@soter.io`.
  - `registerCompany(...)`: Creates a pending company application, generates default Admin team, provisions initial Company Admin user, and logs audit record.
  - `signup(...)`: Signs up new developers via company invite codes.
  - `requireLogin()` & `requireRole(minRole)`: Route protection guards on every authenticated page.
  - `ROLE_LEVELS`: Role hierarchy map:
    `platform_superadmin (5) > company_admin (4) / superadmin (4) > teamadmin (3) > senior (2) > junior (1)`.

#### 3. `js/incidents.js`
* **Purpose:** The core incident engine, SLA countdown timer, and cross-team escalation dispatcher.
* **Key Functions:**
  - `createIncident(title, serviceId, severity, description, assignTo)`: Creates primary incident, marks service as `down`, walks the dependency graph via `getReverseDependencies()`, and auto-creates parallel `[CROSS-TEAM]` incidents for upstream/downstream teams.
  - `getOnCallUser(teamId)`: Auto-assigns the incident to the lowest available tier (starts with Junior/SDE I, then escalates).
  - `updateIncidentStatus(id, newStatus)`: Transitions status (`open` ➔ `acknowledged` ➔ `resolved`), records timestamps, and auto-restores service health to `healthy` when all incidents on it are resolved.
  - `renderIncidentList(containerId, filters)`: Implements **bidirectional visibility filtering** — ensures developers see their own team's incidents PLUS connected upstream/downstream dependency incidents.
  - `startSlaTimers()` / `updateSlaDisplays()`: Real-time countdown clock based on severity:
    `Critical = 5m`, `High = 15m`, `Medium = 30m`, `Low = 60m`.
  - `checkEscalation()`: Triggers automatic tier escalation (`junior` ➔ `senior` ➔ `teamadmin` ➔ `company_admin`) when SLA breaches.

#### 4. `js/health.js`
* **Purpose:** Ambient microservice health monitor.
* **Key Functions:**
  - `startHealthCheckEngine()`: Ticks every 1000ms and calls `runDueHealthChecks()`.
  - `runDueHealthChecks()`: Checks if `now - lastCheckedAt >= checkIntervalSeconds`. If a service is down, it uses a backoff interval.
  - `performHealthCheck(service)`: Packages probe request, dispatches to `HEALTH_PROXY_URL + '/proxy'`, and evaluates `result.ok`.
  - `handleCheckResult(service, isHealthy, errorDetail)`: If a healthy service fails, it automatically calls `createIncident()` with severity `critical` or `high` and updates service status to `down`.

#### 5. `js/services.js`
* **Purpose:** Service catalog management and dependency graph operations.
* **Key Functions:**
  - `addService(...)` / `updateService(...)` / `deleteService(...)`: CRUD operations for services and edge management in `dependencyGraph`.
  - `getServiceDependencies(serviceId)`: Returns services that this service depends on (`fromServiceId = serviceId`).
  - `getServiceDependents(serviceId)`: Returns services that depend on this service (`toServiceId = serviceId`).
  - `getDependencies()` & `getReverseDependencies()`: Recursive graph traversal algorithms with `visited` set cycle detection.
  - `renderServiceList()`: Renders interactive service cards with live health badges and dependency tags.

#### 6. `js/teams.js`
* **Purpose:** Team management and member roster assignments.
* **Key Functions:**
  - `getAllTeams()`: Retrieves teams scoped to `getCurrentCompanyId()`.
  - `addTeam(name, desc)`: Creates new engineering team.
  - `createAndAssignMember(name, email, password, role, teamId)`: Provisions user and updates `team.memberIds`.
  - `assignMemberToTeam()` / `removeMemberFromTeam()`: Manages team rosters.

#### 7. `js/admin.js`
* **Purpose:** Administrative console logic (team creation, service registration, member provisioning, invite code management).

#### 8. `js/audit.js`
* **Purpose:** Immutable audit and escalation timeline.
* **Key Functions:**
  - `logAction(type, details, entityId, userName, companyId)`: Records system events into `auditLogs`.
  - `logEscalation(incidentId, eventType, userId, note)`: Records incident-level pages into `escalationLogs`.
  - `renderAuditLog()`: Merges and renders audit events with relative timestamps (`getRelativeTime`).

#### 9. `js/utils.js`
* **Purpose:** Utility functions (relative time formatting, keyboard shortcuts `Ctrl+N` for new incident, `/` to search, and CSV/JSON export).

---

### C. HTML User Interface Pages

| File | Access Level | Description |
|---|---|---|
| `index.html` | Public | Marketing landing page with hero banner, live interactive simulator preview, feature cards, and role breakdown. |
| `login.html` | Public | Authentication gateway with tabbed role presets for quick demo access. |
| `signup.html` | Public | Employee signup via company-issued invite code. |
| `register.html` | Public | Multi-step company registration onboarding wizard (captures company details, technical stack, and admin credentials). |
| `dashboard.html` | Authenticated | Main incident management command center: real-time incident cards, SLA timers, Acknowledge/Resolve buttons, live stats bar, and search/filter. |
| `services.html` | Authenticated | Service health dashboard: shows all microservices, HTTP methods, probe intervals, error banners, and "Depends on" badges. |
| `teams.html` | Authenticated | Team directory displaying members, leads, and on-call rosters. |
| `trigger.html` | Authenticated | Manual incident trigger form for simulated outages or unscheduled downtime. |
| `admin.html` | Admin (`company_admin`, `teamadmin`) | Company management panel: team CRUD, service registration with dependency checkboxes, developer provisioning, and invite code generation. |
| `audit.html` | Authenticated | Merged system audit trail + incident escalation log history. |
| `platform-admin.html` | Platform Superadmin (`admin@soter.io`) | Multi-tenant control plane: review pending company applications, approve/reject workspaces, inspect tenant databases, and impersonate company dashboards. |
| `pricing.html` | Public | SaaS pricing tiers (Starter, Growth, Enterprise). |
| `customers.html` | Public | Case studies and social proof testimonials. |

---

### D. CSS Styling System (`css/style.css`)
* **Design Philosophy:** Modern dark/light theme, custom CSS custom properties (tokens), responsive grid/flexbox layouts, glassmorphism cards, micro-animations, and distinct status color coding (Critical `#ef4444`, High `#f97316`, Medium `#eab308`, Low `#3b82f6`, Healthy `#10b981`).

---

## 4. Core Algorithms & Advanced System Logic

### 1. SLA Countdown & Multi-Tier Escalation Ladder
* When an incident is created, an SLA deadline is computed:
  $$\text{slaDeadline} = \text{now} + (\text{SLA\_MAP}[\text{severity}] \times 60 \times 1000)$$
* **Severity Map:**
  - `Critical`: **5 minutes**
  - `High`: **15 minutes**
  - `Medium`: **30 minutes**
  - `Low`: **60 minutes**
* Every second, `updateSlaDisplays()` re-computes remaining seconds. If $\text{remaining} \le 0$, `slaBreached` becomes `true`.
* `checkEscalation()` executes: if the incident is unacknowledged, it promotes the incident tier:
  $$\text{Junior (SDE I)} \longrightarrow \text{Senior (SDE II)} \longrightarrow \text{Tech Lead (Team Admin)} \longrightarrow \text{Company Admin}$$

---

### 2. Dependency Graph Resolution & Cycle Detection
* Services are connected as a directed graph in `dependencyGraph`:
  - `fromServiceId`: Dependent service.
  - `toServiceId`: Prerequisite service (dependency).
* When a service goes down, `getReverseDependencies(serviceId, visited)` is called:
```javascript
async function getReverseDependencies(serviceId, visited) {
  if (!visited) visited = new Set();
  if (visited.has(serviceId)) return []; // Prevents infinite loops on cyclic dependencies (A -> B -> A)
  visited.add(serviceId);

  var dependents = await getServiceDependents(serviceId);
  var results = [];
  for (var i = 0; i < dependents.length; i++) {
    var depServiceId = dependents[i].fromServiceId;
    if (visited.has(depServiceId)) continue;
    var depService = await api.getById('services', depServiceId);
    results.push({ serviceId: depServiceId, service: depService });
    var deeper = await getReverseDependencies(depServiceId, visited);
    results = results.concat(deeper);
  }
  return results;
}
```

---

### 3. Bidirectional Incident Visibility Algorithm
In [`js/incidents.js`](file:///Users/ravishraheja/Desktop/clg/z5th%20sem/bee%20project/oncall-b2b-pull/js/incidents.js#L498-L541), `renderIncidentList()` determines which incidents an engineer can see on their dashboard:
```
Let myServices = All services belonging to CurrentUser.teamId
Let relatedServices = {
    all toServiceId where fromServiceId IN myServices   (Upstream dependencies)
  ∪ all fromServiceId where toServiceId IN myServices   (Downstream dependents)
}

An incident is VISIBLE to CurrentUser if:
  1. CurrentUser is Company Admin or Superadmin (roleWeight >= 4), OR
  2. The incident is explicitly assigned to CurrentUser, OR
  3. incident.serviceId IN myServices (Primary team incident), OR
  4. incident.serviceId IN relatedServices (Connected dependency incident)
```

---

### 4. Ambient Health Monitoring & Auto-Incident Trigger
```
[Timer Every 1s] ➔ Check if Service is due for probe 
                 ➔ Dispatch /proxy request (GET/POST)
                 ➔ Was response healthy (HTTP 200-399)?
                     ├── YES ➔ Keep/Restore status 'healthy'
                     └── NO  ➔ 1. Set service status 'down'
                               2. Call createIncident(auto-paged with error details)
                               3. Walk dependency graph and page connected teams
```

---

## 5. Database Schema (`db.json`) & Entity Relationships

```
┌─────────────────┐       1:N       ┌─────────────────┐
│    companies    │ ──────────────> │      users      │
└────────┬────────┘                 └────────┬────────┘
         │                                   │
         │ 1:N                               │ N:1
         ▼                                   ▼
┌─────────────────┐       1:N       ┌─────────────────┐
│      teams      │ <────────────── │    services     │
└─────────────────┘                 └────────┬────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │ 1:N                                       │ 1:N
                       ▼                                           ▼
            ┌─────────────────────┐                     ┌─────────────────────┐
            │   dependencyGraph   │                     │      incidents      │
            │(fromService,toServ.)│                     └──────────┬──────────┘
            └─────────────────────┘                                │ 1:N
                                                                   ▼
                                                        ┌─────────────────────┐
                                                        │   escalationLogs    │
                                                        └─────────────────────┘
```

---

## 6. Top 10 Professor / Viva Questions & Bulletproof Answers

### Q1: Why did you use `json-server` instead of a full Express / MongoDB backend?
> **Answer:** `json-server` provides a zero-boilerplate, compliant RESTful API over HTTP directly matching standard CRUD operations (`GET`, `POST`, `PATCH`, `DELETE`). For a simulation and frontend-heavy architectural demonstration, it provides immediate JSON persistence in `db.json` without requiring external database servers, while our custom `server.js` seamlessly wraps it alongside our proxy engine.

### Q2: Why is the Node.js Proxy Server required for health checks? Why couldn't client JavaScript check the health endpoints directly?
> **Answer:** Browser security policies (Same-Origin Policy and CORS) prevent client-side JavaScript from reading HTTP responses from third-party domains (like Netlify or Stripe) unless they explicitly provide permissive CORS headers. Even with `no-cors`, the browser returns an opaque response with `status: 0`, which hides whether the endpoint returned `200 OK` or `500 Internal Server Error`. The Node proxy performs server-to-server requests where CORS does not exist, reads the true status code, and relays it back to the client.

### Q3: How does your proxy server handle `POST` requests with custom payloads?
> **Answer:** When probing a POST endpoint, client-side `health.js` passes the payload to `/proxy`. The proxy calculates the exact payload byte length using `Buffer.byteLength(bodyData)` to prevent HTTP header mismatch errors, sets `Content-Type: application/json` and `Content-Length`, and streams the data into the target socket using `proxyReq.write(bodyData)` before calling `proxyReq.end()`.

### Q4: How does your system prevent infinite loops in cyclic dependencies (e.g., Service A depends on B, and B depends on A)?
> **Answer:** Both `getDependencies()` and `getReverseDependencies()` in `js/services.js` maintain a `visited = new Set()` data structure across recursive calls. Before traversing a node, the algorithm checks `if (visited.has(serviceId)) return [];`. If an edge loops back to an already-visited service, recursion halts immediately.

### Q5: How does the SLA escalation ladder work when an incident is ignored?
> **Answer:** Each incident has an `slaDeadline` calculated from severity (`Critical=5m`, `High=15m`, `Medium=30m`, `Low=60m`). A background loop checks `checkEscalation()` every second. If an incident remains unacknowledged past its SLA deadline, `inc.slaBreached` is set to `true`, and its `escalationTier` advances from `junior` ➔ `senior` ➔ `teamadmin` ➔ `company_admin`, broadening visibility and paging higher-tier personnel.

### Q6: If Checkout depends on Payments, what happens when Payments goes down versus when Checkout goes down?
> **Answer:** 
> - **When Payments goes down (Upstream failure):** The reverse dependency engine detects that Checkout relies on Payments. A primary incident is created for Payments, and a `[CROSS-TEAM]` incident is automatically generated and assigned to the Checkout team on-call engineer.
> - **When Checkout goes down (Downstream failure):** A primary incident is created for Checkout. Because Payments does not rely on Checkout, Payments continues normal operation, and our bidirectional visibility algorithm ensures connected teams are informed without triggering false primary alarms on Payments.

### Q7: How is multi-tenancy enforced in your application?
> **Answer:** Multi-tenancy is enforced at the data layer. Every user, team, service, incident, and log entry includes a `companyId`. When a user logs in, their `companyId` is stored in `sessionStorage`. All subsequent queries in `storage.js`, `incidents.js`, and `services.js` filter records by `api.get(resource, { companyId: currentCompanyId })`, ensuring complete tenant isolation.

### Q8: What role does `platform-admin.html` play?
> **Answer:** It is the superadmin control plane accessed exclusively by `platform_superadmin` (`admin@soter.io`). When a new company registers via `register.html`, its status is marked `pending`. The Platform Superadmin reviews company metadata, verifies tech requirements, and clicks "Approve" (which unlocks login for the company admin, generates invite codes, and provisions default teams).

### Q9: How do you handle cold starts and data persistence on Render?
> **Answer:** On Render's free tier, servers sleep after 15 minutes of inactivity. In `server.js`, we implemented `ensureSeedData()` which executes on startup. Even if the filesystem resets on redeploy, `server.js` automatically verifies that default schemas, the Platform Admin credentials (`admin@soter.io`), and base structures exist in `db.json`.

### Q10: How are incident resolutions propagated back to service health?
> **Answer:** When an incident is marked `resolved` via `updateIncidentStatus()`, the system queries all incidents for that `serviceId`. If there are zero remaining open incidents for that service, `api.patch('services', serviceId, { status: 'healthy' })` is automatically dispatched, restoring the service health status in real time.
