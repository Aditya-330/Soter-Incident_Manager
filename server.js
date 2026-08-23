var jsonServer = require('json-server');
var http = require('http');
var https = require('https');
var path = require('path');

var fs = require('fs');

var dbPath = path.join(__dirname, 'db.json');
var defaultAdmin = {
  id: '0fA-SsE-tHQ',
  companyId: '__platform__',
  name: 'Platform Admin',
  email: 'admin@soter.io',
  password: 'admin123',
  role: 'platform_superadmin',
  teamId: 'JfPkGedKBi4'
};
var defaultPlatformTeam = {
  id: 'JfPkGedKBi4',
  companyId: '__platform__',
  name: 'Platform Admin',
  description: 'Platform-level superadmin team',
  memberIds: ['0fA-SsE-tHQ']
};

function ensureSeedData() {
  try {
    var raw = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : '{}';
    var db = {};
    try { db = JSON.parse(raw); } catch(e) { db = {}; }
    var modified = false;

    var collections = ['companies', 'users', 'teams', 'services', 'dependencyGraph', 'incidents', 'escalationLogs', 'auditLogs', 'inviteCodes'];
    collections.forEach(function(col) {
      if (!Array.isArray(db[col])) { db[col] = []; modified = true; }
    });

    var adminExists = db.users.some(function(u) { return u.email === 'admin@soter.io' || u.role === 'platform_superadmin'; });
    if (!adminExists) {
      db.users.push(defaultAdmin);
      modified = true;
    }

    var teamExists = db.teams.some(function(t) { return t.id === 'JfPkGedKBi4'; });
    if (!teamExists) {
      db.teams.push(defaultPlatformTeam);
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
      console.log('[Server] Seeded platform superadmin credentials in db.json');
    }
  } catch (err) {
    console.error('[Server] Error ensuring seed data:', err);
  }
}

ensureSeedData();

var server = jsonServer.create();
var router = jsonServer.router(dbPath);
var middlewares = jsonServer.defaults({
  static: path.join(__dirname),
  cors: true
});

server.use(middlewares);
server.use(jsonServer.bodyParser);

// --- Health Check Proxy Handler ---
var REQUEST_TIMEOUT_MS = 6000;

function processProxy(targetUrl, method, customBody, res) {
  if (!targetUrl) {
    res.status(400).json({ error: 'Missing required "url" parameter' });
    return;
  }

  var target;
  try {
    target = new URL(targetUrl);
  } catch (e) {
    res.status(400).json({ error: 'Invalid URL: ' + targetUrl });
    return;
  }

  var lib = target.protocol === 'https:' ? https : http;
  var options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + (target.search || ''),
    method: method,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'User-Agent': 'Soter-HealthCheck/1.0',
      'Accept': '*/*'
    }
  };

  var bodyData = null;
  if (method !== 'GET' && method !== 'HEAD') {
    if (customBody !== undefined && customBody !== null && customBody !== '') {
      if (typeof customBody === 'object') {
        bodyData = JSON.stringify(customBody);
      } else {
        bodyData = String(customBody);
      }
    } else {
      bodyData = JSON.stringify({ _healthCheck: true, _ts: Date.now() });
    }
    options.headers['Content-Type'] = 'application/json';
    options.headers['Content-Length'] = Buffer.byteLength(bodyData);
  }

  var proxyReq = lib.request(options, function(proxyRes) {
    if (res.headersSent) return;
    var statusCode = proxyRes.statusCode;
    var isOk = statusCode >= 200 && statusCode < 400;
    var statusPhrase = http.STATUS_CODES[statusCode] || '';
    var errorDesc = isOk ? null : ('HTTP ' + statusCode + (statusPhrase ? ' (' + statusPhrase + ')' : ''));

    res.status(200).json({
      status: statusCode,
      statusText: statusPhrase,
      ok: isOk,
      url: targetUrl,
      method: method,
      error: errorDesc
    });
    proxyRes.resume();
  });

  proxyReq.on('error', function(err) {
    if (res.headersSent) return;
    res.status(200).json({
      status: 0,
      ok: false,
      url: targetUrl,
      method: method,
      error: err.message
    });
  });

  proxyReq.on('timeout', function() {
    if (res.headersSent) return;
    proxyReq.destroy();
    res.status(200).json({
      status: 0,
      ok: false,
      url: targetUrl,
      method: method,
      error: 'Request timed out after ' + REQUEST_TIMEOUT_MS + 'ms'
    });
  });

  if (bodyData) {
    proxyReq.write(bodyData);
  }
  proxyReq.end();
}

// Proxy endpoint for cross-origin health check probes
server.all('/proxy', function(req, res) {
  var targetUrl = (req.body && req.body.url) || req.query.url;
  var method = ((req.body && req.body.method) || req.query.method || 'GET').toUpperCase();
  var customBody = (req.body && req.body.body !== undefined) ? req.body.body : req.query.body;
  processProxy(targetUrl, method, customBody, res);
});

// JSON-Server router for REST API endpoints
server.use(router);

var PORT = process.env.PORT || 3001;
server.listen(PORT, function() {
  console.log('\n  Soter Incident Manager Unified Server');
  console.log('  ------------------------------------');
  console.log('  App & API:     http://localhost:' + PORT);
  console.log('  Health Proxy:  http://localhost:' + PORT + '/proxy\n');
});
