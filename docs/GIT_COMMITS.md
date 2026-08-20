# Git Commit Log — On-Call Incident Escalation Manager

All commits represent the collaborative development workflow for the group project across three team members: **Aditya** (Team Lead), **Ravish**, and **Radhika**.

---

## Phase 0 — Prototype (LocalStorage Foundation)

| Commit # | Member | Message | Files Changed |
|:--------:|--------|---------|---------------|
| 1 | Aditya | `initial project setup` | `.gitignore`, `README.md` |
| 2 | Ravish | `setup basic folder structure` | `css/`, `js/`, `docs/` |
| 3 | Ravish | `add local storage helper and seed data` | `js/storage.js` |
| 4 | Radhika | `add auth handling and user login` | `js/auth.js`, `login.html` |
| 5 | Aditya | `add team creation and user assignment` | `js/teams.js`, `teams.html` |
| 6 | Ravish | `add services registry and dependency structure` | `js/services.js` |
| 7 | Radhika | `add incident creation with sla timers` | `js/incidents.js` |
| 8 | Ravish | `add basic service health checker` | `js/health.js` |
| 9 | Radhika | `add audit log tracking` | `js/audit.js` |
| 10 | Aditya | `add toast and modal utilities` | `js/utils.js` |
| 11 | Aditya | `add system architecture notes in readme` | `README.md` |
| 12 | Ravish | `add dark and light theme styles` | `css/style.css` |
| 13 | Radhika | `create main dashboard view with stats` | `dashboard.html` |
| 14 | Aditya | `create admin panel and trigger pages` | `admin.html`, `trigger.html` |
| 15 | Aditya | `add platform admin portal` | `platform-admin.html`, `js/admin.js` |
| 16 | Radhika | `create landing page and audit view` | `index.html`, `audit.html` |
| 17 | Aditya | `release v0.9 prototype` | `README.md`, `docs/GIT_COMMITS.md` |

---

## Phase 1 — REST API & Multi-Tenant Migration (json-server)

| Commit # | Member | Message | Files Changed |
|:--------:|--------|---------|---------------|
| 18 | Ravish | `add json-server db and package configuration` | `db.json`, `package.json` |
| 19 | Aditya | `add start scripts in package.json` | `package.json` |
| 20 | Ravish | `convert storage helper to async fetch api` | `js/storage.js` |
| 21 | Radhika | `update auth flow for async backend` | `js/auth.js` |
| 22 | Aditya | `update teams module to use async api` | `js/teams.js` |
| 23 | Ravish | `update services module for async api` | `js/services.js` |
| 24 | Radhika | `update incidents logic for async api` | `js/incidents.js` |
| 25 | Ravish | `update health checker to save via api` | `js/health.js` |
| 26 | Radhika | `update audit logs for async database` | `js/audit.js` |
| 27 | Aditya | `update admin panel for async operations` | `js/admin.js`, `js/utils.js` |
| 28 | Radhika | `add company registration flow` | `register.html`, `js/auth.js` |
| 29 | Aditya | `add company invite code generation` | `signup.html`, `js/admin.js` |
| 30 | Aditya | `fix invite code validation bug in admin` | `js/admin.js` |
| 31 | Radhika | `add cross team dependency escalation logic` | `js/incidents.js` |
| 32 | Radhika | `add notification trail popup on dashboard` | `dashboard.html`, `js/incidents.js` |
| 33 | Ravish | `add styling for cross team badges and alerts` | `css/style.css` |
| 34 | Aditya | `release v1.0 multi-tenant edition` | `README.md`, `docs/GIT_COMMITS.md` |

---

## Phase 2 — Live Health Probes, Backend Proxy & Hardening

| Commit # | Member | Message | Files Changed |
|:--------:|--------|---------|---------------|
| 35 | Ravish | `add node proxy server on port 3002` | `proxy-server.js` |
| 36 | Ravish | `add support for post and json probe payload` | `proxy-server.js`, `js/services.js` |
| 37 | Aditya | `add request body editor in service modal` | `services.html`, `admin.html` |
| 38 | Ravish | `fix proxy payload forwarding bug` | `js/health.js`, `proxy-server.js` |
| 39 | Ravish | `patch json-server null foreign key crash` | `node_modules/.../mixins.js`, `js/storage.js` |
| 40 | Radhika | `fix directional visibility in incident list` | `js/incidents.js` |
| 41 | Ravish | `add polling backoff and auto recovery resolve` | `js/health.js` |
| 42 | Radhika | `add role based popup filter and incident resolve` | `js/incidents.js` |
| 43 | Aditya | `add live probe status indicator in service modal` | `services.html`, `js/admin.js` |
| 44 | Aditya | `update readme deployment and proxy guide` | `README.md`, `docs/` |
| 45 | Aditya | `code cleanup and final release checks` | `js/utils.js`, `README.md` |
| 46 | Aditya | `release v2.0 final production build` | `README.md`, `docs/GIT_BRANCHES_AND_COMMITS.md` |

---

## Member Contribution Summary

| Member | Role | Phase 0 | Phase 1 | Phase 2 | Total Commits | Files & Modules Owned |
|:-------|:-----|:-------:|:-------:|:-------:|:-------------:|:----------------------|
| **Aditya** | **Team Lead & Architecture** | 7 | 6 | 6 | **19** | `teams.js`, `admin.js`, `utils.js`, `admin.html`, `signup.html`, `trigger.html`, `platform-admin.html`, `README.md`, `docs/` |
| **Ravish** | **Backend & Core Systems** | 5 | 5 | 5 | **15** | `storage.js`, `services.js`, `health.js`, `proxy-server.js`, `style.css`, `db.json`, `package.json` |
| **Radhika** | **Incident Engine & RBAC** | 5 | 5 | 2 | **12** | `auth.js`, `incidents.js`, `audit.js`, `dashboard.html`, `index.html`, `audit.html`, `register.html` |

> 📖 **Full Git Flow & Branch Specification:** See [docs/GIT_BRANCHES_AND_COMMITS.md](file:///Users/aditya/Downloads/oncall-b2b-ca1%203/docs/GIT_BRANCHES_AND_COMMITS.md) for branch topology, pull requests, and branch ownership.
