
var healthCheckState = {};

var healthEngineInterval = null;

var healthDisplayInterval = null;

var HEALTH_CHECK_TIMEOUT_MS = 6000;

function startHealthCheckEngine() {
  if (healthEngineInterval) clearInterval(healthEngineInterval);

  healthEngineInterval = setInterval(function() {
    runDueHealthChecks();
  }, 1000);

  runDueHealthChecks();
}

async function startHealthMonitor() {
  if (healthDisplayInterval) clearInterval(healthDisplayInterval);

  await renderHealthMonitor();

  healthDisplayInterval = setInterval(async function() {
    await renderHealthMonitor();
  }, 2000);

  startHealthCheckEngine();
}

async function runDueHealthChecks() {
  var companyId = getCurrentCompanyId();
  if (!companyId) return;

  var services;
  try {
    services = await api.get('services', { companyId: companyId });
  } catch (e) {
    console.warn('[HealthEngine] Could not fetch services:', e);
    return;
  }

  if (!services || services.length === 0) return;

  var now = Date.now();

  for (var i = 0; i < services.length; i++) {
    var svc = services[i];
    if (!svc.healthEndpoint) continue;

    var normalIntervalMs = (svc.checkIntervalSeconds || 120) * 1000;
    var intervalMs = (svc.status === 'down')
      ? Math.max(normalIntervalMs * 3, 60000)
      : normalIntervalMs;

    var state = healthCheckState[svc.id];

    if (!state) {

      healthCheckState[svc.id] = { lastCheckedAt: now };
      performHealthCheck(svc);
    } else if (now - state.lastCheckedAt >= intervalMs) {

      healthCheckState[svc.id].lastCheckedAt = now;
      performHealthCheck(svc);
    }
  }
}

var HEALTH_PROXY_URL = 'http://localhost:3002';

async function performHealthCheck(service) {
  var method = (service.checkMethod || 'GET').toUpperCase();
  var url = service.healthEndpoint;

  if (!url || url.startsWith('/')) {
    console.warn('[HealthEngine] Skipping non-HTTP endpoint:', url);
    return;
  }

  console.log('[HealthEngine] Checking ' + service.name + ' → ' + method + ' ' + url);

  var isHealthy = false;
  var errorDetail = null;

  try {
    var proxyPayload = {
      url: url,
      method: method
    };
    if (service.requestBody && method !== 'GET' && method !== 'HEAD') {
      var bodyStr = typeof service.requestBody === 'object'
        ? JSON.stringify(service.requestBody)
        : String(service.requestBody);

      try { JSON.parse(bodyStr); } catch(e) { bodyStr = JSON.stringify({ _healthCheck: true }); }
      proxyPayload.body = bodyStr;
    }

    var response = await fetch(HEALTH_PROXY_URL + '/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proxyPayload)
    });
    var result = await response.json();

    isHealthy = result.ok;
    errorDetail = isHealthy ? null : (result.error || (result.status ? 'HTTP ' + result.status : 'Service unreachable'));

    if (isHealthy) {
      console.log('[HealthEngine] ' + service.name + ' returned ' + result.status + ' (healthy)');
    } else {
      console.log('[HealthEngine] ' + service.name + ' returned ' + (result.status || 0) + ' (' + errorDetail + ')');
    }
  } catch (err) {

    isHealthy = false;
    errorDetail = 'Proxy error (' + err.message + ')';
    console.warn('[HealthEngine] Proxy unreachable, cannot check ' + service.name + ':', err.message);
  }

  await handleCheckResult(service, isHealthy, errorDetail);
}

async function handleCheckResult(service, isHealthy, errorDetail) {

  var currentService;
  try {
    currentService = await api.getById('services', service.id);
  } catch (e) {
    console.warn('[HealthEngine] Could not fetch service state:', e);
    return;
  }

  var previousStatus = currentService.status || 'healthy';

  if (isHealthy) {

    if (previousStatus !== 'healthy') {
      console.log('[HealthEngine] ' + service.name + ' has recovered — auto-resolving open incidents');
      try {
        var companyId = getCurrentCompanyId();
        var allIncidents = await api.get('incidents', { companyId: companyId, serviceId: service.id });
        var openIncidents = allIncidents.filter(function(inc) {
          return inc.status !== 'resolved';
        });

        for (var ri = 0; ri < openIncidents.length; ri++) {
          try {
            await api.patch('incidents', openIncidents[ri].id, {
              status: 'resolved',
              resolvedAt: new Date().toISOString(),
              resolvedBy: 'Health Monitor (Auto-Recovery)'
            });
            if (typeof logAction === 'function') {
              await logAction('INCIDENT_RESOLVED', 'Incident auto-resolved: service ' + service.name + ' recovered', openIncidents[ri].id, 'Health Monitor (System)', companyId);
            }
          } catch (e) { console.warn('[HealthEngine] Could not auto-resolve incident:', e); }
        }

        await api.patch('services', service.id, { status: 'healthy', lastError: null });
        if (openIncidents.length > 0) {
          showToast && showToast(service.name + ' is back online — incidents auto-resolved', 'success');
        }
      } catch (e) {
        console.warn('[HealthEngine] Error during auto-resolve:', e);
      }
    } else {
      try {
        await api.patch('services', service.id, { lastError: null });
      } catch (e) {}
    }
    console.log('[HealthEngine] ' + service.name + ' is healthy');
  } else {

    var errText = errorDetail || 'Service unreachable';
    console.log('[HealthEngine] ' + service.name + ' check FAILED: ' + errText);

    if (previousStatus === 'healthy') {

      if (typeof logAction === 'function') {
        var companyId = getCurrentCompanyId();
        await logAction('HEALTH_CHECK_FAILED', 'Health check failed for service ' + service.name + ': ' + errText + ' (' + (service.checkMethod || 'GET') + ' ' + service.healthEndpoint + ')', service.id, 'Health Monitor (System)', companyId);
      }

      try {
        var companyId = getCurrentCompanyId();
        var existingIncidents = await api.get('incidents', { companyId: companyId, serviceId: service.id });
        var openExisting = existingIncidents.filter(function(inc) {
          return inc.status !== 'resolved';
        });

        if (openExisting.length === 0) {
          console.log('[HealthEngine] Creating auto-incident for ' + service.name + ' (' + errText + ')');

          await api.patch('services', service.id, { status: 'down', lastError: errText });

          if (typeof createIncident === 'function') {
            await createIncident(
              service.name + ' - ' + errText,
              service.id,
              'critical',
              'Automated health check detected that ' + service.name + ' failed with ' + errText + '. ' +
              'Check method: ' + (service.checkMethod || 'GET') + ', Endpoint: ' + service.healthEndpoint
            );
          }
        } else {
          console.log('[HealthEngine] ' + service.name + ' already has open incident(s), skipping creation');
        }
      } catch (e) {
        console.warn('[HealthEngine] Error during incident check/creation:', e);
      }
    } else {

      try {
        await api.patch('services', service.id, { status: 'down', lastError: errText });
      } catch (e) {  }
    }
  }

  await renderHealthMonitor();
}

async function renderHealthMonitor() {
  var container = document.getElementById('health-monitor-list');
  if (!container) return;

  var currentUser = getCurrentUser();
  var services = await getAllServices();

  if (currentUser && (currentUser.role === 'junior' || currentUser.role === 'senior') && currentUser.teamId) {
    services = services.filter(function(svc) {
      return svc.teamId === currentUser.teamId;
    });
  }

  if (services.length === 0) {
    container.innerHTML = '<div class="empty-state">No services registered for your team.</div>';
    return;
  }

  var html = '<div style="display: flex; flex-direction: column; gap: 0;">';

  services.forEach(function(svc) {
    var state = svc.status || 'healthy';
    var colorClass = state === 'healthy' ? 'health-dot--healthy' : (state === 'degraded' ? 'health-dot--degraded' : 'health-dot--down');
    var pulse = state === 'down' ? 'pulse-border' : '';
    var badgeClass = state === 'healthy' ? 'badge--healthy' : (state === 'degraded' ? 'badge--medium' : 'badge--critical');

    var errorLine = (state === 'down' && svc.lastError)
      ? '<div style="font-size:0.7rem; color:var(--status-critical); font-weight:600; margin-top:2px;">' + svc.lastError + '</div>'
      : '';

    var lastCheckInfo = '';
    var checkState = healthCheckState[svc.id];
    if (checkState && checkState.lastCheckedAt) {
      var elapsed = Math.round((Date.now() - checkState.lastCheckedAt) / 1000);
      lastCheckInfo = '<span style="font-size:0.7rem; color:var(--text-subtle); margin-left:auto; white-space:nowrap; margin-right:8px;">checked ' + elapsed + 's ago</span>';
    }

    html +=
      '<div class="list-item" style="padding-left:0; padding-right:0;">' +
        '<div style="display:flex; align-items:center; gap: 0.75rem; flex:1; min-width:0;">' +
          '<div class="health-dot ' + colorClass + ' ' + pulse + '" title="' + state + '"></div>' +
          '<div style="min-width:0; flex:1;">' +
            '<div style="font-weight: 500; color: var(--text-main);">' + svc.name + '</div>' +
            errorLine +
          '</div>' +
          lastCheckInfo +
        '</div>' +
        '<span class="badge ' + badgeClass + '">' + state + '</span>' +
      '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}
