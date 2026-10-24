'use strict';

/**
 * Health-check proxy route — /proxy (GET and POST)
 *
 * CRITICAL: This endpoint's response contract is consumed by js/health.js
 * in the frontend. The contract MUST remain unchanged:
 *
 *   Response always HTTP 200 (even on outbound errors), JSON:
 *   {
 *     status:     <number>  HTTP status from target, or 0 on error/timeout
 *     statusText: <string>  HTTP status text
 *     ok:         <boolean> true if status 200-399
 *     url:        <string>  the requested URL
 *     method:     <string>  HTTP method used
 *     error:      <string|null> error message, or null on success
 *   }
 *
 * SSRF Protection:
 *   - Only http:// and https:// protocols allowed
 *   - Private/loopback/link-local IP ranges are blocked
 *   - Hostnames that resolve to private IPs are blocked via dns lookup
 *   - Maximum body size enforced
 *   - Rate-limited at the Express level (see server.js)
 */

const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const express = require('express');

const router = express.Router();

const REQUEST_TIMEOUT_MS = 6000; // matches original

// --- SSRF Blocklist ---

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal', // GCP metadata
  '169.254.169.254',          // AWS/GCP/Azure metadata
  '100.100.100.200',          // Alibaba Cloud metadata
]);

// Returns true if the IP is in a private/loopback/link-local range
function isPrivateOrReservedIP(ip) {
  // IPv6 loopback
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return true;

  // Block ALL IPv6 addresses that are not explicitly safe public.
  // IPv4-mapped IPv6 (::ffff:x.x.x.x) could bypass IPv4 private-range checks,
  // so strip the prefix and fall through to IPv4 validation below.
  // Any other non-IPv4 address is blocked outright.
  let normalised = ip;
  if (ip.startsWith('::ffff:') || ip.startsWith('::FFFF:')) {
    // Strip the IPv4-mapped prefix and check as IPv4
    normalised = ip.slice(7);
  } else if (ip.includes(':')) {
    // Any other IPv6 address: block by default for safety
    return true;
  }

  // IPv4 checks (also covers IPv4-mapped IPv6 after stripping above)
  const parts = normalised.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true; // malformed

  const [a, b] = parts;
  if (a === 10) return true;                              // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                // 192.168.0.0/16
  if (a === 127) return true;                             // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;                // 169.254.0.0/16 link-local
  if (a === 100 && b >= 64 && b <= 127) return true;     // 100.64.0.0/10 CGNAT
  if (a === 0) return true;                               // 0.0.0.0/8
  if (a === 198 && (b === 18 || b === 19)) return true;  // 198.18.0.0/15 benchmarking
  if (a === 192 && b === 0 && parts[2] === 2) return true; // 192.0.2.0/24 TEST-NET
  if (a === 203 && b === 0 && parts[2] === 113) return true; // 203.0.113.0/24 TEST-NET
  if (a === 233 && b === 252 && parts[2] === 0) return true;  // 233.252.0.0/24 documentation
  if (a >= 224) return true;                              // 224.0.0.0/4 multicast + 240+ reserved

  return false;
}

async function isSafeTarget(parsedUrl) {
  const hostname = parsedUrl.hostname;

  // Block disallowed protocols (only http/https allowed)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { safe: false, reason: `Protocol "${parsedUrl.protocol}" is not allowed` };
  }

  // Block known dangerous hostnames
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    return { safe: false, reason: 'Blocked hostname' };
  }

  // If hostname is an IP, check it directly
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      return { safe: false, reason: 'Private or reserved IP address not allowed' };
    }
    return { safe: true };
  }

  // Resolve hostname to IP and check
  try {
    const { address } = await dns.lookup(hostname, { family: 4 });
    if (isPrivateOrReservedIP(address)) {
      return { safe: false, reason: `Hostname resolves to private IP (${address})` };
    }
  } catch (dnsErr) {
    return { safe: false, reason: `DNS resolution failed: ${dnsErr.message}` };
  }

  return { safe: true };
}

function doProxy(targetUrl, method, customBody, res) {
  let target;
  try {
    target = new URL(targetUrl);
  } catch (e) {
    return res.status(200).json({
      status: 0,
      statusText: '',
      ok: false,
      url: targetUrl,
      method,
      error: 'Invalid URL: ' + targetUrl,
    });
  }

  const lib = target.protocol === 'https:' ? https : http;

  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + (target.search || ''),
    method,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'User-Agent': 'Soter-HealthCheck/1.0',
      'Accept': '*/*',
    },
  };

  let bodyData = null;
  if (method !== 'GET' && method !== 'HEAD') {
    if (customBody !== undefined && customBody !== null && customBody !== '') {
      bodyData = typeof customBody === 'object' ? JSON.stringify(customBody) : String(customBody);
    } else {
      bodyData = JSON.stringify({ _healthCheck: true, _ts: Date.now() });
    }
    options.headers['Content-Type'] = 'application/json';
    options.headers['Content-Length'] = Buffer.byteLength(bodyData);
  }

  const proxyReq = lib.request(options, (proxyRes) => {
    if (res.headersSent) return;
    const statusCode = proxyRes.statusCode;
    const isOk = statusCode >= 200 && statusCode < 400;
    const statusPhrase = http.STATUS_CODES[statusCode] || '';
    const errorDesc = isOk ? null : `HTTP ${statusCode}${statusPhrase ? ` (${statusPhrase})` : ''}`;

    res.status(200).json({
      status: statusCode,
      statusText: statusPhrase,
      ok: isOk,
      url: targetUrl,
      method,
      error: errorDesc,
    });

    proxyReq.destroy();
    proxyRes.resume();
  });

  proxyReq.on('error', (err) => {
    if (res.headersSent) return;
    res.status(200).json({
      status: 0,
      statusText: '',
      ok: false,
      url: targetUrl,
      method,
      error: err.message,
    });
  });

  proxyReq.on('timeout', () => {
    if (res.headersSent) return;
    proxyReq.destroy();
    res.status(200).json({
      status: 0,
      statusText: '',
      ok: false,
      url: targetUrl,
      method,
      error: `Request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    });
  });

  if (bodyData) proxyReq.write(bodyData);
  proxyReq.end();
}

// Shared handler for both GET and POST
async function handleProxy(req, res) {
  const targetUrl = (req.body && req.body.url) || req.query.url;
  const method = ((req.body && req.body.method) || req.query.method || 'GET').toUpperCase();
  const customBody = req.body && req.body.body !== undefined ? req.body.body : req.query.body;

  if (!targetUrl) {
    return res.status(200).json({
      status: 0,
      statusText: '',
      ok: false,
      url: '',
      method,
      error: 'Missing required "url" parameter',
    });
  }

  // SSRF safety check
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(200).json({
      status: 0,
      statusText: '',
      ok: false,
      url: targetUrl,
      method,
      error: 'Invalid URL: ' + targetUrl,
    });
  }

  const safetyCheck = await isSafeTarget(parsed);
  if (!safetyCheck.safe) {
    console.warn(`[Proxy] SSRF block: ${targetUrl} — ${safetyCheck.reason}`);
    return res.status(200).json({
      status: 0,
      statusText: '',
      ok: false,
      url: targetUrl,
      method,
      error: 'Target URL is not allowed: ' + safetyCheck.reason,
    });
  }

  console.log(`[Proxy] ${method} ${targetUrl}`);
  doProxy(targetUrl, method, customBody, res);
}

router.get('/', handleProxy);
router.post('/', handleProxy);

module.exports = router;
