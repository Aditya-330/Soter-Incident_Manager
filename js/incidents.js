
var SLA_MAP = {
  critical: 5,
  high: 15,
  medium: 30,
  low: 60
};

var slaInterval = null;

var currentSort = { column: 'status', direction: 'asc' };

async function getAllIncidents() {
  var companyId = getCurrentCompanyId();
  if (!companyId) return [];
  return api.get('incidents', { companyId: companyId });
}

async function getOnCallUser(teamId) {
  var members = await getTeamMembers(teamId);
  if (members.length === 0) return null;

  var tierOrder = ['junior', 'senior', 'teamadmin', 'company_admin', 'superadmin'];

  members.sort(function(a, b) {
    return tierOrder.indexOf(a.role) - tierOrder.indexOf(b.role);
  });

  return members[0];
}

async function createSingleIncident(title, serviceId, severity, description, assignTo, isCrossTeam, triggeredForServiceId, rootCauseServiceId) {
  var companyId = getCurrentCompanyId();
  var now = Date.now();

  var slaMinutes = SLA_MAP[severity] || 60;
  var slaDeadline = now + (slaMinutes * 60 * 1000);

  var assignedUserId = assignTo || null;
  if (!assignedUserId && serviceId) {
    try {
      var svc = await api.getById('services', serviceId);
      if (svc && svc.teamId) {
        var onCall = await getOnCallUser(svc.teamId);
        if (onCall) assignedUserId = onCall.id;
      }
    } catch (e) {
      console.warn('[Incident] Could not auto-assign on-call user:', e);
    }
  }

  var newIncident = {
    id: generateId(),
    companyId: companyId,
    title: title,
    description: description || '',
    serviceId: serviceId,
    severity: severity,
    status: 'open',
    escalationTier: 'junior',
    assignedUserId: assignedUserId,
    createdAt: new Date(now).toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
    slaDeadline: new Date(slaDeadline).toISOString(),
    slaBreached: false,
    isCrossTeam: isCrossTeam || false,
    triggeredForServiceId: triggeredForServiceId || null,
    rootCauseServiceId: rootCauseServiceId || null
  };

  await api.post('incidents', newIncident);

  try {
    await api.patch('services', serviceId, { status: 'down' });
  } catch (e) {
    console.warn('[Incident] Could not update service health:', e);
  }

  if (typeof logAction === 'function') {
    var currentUser = getCurrentUser();
    var userName = currentUser ? currentUser.name : 'System';
    await logAction('INCIDENT_CREATED', 'Incident created: ' + title, newIncident.id, userName, companyId);
  }

  return newIncident;
}

async function createIncident(title, serviceId, severity, description, assignTo) {

  var primary = await createSingleIncident(title, serviceId, severity, description, assignTo, false, null, null);

  if (typeof logEscalation === 'function') {
    var onCall = null;
    try {
      var svc = await api.getById('services', serviceId);
      if (svc.teamId) {
        onCall = await getOnCallUser(svc.teamId);
      }
    } catch (e) {  }

    await logEscalation(primary.id, 'INCIDENT_CREATED', onCall ? onCall.id : null, 'Primary incident created for ' + title);
  }

  try {
    var notifiedSet = new Set(); 
    var dependents = await getReverseDependencies(serviceId, new Set());

    for (var i = 0; i < dependents.length; i++) {
      var dep = dependents[i];

      if (notifiedSet.has(dep.serviceId)) continue;
      notifiedSet.add(dep.serviceId);

      var depService = dep.service;

      var depOnCall = null;
      if (depService.teamId) {
        depOnCall = await getOnCallUser(depService.teamId);
      }

      var crossTitle = '[CROSS-TEAM] ' + title + ' — affects: ' + depService.name;
      var crossDesc = 'Service ' + depService.name + ' depends on the failing service. ' +
                      'A cross-team incident has been created because a dependency failure may impact this service.';

      var crossIncident = await createSingleIncident(
        crossTitle,
        dep.serviceId,
        severity,
        crossDesc,
        depOnCall ? depOnCall.id : null,
        true,                  
        serviceId,             
        serviceId              
      );

      if (typeof logEscalation === 'function') {
        await logEscalation(
          crossIncident.id,
          'CROSS_TEAM_NOTIFIED',
          depOnCall ? depOnCall.id : null,
          'Cross-team notification: ' + depService.name + ' team notified about dependency on failing service'
        );
      }

      if (typeof logAction === 'function') {
        await logAction('CROSS_TEAM_NOTIFIED', 'Cross-team incident created for ' + depService.name + ' due to dependency on ' + title, crossIncident.id, 'System', getCurrentCompanyId());
      }
    }
  } catch (e) {
    console.warn('[CrossTeam] Error during dependency graph walk:', e);
  }

  try {
    var primarySvc = await api.getById('services', serviceId);
    var primaryAssigned = primary.assignedUserId ? await api.getById('users', primary.assignedUserId) : null;
    var primaryAssignedLabel = primaryAssigned ? primaryAssigned.name + ' (' + (primaryAssigned.role === 'junior' ? 'SDE I' : (primaryAssigned.role === 'senior' ? 'SDE II' : 'Tech Lead')) + ')' : null;
    showIncidentPopup(primary, primarySvc, primaryAssignedLabel);
  } catch (e) {}

  if (typeof updateStatsBar === 'function') await updateStatsBar();
  if (typeof updateNotificationBadge === 'function') await updateNotificationBadge();

  return primary;
}

async function updateIncidentStatus(id, newStatus) {
  var inc = await api.getById('incidents', id);

  if (inc.status === 'resolved') return inc;

  var oldStatus = inc.status;
  var updateData = { status: newStatus };

  if (newStatus === 'resolved') {
    var currentUser = getCurrentUser();
    updateData.resolvedAt = new Date().toISOString();
    updateData.resolvedBy = currentUser ? currentUser.name : 'Unknown User';

    var allInc = await getAllIncidents();
    var otherOpen = allInc.filter(function(other) {
      return other.serviceId === inc.serviceId && other.id !== inc.id && other.status !== 'resolved';
    });
    if (otherOpen.length === 0) {
      try {
        await api.patch('services', inc.serviceId, { status: 'healthy' });
      } catch (e) {  }
    }
  }

  if (newStatus === 'acknowledged' && oldStatus !== 'acknowledged') {
    var currentUser = getCurrentUser();
    updateData.acknowledgedAt = new Date().toISOString();
    updateData.acknowledgedBy = currentUser ? currentUser.name : 'Unknown User';
  }

  var updated = await api.patch('incidents', id, updateData);

  if (typeof logAction === 'function') {
    var currentUser = getCurrentUser();
    var userName = currentUser ? currentUser.name : 'System';
    var action = newStatus === 'resolved' ? 'INCIDENT_RESOLVED' : 'INCIDENT_ACKNOWLEDGED';
    await logAction(action, 'Incident ' + id + ' marked as ' + newStatus, id, userName, getCurrentCompanyId());
  }

  if (typeof logEscalation === 'function') {
    var eventType = newStatus === 'resolved' ? 'INCIDENT_RESOLVED' : 'INCIDENT_ACKNOWLEDGED';
    var currentUser = getCurrentUser();
    await logEscalation(id, eventType, currentUser ? currentUser.id : null, 'Status changed to ' + newStatus);
  }

  if (typeof updateStatsBar === 'function') await updateStatsBar();
  if (typeof updateNotificationBadge === 'function') await updateNotificationBadge();

  return updated;
}

async function handleStatusChange(id, newStatus) {
  await updateIncidentStatus(id, newStatus);
  await renderIncidentList('incident-list');
  showToast('Incident status updated to ' + newStatus + '.', 'success');
}

async function resolveSelectedIncidents() {
  var checkboxes = document.querySelectorAll('.incident-checkbox:checked');
  if (checkboxes.length === 0) {
    showToast('No incidents selected.', 'error');
    return;
  }

  var ids = [];
  checkboxes.forEach(function(cb) { ids.push(cb.value); });

  if (typeof showConfirmModal === 'function') {
    showConfirmModal('Resolve ' + ids.length + ' incident(s)?', async function() {
      for (var i = 0; i < ids.length; i++) {
        await updateIncidentStatus(ids[i], 'resolved');
      }
      await renderIncidentList('incident-list');
      showToast(ids.length + ' incident(s) resolved.', 'success');
    });
  } else {
    if (confirm('Resolve ' + ids.length + ' incident(s)?')) {
      for (var i = 0; i < ids.length; i++) {
        await updateIncidentStatus(ids[i], 'resolved');
      }
      await renderIncidentList('incident-list');
      showToast(ids.length + ' incident(s) resolved.', 'success');
    }
  }
}

function toggleSelectAll(checked) {
  var checkboxes = document.querySelectorAll('.incident-checkbox');
  checkboxes.forEach(function(cb) { cb.checked = checked; });
}

function sortIncidents(incidents) {
  var statusOrder = { open: 0, acknowledged: 1, escalated: 2, resolved: 3 };
  var severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

  return incidents.sort(function(a, b) {
    var valA, valB;
    if (currentSort.column === 'status') {
      valA = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 9;
      valB = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 9;
      if (valA === valB) {
        valA = new Date(b.createdAt).getTime();
        valB = new Date(a.createdAt).getTime();
      }
    } else if (currentSort.column === 'severity') {
      valA = severityOrder[a.severity];
      valB = severityOrder[b.severity];
    } else if (currentSort.column === 'date') {
      valA = new Date(a.createdAt).getTime();
      valB = new Date(b.createdAt).getTime();
    }

    if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
    if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
    return 0;
  });
}

async function setSort(column) {
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.direction = 'asc';
  }
  await renderIncidentList('incident-list');
}

function formatDuration(start, end) {
  var ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms)) return '00:00';
  if (ms < 0) ms = 0;
  var totalSec = Math.floor(ms / 1000);
  var min = Math.floor(totalSec / 60);
  var sec = totalSec % 60;
  return (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
}

function getTimerPercent(createdAt, deadline) {
  var start = new Date(createdAt).getTime();
  var end = new Date(deadline).getTime();
  var now = Date.now();
  var total = end - start;
  var elapsed = now - start;
  var pct = 100 - ((elapsed / total) * 100);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

function startSLATimers() {
  if (slaInterval) clearInterval(slaInterval);

  slaInterval = setInterval(function() {
    var timerEls = document.querySelectorAll('.sla-timer-text[data-deadline]');
    var barEls = document.querySelectorAll('.sla-timer-bar-fill');
    var now = Date.now();
    var reRenderNeeded = false;

    timerEls.forEach(function(el, index) {
      if (!el.dataset.deadline) return;
      var deadline = new Date(el.dataset.deadline).getTime();
      var createdAt = new Date(el.dataset.created).getTime();
      var id = el.dataset.id;
      var tier = el.dataset.tier || 'junior';

      if (now > deadline) {
        if (tier !== 'company_admin' && tier !== 'superadmin' && tier !== 'platform_superadmin') {

          if (el.dataset.breached === 'false') {
            el.dataset.breached = 'true'; 
            escalateIncident(id);
            reRenderNeeded = true;
          }
        } else {
          el.textContent = "SLA Breached (No higher escalations)";
          el.style.color = 'var(--status-critical)';
          if (el.dataset.breached === 'false') {
            el.dataset.breached = 'true';
            markSlaBreached(id);
          }
        }
      } else {
        el.textContent = "SLA: " + formatDuration(now, deadline) + " left";
      }

      if (barEls[index]) {
        var pct = getTimerPercent(createdAt, deadline);
        barEls[index].style.width = pct + '%';
        if (pct < 25) {
          barEls[index].style.background = 'var(--status-critical)';
        } else if (pct < 50) {
          barEls[index].style.background = 'var(--status-high)';
        }
      }
    });

    if (reRenderNeeded) {
      renderIncidentList('incident-list');
    }

  }, 1000);
}

async function escalateIncident(id) {
  var nextTierMap = {
    'junior': 'senior',
    'senior': 'teamadmin',
    'teamadmin': 'company_admin'
  };

  var inc = await api.getById('incidents', id);

  if (inc.status === 'open' && inc.escalationTier !== 'company_admin' && inc.escalationTier !== 'superadmin') {
    var nextTier = nextTierMap[inc.escalationTier || 'junior'] || 'company_admin';

    var now = Date.now();
    var slaMinutes = SLA_MAP[inc.severity] || 60;
    var slaDeadline = now + (slaMinutes * 60 * 1000);

    var nextUser = null;
    if (inc.serviceId) {
      try {
        var svc = await api.getById('services', inc.serviceId);
        if (svc && svc.teamId) {
          var teamMembers = await getTeamMembers(svc.teamId);
          nextUser = teamMembers.find(function(m) { return m.role === nextTier; });
        }
      } catch (e) {}
    }

    var nextUserName = nextUser ? nextUser.name : null;
    var nextUserId = nextUser ? nextUser.id : null;
    var tierLabel = nextTier === 'junior' ? 'SDE I' : (nextTier === 'senior' ? 'SDE II' : (nextTier === 'teamadmin' ? 'Tech Lead' : 'Admin'));

    await api.patch('incidents', id, {
      escalationTier: nextTier,
      assignedUserId: nextUserId || inc.assignedUserId,
      slaDeadline: new Date(slaDeadline).toISOString()
    });

    var noteText = 'Auto-escalated from ' + (inc.escalationTier || 'junior') + ' to ' + nextTier + (nextUserName ? ' (' + nextUserName + ' - ' + tierLabel + ')' : '');

    if (typeof logAction === 'function') {
      await logAction('INCIDENT_ESCALATED', noteText + ' due to SLA timeout', id, 'System', getCurrentCompanyId());
    }

    if (typeof logEscalation === 'function') {
      await logEscalation(id, 'INCIDENT_ESCALATED', nextUserId, noteText);
    }

    showToast('Incident automatically escalated to ' + nextTier + (nextUserName ? ' (' + nextUserName + ')' : '') + '!', 'warning');
  }
}

async function markSlaBreached(id) {
  var inc = await api.getById('incidents', id);
  if (!inc.slaBreached) {
    await api.patch('incidents', id, { slaBreached: true });

    if (typeof logAction === 'function') {
      await logAction('SLA_BREACHED', 'SLA deadline breached for incident ' + id, id, 'System', getCurrentCompanyId());
    }

    if (typeof logEscalation === 'function') {
      await logEscalation(id, 'SLA_BREACHED', null, 'SLA breached — no further escalation tiers available');
    }
  }
}

async function renderNotificationTrail(incidentId) {
  var logs = await api.get('escalationLogs', { incidentId: incidentId });
  var companyId = getCurrentCompanyId();
  var users = companyId ? await api.get('users', { companyId: companyId }) : [];

  if (logs.length === 0) return '<p class="text-muted" style="font-size:0.8rem;">No escalation history.</p>';

  logs.sort(function(a, b) {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  var html = '<div class="notification-trail">';
  for (var i = 0; i < logs.length; i++) {
    var log = logs[i];
    var eventClass = '';
    if (log.eventType === 'CROSS_TEAM_NOTIFIED') eventClass = 'trail-entry--cross-team';
    else if (log.eventType === 'INCIDENT_ESCALATED') eventClass = 'trail-entry--escalated';
    else if (log.eventType === 'INCIDENT_RESOLVED') eventClass = 'trail-entry--resolved';
    else if (log.eventType === 'INCIDENT_ACKNOWLEDGED') eventClass = 'trail-entry--acked';

    var userName = 'System';
    if (log.userId) {
      var user = users.find(function(u) { return u.id === log.userId; });
      if (user) {
        var roleBadge = user.role === 'junior' ? 'SDE I' : (user.role === 'senior' ? 'SDE II' : (user.role === 'teamadmin' ? 'Tech Lead' : 'Company Admin'));
        userName = user.name + ' (' + roleBadge + ')';
      }
    }

    var timeStr = typeof getRelativeTime === 'function' ? getRelativeTime(log.timestamp) : new Date(log.timestamp).toLocaleString();

    html +=
      '<div class="trail-entry ' + eventClass + '">' +
        '<div class="trail-entry__dot"></div>' +
        '<div class="trail-entry__content">' +
          '<span class="trail-entry__type">' + log.eventType.replace(/_/g, ' ') + '</span>' +
          '<span class="trail-entry__time">' + timeStr + '</span>' +
          '<div class="trail-entry__note">' + (log.note || '') + '</div>' +
          '<div class="trail-entry__user">By / Assigned: ' + userName + '</div>' +
        '</div>' +
      '</div>';
  }
  html += '</div>';
  return html;
}

async function renderIncidentList(containerId, filters) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var incidents = await getAllIncidents();
  var services = await getAllServices();
  var teams = await getAllTeams();
  var companyId = getCurrentCompanyId();
  var allCompanyUsers = companyId ? await api.get('users', { companyId: companyId }) : [];
  var depGraph = companyId ? await api.get('dependencyGraph', { companyId: companyId }) : [];

  var currentUser = getCurrentUser();
  if (currentUser) {
    var roleWeight = { 'junior': 1, 'senior': 2, 'teamadmin': 3, 'company_admin': 4, 'superadmin': 4, 'platform_superadmin': 5 };
    var userWeight = roleWeight[currentUser.role] || 0;

    var myTeamServiceIds = services.filter(function(s) { return s.teamId === currentUser.teamId; }).map(function(s) { return s.id; });

    var relatedDepServiceIds = new Set();
    depGraph.forEach(function(edge) {
      // Upstream: services my team depends on
      if (myTeamServiceIds.indexOf(edge.fromServiceId) !== -1) {
        relatedDepServiceIds.add(edge.toServiceId);
      }
      // Downstream: services that depend on my team
      if (myTeamServiceIds.indexOf(edge.toServiceId) !== -1) {
        relatedDepServiceIds.add(edge.fromServiceId);
      }
    });

    incidents = incidents.filter(function(inc) {
      var incTier = inc.escalationTier || 'junior';
      var incWeight = roleWeight[incTier] || 1;

      if (userWeight >= 4) return true;

      if (inc.assignedUserId && inc.assignedUserId === currentUser.id) {
        return true;
      }

      var isPrimary = myTeamServiceIds.indexOf(inc.serviceId) !== -1;

      var isDepInvolved = false;
      if (inc.isCrossTeam) {
        if (myTeamServiceIds.indexOf(inc.serviceId) !== -1 || relatedDepServiceIds.has(inc.serviceId) || (inc.rootCauseServiceId && myTeamServiceIds.indexOf(inc.rootCauseServiceId) !== -1)) {
          isDepInvolved = true;
        }
      }

      if (relatedDepServiceIds.has(inc.serviceId)) {
        isDepInvolved = true;
      }

      if (!isPrimary && !isDepInvolved) {
        return false;
      }

      if (currentUser.role === 'teamadmin') return true;

      return userWeight >= incWeight;
    });
  }

  if (filters) {
    incidents = incidents.filter(function(inc) {
      var match = true;
      if (filters.search && !inc.title.toLowerCase().includes(filters.search.toLowerCase())) match = false;
      if (filters.status && inc.status !== filters.status) match = false;
      if (filters.severity && inc.severity !== filters.severity) match = false;
      return match;
    });
  }

  if (incidents.length === 0) {
    container.innerHTML = '<p class="empty-state">No incidents match your criteria.</p>';
    return;
  }

  incidents = sortIncidents(incidents);

  var unackedOpen = incidents.filter(function(inc) {
    return inc.status === 'open' && (inc.severity === 'critical' || inc.severity === 'high');
  });
  if (unackedOpen.length > 0) {
    var topInc = unackedOpen[0];
    if (!poppedIncidentIds.has(topInc.id)) {
      var topSvc = services.find(function(s) { return s.id === topInc.serviceId; });
      var topAssigned = topInc.assignedUserId ? allCompanyUsers.find(function(u) { return u.id === topInc.assignedUserId; }) : null;
      var topAssignedName = topAssigned ? topAssigned.name + ' (' + (topAssigned.role === 'junior' ? 'SDE I' : (topAssigned.role === 'senior' ? 'SDE II' : 'Tech Lead')) + ')' : null;

      var shouldPopup = true;
      if (currentUser && topAssigned) {
        var assignedWeight = roleWeight[topAssigned.role] || 1;
        var myWeight = roleWeight[currentUser.role] || 1;

        shouldPopup = (currentUser.id === topInc.assignedUserId) || (myWeight > assignedWeight);
      }

      if (shouldPopup) {
        showIncidentPopup(topInc, topSvc, topAssignedName);
      } else {

        poppedIncidentIds.add(topInc.id);
      }
    }
  }

  var html = '';
  for (var idx = 0; idx < incidents.length; idx++) {
    var inc = incidents[idx];
    var svcMatches = services.filter(function(s) { return s.id === inc.serviceId; });
    var service = svcMatches.length > 0 ? svcMatches[0] : null;
    var serviceName = service ? service.name : 'Unknown Service';

    var teamMatches = service ? teams.filter(function(t) { return t.id === service.teamId; }) : [];
    var teamName = teamMatches.length > 0 ? teamMatches[0].name : 'Unassigned Team';

    var assignedName = 'Unassigned';
    if (inc.assignedUserId) {
      var assignedUser = allCompanyUsers.find(function(u) { return u.id === inc.assignedUserId; });
      if (assignedUser) {
        var roleLabel = assignedUser.role === 'junior' ? 'SDE I' : (assignedUser.role === 'senior' ? 'SDE II' : (assignedUser.role === 'teamadmin' ? 'Tech Lead' : 'Admin'));
        assignedName = assignedUser.name + ' (' + roleLabel + ')';
      }
    }

    var date = new Date(inc.createdAt);
    var timeStr = date.toLocaleString();
    var relativeTimeStr = typeof getRelativeTime === 'function' ? getRelativeTime(inc.createdAt) : timeStr;

    var crossTeamBadge = '';
    if (inc.isCrossTeam) {
      crossTeamBadge = '<span class="badge badge--cross-team" style="margin-left:8px; white-space:nowrap; flex-shrink:0;">Dependency Alert</span>';
    }

    var statusDropdown = '';
    if (inc.status === 'open') {
      statusDropdown =
        '<select class="form-select form-select--sm" style="width:auto; min-width:140px;" onchange="handleStatusChange(\'' + inc.id + '\', this.value)">' +
          '<option value="open" selected>Open</option>' +
          '<option value="acknowledged">Acknowledged</option>' +
          '<option value="resolved">Resolved</option>' +
        '</select>';
    } else if (inc.status === 'acknowledged') {

      statusDropdown =
        '<select class="form-select form-select--sm" style="width:auto; min-width:140px;" onchange="handleStatusChange(\'' + inc.id + '\', this.value)">' +
          '<option value="acknowledged" selected>Acknowledged</option>' +
          '<option value="resolved">Resolve</option>' +
        '</select>';
    }

    var checkboxHtml = '';
    if (inc.status !== 'resolved') {
      checkboxHtml = '<input type="checkbox" class="incident-checkbox" value="' + inc.id + '" style="margin-right:10px;">';
    }

    var timerHtml = '';
    if (inc.status === 'open') {
      var breached = inc.slaBreached ? 'true' : 'false';
      var textClass = inc.slaBreached ? 'sla-timer-text sla-breached' : 'sla-timer-text';
      var textStr = inc.slaBreached ? 'SLA Breached' : 'Calculating...';

      timerHtml =
        '<div class="sla-timer-container">' +
          '<div class="' + textClass + '" data-id="' + inc.id + '" data-created="' + inc.createdAt + '" data-deadline="' + inc.slaDeadline + '" data-breached="' + breached + '">' + textStr + '</div>' +
          '<div class="sla-timer-bar"><div class="sla-timer-bar-fill"></div></div>' +
        '</div>';
    } else if (inc.status === 'acknowledged') {

      var ackTime = formatDuration(inc.createdAt, inc.acknowledgedAt || new Date().toISOString());
      var ackByUser = inc.acknowledgedBy ? ' by ' + inc.acknowledgedBy : '';
      timerHtml =
        '<div style="background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25); border-radius:var(--radius-sm); padding:0.4rem 0.65rem; margin:0.75rem 0 0.5rem; display:flex; justify-content:space-between; align-items:center; font-size:0.75rem;">' +
          '<span style="color:var(--status-low); font-weight:600;">Acknowledged' + ackByUser + ' &bull; In Progress</span>' +
          '<span class="mono text-muted" style="font-size:0.7rem;">Acked in ' + ackTime + '</span>' +
        '</div>';
    } else {
      var resTime = formatDuration(inc.createdAt, inc.resolvedAt || new Date().toISOString());
      var byUserStr = inc.resolvedBy ? ' by ' + inc.resolvedBy : '';
      timerHtml = '<div class="sla-timer-resolved" style="color:var(--status-healthy); font-weight:600; font-size:0.75rem; font-family:var(--font-mono, monospace); margin:0.75rem 0 0.5rem;">Resolved in ' + resTime + byUserStr + '</div>';
    }

    var pulseClass = inc.severity === 'critical' && inc.status === 'open' ? 'pulse-border' : '';
    var crossTeamClass = inc.isCrossTeam ? 'card--cross-team' : '';

    var ackText = '';
    if (inc.status === 'acknowledged' && inc.acknowledgedBy) {
      ackText = '<span style="font-size:0.8rem; color:var(--text-muted); margin-left:8px;">by ' + inc.acknowledgedBy + '</span>';
    }

    var trailToggle = '<button class="btn btn--sm btn--outline" onclick="toggleTrail(\'' + inc.id + '\')" style="font-size:0.75rem; padding:0.2rem 0.65rem;">View Trail</button>';
    var trailContainer = '<div id="trail-' + inc.id + '" class="trail-container" style="display:none;"></div>';

    html +=
      '<div class="card card--incident ' + pulseClass + ' ' + crossTeamClass + '">' +
        '<div class="card__header-row" style="flex-wrap: nowrap; gap: 0.75rem; align-items: center;">' +
          '<div style="display:flex; align-items:center; min-width:0; flex:1; gap:0.5rem;">' +
            checkboxHtml +
            '<h3 class="card__title" style="margin:0; min-width:0; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + inc.title + '">' + inc.title + '</h3>' +
            crossTeamBadge +
          '</div>' +
          '<span class="badge badge--' + inc.severity + '" style="flex-shrink:0;">' + inc.severity + '</span>' +
        '</div>' +
        '<p class="card__text" style="font-size:0.825rem; margin-bottom:0.35rem;">Service: <strong>' + serviceName + '</strong> <span style="font-size:0.75rem; color:var(--text-muted);">(' + teamName + ')</span></p>' +
        '<p class="card__text" style="font-size:0.8125rem; margin-bottom:0.35rem;"><span style="color:var(--text-muted);">Assigned Responder:</span> <strong>' + assignedName + '</strong></p>' +
        '<p class="card__text text-muted" style="font-size:0.775rem;" title="' + timeStr + '">Created: ' + relativeTimeStr + '</p>' +
        timerHtml +
        '<div class="card__footer" style="margin-top:0.625rem; justify-content:space-between; align-items:center; flex-wrap:nowrap; gap:0.75rem;">' +
          '<div style="display:flex; align-items:center; gap:0.625rem; flex-wrap:wrap;">' +
            '<span class="badge badge--status-' + inc.status + '">' + inc.status + '</span>' +
            ackText +
            trailToggle +
          '</div>' +
          statusDropdown +
        '</div>' +
        trailContainer +
      '</div>';
  }

  container.innerHTML = html;

  startSLATimers();
}

var poppedIncidentIds = new Set();

function showIncidentPopup(inc, service, responderName) {
  if (!inc || poppedIncidentIds.has(inc.id)) return;
  poppedIncidentIds.add(inc.id);

  if (document.getElementById('incident-popup-modal')) return;

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'incident-popup-modal';
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.65); backdrop-filter:blur(4px); z-index:9999; display:flex; align-items:center; justify-content:center; padding:1.5rem;';

  var modal = document.createElement('div');
  modal.className = 'card';
  modal.style.cssText = 'max-width:520px; width:100%; padding:1.75rem; border-radius:var(--radius-lg); position:relative; box-shadow:0 20px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.5); border:2px solid var(--status-critical);';

  var serviceName = service ? service.name : 'Unknown Service';
  var endpoint = (service && service.healthEndpoint) ? service.healthEndpoint : '';
  var sev = (inc.severity || 'critical').toUpperCase();

  modal.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem; border-bottom:1px solid var(--border-light); padding-bottom:0.75rem;">' +
      '<div style="display:flex; align-items:center; gap:0.5rem;">' +
        '<span class="health-dot health-dot--down" style="width:12px; height:12px;"></span>' +
        '<h2 style="font-size:1.15rem; font-weight:800; margin:0; color:var(--status-critical);">Incident Alert</h2>' +
      '</div>' +
      '<span class="badge badge--' + inc.severity + '" style="font-size:0.75rem; padding:2px 8px;">' + sev + '</span>' +
    '</div>' +

    '<div style="margin-bottom:1.25rem;">' +
      '<h3 style="font-size:1rem; font-weight:700; margin-bottom:0.35rem; color:var(--text-main);">' + inc.title + '</h3>' +
      '<p class="text-muted" style="font-size:0.8rem; margin-bottom:0.75rem; line-height:1.4;">' + (inc.description || '') + '</p>' +

      '<div style="background:var(--bg-base); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:0.75rem; display:flex; flex-direction:column; gap:0.4rem; font-size:0.8rem;">' +
        '<div style="display:flex; justify-content:space-between;">' +
          '<span style="color:var(--text-muted);">Affected Service:</span>' +
          '<strong>' + serviceName + '</strong>' +
        '</div>' +
        (endpoint ? 
          '<div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; overflow:hidden;">' +
            '<span style="color:var(--text-muted); flex-shrink:0;">Endpoint:</span>' +
            '<span class="mono" style="font-size:0.725rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + endpoint + '</span>' +
          '</div>' : '') +
        '<div style="display:flex; justify-content:space-between;">' +
          '<span style="color:var(--text-muted);">Assigned Responder:</span>' +
          '<strong style="color:var(--text-main);">' + (responderName || 'On-Call Engineer') + '</strong>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div style="display:flex; justify-content:flex-end; gap:0.75rem;">' +
      '<button class="btn btn--outline" id="popup-dismiss-btn">Dismiss</button>' +
      '<button class="btn btn--primary" id="popup-ack-btn">Acknowledge Incident</button>' +
    '</div>';

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById('popup-dismiss-btn').onclick = function() { overlay.remove(); };
  document.getElementById('popup-ack-btn').onclick = async function() {
    overlay.remove();
    await updateIncidentStatus(inc.id, 'acknowledged');
    showToast('Incident acknowledged!', 'success');
    if (typeof renderIncidentList === 'function') {
      await renderIncidentList('incident-list');
    }
  };
}

async function toggleTrail(incidentId) {
  var container = document.getElementById('trail-' + incidentId);
  if (!container) return;

  if (container.style.display === 'none') {
    container.style.display = 'block';
    container.innerHTML = '<p class="text-muted" style="font-size:0.8rem;">Loading...</p>';
    var trailHtml = await renderNotificationTrail(incidentId);
    container.innerHTML = trailHtml;
  } else {
    container.style.display = 'none';
  }
}

async function updateStatsBar() {
  var container = document.getElementById('stats-bar');
  if (!container) return;

  var currentUser = getCurrentUser();
  var incidents = await getAllIncidents();
  var services = await getAllServices();

  if (currentUser && currentUser.teamId) {
    var roleWeight = { 'junior': 1, 'senior': 2, 'teamadmin': 3, 'company_admin': 4, 'superadmin': 4, 'platform_superadmin': 5 };
    var userWeight = roleWeight[currentUser.role] || 0;

    if (userWeight < 4) {
      incidents = incidents.filter(function(inc) {
        var svcMatches = services.filter(function(s) { return s.id === inc.serviceId; });
        var svc = svcMatches.length > 0 ? svcMatches[0] : null;
        if (!svc || svc.teamId !== currentUser.teamId) return false;

        if (currentUser.role === 'teamadmin') return true;

        var incTier = inc.escalationTier || 'junior';
        var incWeight = roleWeight[incTier] || 1;
        return userWeight >= incWeight;
      });
    }
  }

  var open = incidents.filter(function(i) { return i.status !== 'resolved'; });
  var resolved = incidents.filter(function(i) { return i.status === 'resolved'; });
  var critical = open.filter(function(i) { return i.severity === 'critical'; });

  var acked = incidents.filter(function(i) { return i.acknowledgedAt; });
  var avgTTA = 'N/A';
  if (acked.length > 0) {
    var totalMs = 0;
    acked.forEach(function(i) {
      totalMs += new Date(i.acknowledgedAt).getTime() - new Date(i.createdAt).getTime();
    });
    var avgSec = Math.round((totalMs / acked.length) / 1000);
    avgTTA = avgSec < 60 ? avgSec + 's' : Math.round(avgSec / 60) + 'm ' + (avgSec % 60) + 's';
  }

  container.innerHTML =
    '<div class="card" style="text-align:center; padding:1.25rem 1rem;">' +
      '<div style="font-size:1.75rem; font-weight:700; color:var(--text-main);" class="mono">' + open.length + '</div>' +
      '<div class="text-subtle" style="font-size:0.75rem;">Open Incidents</div>' +
    '</div>' +
    '<div class="card" style="text-align:center; padding:1.25rem 1rem;">' +
      '<div style="font-size:1.75rem; font-weight:700; color:var(--status-critical);" class="mono">' + critical.length + '</div>' +
      '<div class="text-subtle" style="font-size:0.75rem;">Critical / Active</div>' +
    '</div>' +
    '<div class="card" style="text-align:center; padding:1.25rem 1rem;">' +
      '<div style="font-size:1.75rem; font-weight:700; color:var(--text-main);" class="mono">' + avgTTA + '</div>' +
      '<div class="text-subtle" style="font-size:0.75rem;">Avg Time to Ack</div>' +
    '</div>' +
    '<div class="card" style="text-align:center; padding:1.25rem 1rem;">' +
      '<div style="font-size:1.75rem; font-weight:700; color:var(--status-healthy);" class="mono">' + resolved.length + '</div>' +
      '<div class="text-subtle" style="font-size:0.75rem;">Resolved Total</div>' +
    '</div>';
}

function updateNotificationBadge() {
  var badge = document.getElementById('incident-count-badge');
  if (!badge) return;
  var currentUser = getCurrentUser();
  Promise.all([getAllIncidents(), getAllServices()]).then(function(results) {
    var incidents = results[0];
    var services = results[1];

    if (currentUser && (currentUser.role === 'junior' || currentUser.role === 'senior') && currentUser.teamId) {
      incidents = incidents.filter(function(inc) {
        var svcMatches = services.filter(function(s) { return s.id === inc.serviceId; });
        return svcMatches.length > 0 && svcMatches[0].teamId === currentUser.teamId;
      });
    }

    var open = incidents.filter(function(i) { return i.status !== 'resolved'; });
    badge.textContent = open.length + ' Open';
  });
}

async function renderDashboardTeamSummary() {
  var container = document.getElementById('dashboard-team-summary');
  if (!container) return;

  var currentUser = getCurrentUser();
  var teams = await getAllTeams();

  if (currentUser && (currentUser.role === 'junior' || currentUser.role === 'senior') && currentUser.teamId) {
    teams = teams.filter(function(t) { return t.id === currentUser.teamId; });
  }

  if (teams.length === 0) {
    container.innerHTML = '<span class="text-muted" style="font-size:0.8125rem;">No teams configured yet.</span>';
    return;
  }

  var html = '';
  for (var i = 0; i < teams.length; i++) {
    var team = teams[i];
    var members = await getTeamMembers(team.id);
    html +=
      '<div style="display:flex; justify-content:space-between; align-items:center; padding:0.375rem 0; border-bottom:1px solid var(--border-light);">' +
        '<span style="font-weight:500; color:var(--text-main); font-size:0.8125rem;">' + team.name + '</span>' +
        '<span class="badge">' + members.length + ' on-call</span>' +
      '</div>';
  }
  container.innerHTML = html;
}
