
async function getAuditLogs() {
  var companyId = getCurrentCompanyId();
  if (!companyId) return [];
  return api.get('auditLogs', { companyId: companyId });
}

async function getEscalationLogs() {
  var companyId = getCurrentCompanyId();
  if (!companyId) return [];
  return api.get('escalationLogs', { companyId: companyId });
}

async function logAction(actionType, details, entityId, userName, companyId) {
  var currentUser = getCurrentUser();
  var actorRole = currentUser ? currentUser.role : null;
  var cid = companyId || getCurrentCompanyId();
  if (!cid) return; 

  var newLog = {
    id: generateId(),
    companyId: cid,
    action: actionType,
    details: details,
    entityId: entityId || null,
    userName: userName || (currentUser ? currentUser.name : 'System'),
    actorRole: actorRole,
    timestamp: new Date().toISOString()
  };

  try {
    await api.post('auditLogs', newLog);
  } catch (e) {
    console.warn('[Audit] Failed to log action:', e);
  }
}

async function logEscalation(incidentId, eventType, userId, note) {
  var currentUser = getCurrentUser();
  var actorRole = currentUser ? currentUser.role : null;

  var newLog = {
    id: generateId(),
    companyId: getCurrentCompanyId(),
    incidentId: incidentId,
    eventType: eventType,
    userId: userId || null,
    actorRole: actorRole,
    timestamp: new Date().toISOString(),
    note: note || ''
  };

  try {
    await api.post('escalationLogs', newLog);
  } catch (e) {
    console.warn('[Escalation] Failed to log event:', e);
  }
}

async function renderAuditLog(containerId, filters) {
  var container = document.getElementById(containerId);
  if (!container) return;

  var auditLogs = await getAuditLogs();
  var escalationLogs = await getEscalationLogs();
  var currentUser = getCurrentUser();
  var currentRole = currentUser ? currentUser.role : 'junior';
  var currentLevel = typeof ROLE_LEVELS !== 'undefined' ? (ROLE_LEVELS[currentRole] || 0) : 1;

  auditLogs = auditLogs.filter(function(log) {
    if (currentRole !== 'platform_superadmin') {
      if (log.userName === 'Platform Superadmin' || log.actorRole === 'platform_superadmin' || (log.details && log.details.includes('Platform Superadmin'))) {
        return false;
      }
      if (log.actorRole && typeof ROLE_LEVELS !== 'undefined') {
        var logActorLevel = ROLE_LEVELS[log.actorRole] || 0;
        if (logActorLevel > currentLevel) return false;
      }
    }
    return true;
  });

  escalationLogs = escalationLogs.filter(function(log) {
    if (currentRole !== 'platform_superadmin') {
      if (log.actorRole === 'platform_superadmin') return false;
      if (log.actorRole && typeof ROLE_LEVELS !== 'undefined') {
        var logActorLevel = ROLE_LEVELS[log.actorRole] || 0;
        if (logActorLevel > currentLevel) return false;
      }
    }
    return true;
  });

  var logs = [];

  auditLogs.forEach(function(log) {
    logs.push({
      timestamp: log.timestamp,
      action: log.action,
      userName: log.userName,
      details: log.details,
      source: 'audit'
    });
  });

  escalationLogs.forEach(function(log) {
    logs.push({
      timestamp: log.timestamp,
      action: log.eventType,
      userName: log.userId || 'System',
      details: log.note + (log.incidentId ? ' (Incident: ' + log.incidentId + ')' : ''),
      source: 'escalation'
    });
  });

  if (filters && filters.action) {
    logs = logs.filter(function(log) {
      return log.action.toLowerCase().includes(filters.action.toLowerCase());
    });
  }

  if (logs.length === 0) {
    container.innerHTML = '<p class="empty-state">No audit logs found.</p>';
    return;
  }

  logs.sort(function(a, b) {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  var html =
    '<table class="table" style="width:100%; border-collapse: collapse; text-align: left;">' +
      '<thead>' +
        '<tr style="border-bottom: 1px solid var(--border-color);">' +
          '<th style="padding: 0.75rem;">Time</th>' +
          '<th style="padding: 0.75rem;">Action</th>' +
          '<th style="padding: 0.75rem;">Source</th>' +
          '<th style="padding: 0.75rem;">User</th>' +
          '<th style="padding: 0.75rem;">Details</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>';

  logs.forEach(function(log) {
    var timeStr = new Date(log.timestamp).toLocaleString();
    var relTime = typeof getRelativeTime === 'function' ? getRelativeTime(log.timestamp) : timeStr;

    var actionStyle = '';
    if (log.action === 'SLA_BREACHED' || log.action === 'HEALTH_CHECK_FAILED') {
      actionStyle = 'color: var(--critical); font-weight: bold;';
    } else if (log.action === 'INCIDENT_RESOLVED') {
      actionStyle = 'color: var(--success);';
    } else if (log.action === 'CROSS_TEAM_NOTIFIED') {
      actionStyle = 'color: #a78bfa; font-weight: bold;';
    } else if (log.action === 'INCIDENT_ESCALATED') {
      actionStyle = 'color: var(--warning); font-weight: bold;';
    }

    var sourceBadge = log.source === 'escalation'
      ? '<span class="badge badge--cross-team" style="font-size:0.65rem;">ESC</span>'
      : '<span class="badge badge--info" style="font-size:0.65rem;">AUDIT</span>';

    html +=
      '<tr style="border-bottom: 1px solid var(--border-color);">' +
        '<td style="padding: 0.75rem; color: var(--text-muted);" title="' + timeStr + '">' + relTime + '</td>' +
        '<td style="padding: 0.75rem; ' + actionStyle + '">' + log.action + '</td>' +
        '<td style="padding: 0.75rem;">' + sourceBadge + '</td>' +
        '<td style="padding: 0.75rem; font-weight:600;">' + log.userName + '</td>' +
        '<td style="padding: 0.75rem;">' + log.details + '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}
