
var http = require('http');
var https = require('https');
var urlModule = require('url');

var PROXY_PORT = 3002;
var REQUEST_TIMEOUT_MS = 6000;

var server = http.createServer(function(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  var parsed = urlModule.parse(req.url, true);

  if (parsed.pathname !== '/proxy') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /proxy?url=...&method=GET' }));
    return;
  }

  function processProxy(targetUrl, method, customBody) {
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required "url" parameter' }));
      return;
    }

    var target;
    try {
      target = new URL(targetUrl);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL: ' + targetUrl }));
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

    console.log('[Proxy] ' + method + ' ' + targetUrl + (bodyData ? ' [Payload: ' + bodyData.substring(0, 100) + '...]' : ''));

    var proxyReq = lib.request(options, function(proxyRes) {
      if (res.headersSent) return;
      var statusCode = proxyRes.statusCode;
      var isOk = statusCode >= 200 && statusCode < 400;
      var statusPhrase = http.STATUS_CODES[statusCode] || '';
      var errorDesc = isOk ? null : ('HTTP ' + statusCode + (statusPhrase ? ' (' + statusPhrase + ')' : ''));

      console.log('[Proxy] ' + targetUrl + ' → ' + statusCode + (isOk ? ' (healthy)' : ' (unhealthy: ' + errorDesc + ')'));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: statusCode,
        statusText: statusPhrase,
        ok: isOk,
        url: targetUrl,
        method: method,
        error: errorDesc
      }));

      proxyRes.resume();
    });

    proxyReq.on('error', function(err) {
      if (res.headersSent) return;
      console.log('[Proxy] ' + targetUrl + ' → ERROR: ' + err.message);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 0,
        ok: false,
        url: targetUrl,
        method: method,
        error: err.message
      }));
    });

    proxyReq.on('timeout', function() {
      if (res.headersSent) return;
      console.log('[Proxy] ' + targetUrl + ' → TIMEOUT after ' + REQUEST_TIMEOUT_MS + 'ms');
      proxyReq.destroy();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 0,
        ok: false,
        url: targetUrl,
        method: method,
        error: 'Request timed out after ' + REQUEST_TIMEOUT_MS + 'ms'
      }));
    });

    if (bodyData) {
      proxyReq.write(bodyData);
    }

    proxyReq.end();
  }

  if (req.method === 'POST') {
    var rawBody = '';
    req.on('data', function(chunk) { rawBody += chunk; });
    req.on('end', function() {
      var postData = {};
      try {
        if (rawBody) postData = JSON.parse(rawBody);
      } catch(e) {}
      var targetUrl = postData.url || parsed.query.url;
      var method = (postData.method || parsed.query.method || 'GET').toUpperCase();
      var customBody = postData.body !== undefined ? postData.body : parsed.query.body;
      processProxy(targetUrl, method, customBody);
    });
  } else {
    var targetUrl = parsed.query.url;
    var method = (parsed.query.method || 'GET').toUpperCase();
    var customBody = parsed.query.body;
    processProxy(targetUrl, method, customBody);
  }
});

server.listen(PROXY_PORT, function() {
  console.log('');
  console.log('  Health Check Proxy running on http://localhost:' + PROXY_PORT);
  console.log('  Usage: /proxy?url=https://example.com/health&method=GET');
  console.log('');
});
