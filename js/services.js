
async function getAllServices() {
  var companyId = getCurrentCompanyId();
  if (!companyId) return [];
  return api.get('services', { companyId: companyId });
}

async function addService(name, teamId, dependsOn, healthEndpoint, checkMethod, checkIntervalSeconds, requestBody) {
  var companyId = getCurrentCompanyId();
  var newService = {
    id: generateId(),
    companyId: companyId,
    teamId: teamId,
    name: name,
    healthEndpoint: healthEndpoint || '',
    checkMethod: (checkMethod || 'GET').toUpperCase(),
    checkIntervalSeconds: parseInt(checkIntervalSeconds) || 120,
    requestBody: requestBody !== undefined ? requestBody : null,
    status: 'healthy'
  };
  await api.post('services', newService);

  if (dependsOn && dependsOn.length > 0) {
    for (var i = 0; i < dependsOn.length; i++) {
      await api.post('dependencyGraph', {
        id: generateId(),
        companyId: companyId,
        fromServiceId: newService.id,
        toServiceId: dependsOn[i]
      });
    }
  }

  if (typeof logAction === 'function') {
    var currentUser = getCurrentUser();
    var userName = currentUser ? currentUser.name : 'System';
    await logAction('SERVICE_CREATED', 'Service "' + name + '" created (' + (checkMethod || 'GET') + ' ' + (healthEndpoint || 'no endpoint') + ', interval: ' + (checkIntervalSeconds || 120) + 's)', newService.id, userName, companyId);
  }

  return newService;
}

async function updateService(serviceId, name, teamId, dependsOn, healthEndpoint, checkMethod, checkIntervalSeconds, requestBody) {
  var companyId = getCurrentCompanyId();
  if (!companyId) throw new Error('No active company context');

  var patchData = {
    name: name,
    teamId: teamId,
    healthEndpoint: healthEndpoint || '',
    checkMethod: (checkMethod || 'GET').toUpperCase(),
    checkIntervalSeconds: parseInt(checkIntervalSeconds) || 120,
    requestBody: requestBody !== undefined ? requestBody : null
  };

  await api.patch('services', serviceId, patchData);

  var existingEdges = await api.get('dependencyGraph', { companyId: companyId, fromServiceId: serviceId });
  for (var i = 0; i < existingEdges.length; i++) {
    await api.delete('dependencyGraph', existingEdges[i].id);
  }

  if (dependsOn && dependsOn.length > 0) {
    for (var j = 0; j < dependsOn.length; j++) {
      if (dependsOn[j] !== serviceId) { 
        await api.post('dependencyGraph', {
          id: generateId(),
          companyId: companyId,
          fromServiceId: serviceId,
          toServiceId: dependsOn[j]
        });
      }
    }
  }

  if (typeof logAction === 'function') {
    var currentUser = getCurrentUser();
    var userName = currentUser ? currentUser.name : 'System';
    await logAction('SERVICE_UPDATED', 'Service "' + name + '" configuration updated', serviceId, userName, companyId);
  }
}

async function deleteService(serviceId) {
  var companyId = getCurrentCompanyId();
  var service = null;
  try {
    service = await api.getById('services', serviceId);
  } catch(e) {}
  var serviceName = service ? service.name : serviceId;

  try {
    var outgoing = await api.get('dependencyGraph', { companyId: companyId, fromServiceId: serviceId });
    for (var i = 0; i < outgoing.length; i++) {
      try { await api.delete('dependencyGraph', outgoing[i].id); } catch(e) {}
    }
  } catch(e) {}

  try {
    var incoming = await api.get('dependencyGraph', { companyId: companyId, toServiceId: serviceId });
    for (var j = 0; j < incoming.length; j++) {
      try { await api.delete('dependencyGraph', incoming[j].id); } catch(e) {}
    }
  } catch(e) {}

  await api.delete('services', serviceId);

  if (typeof logAction === 'function') {
    var currentUser = getCurrentUser();
    var userName = currentUser ? currentUser.name : 'System';
    await logAction('SERVICE_DELETED', 'Service "' + serviceName + '" deleted', serviceId, userName, companyId);
  }
}

async function getServiceDependencies(serviceId) {
  var companyId = getCurrentCompanyId();
  return api.get('dependencyGraph', { companyId: companyId, fromServiceId: serviceId });
}

async function getServiceDependents(serviceId) {
  var companyId = getCurrentCompanyId();
  return api.get('dependencyGraph', { companyId: companyId, toServiceId: serviceId });
}

async function getDependencies(serviceId, visited) {
  if (!visited) visited = new Set();
  if (visited.has(serviceId)) return []; 
  visited.add(serviceId);

  var deps = await getServiceDependencies(serviceId);
  var results = [];

  for (var i = 0; i < deps.length; i++) {
    var depServiceId = deps[i].toServiceId;
    if (visited.has(depServiceId)) continue;

    try {
      var depService = await api.getById('services', depServiceId);
      results.push({ serviceId: depServiceId, service: depService });
      var deeper = await getDependencies(depServiceId, visited);
      results = results.concat(deeper);
    } catch (e) {
      console.warn('[Services] Could not fetch dependency service:', depServiceId, e);
    }
  }

  return results;
}

async function getReverseDependencies(serviceId, visited) {
  if (!visited) visited = new Set();
  if (visited.has(serviceId)) return []; 
  visited.add(serviceId);

  var dependents = await getServiceDependents(serviceId);
  var results = [];

  for (var i = 0; i < dependents.length; i++) {
    var depServiceId = dependents[i].fromServiceId;
    if (visited.has(depServiceId)) continue;

    try {
      var depService = await api.getById('services', depServiceId);
      results.push({ serviceId: depServiceId, service: depService });
      var deeper = await getReverseDependencies(depServiceId, visited);
      results = results.concat(deeper);
    } catch (e) {
      console.warn('[Services] Could not fetch dependent service:', depServiceId, e);
    }
  }

  return results;
}

async function populateServiceDropdown(selectId) {
  var select = document.getElementById(selectId);
  if (!select) return;
  var services = await getAllServices();
  select.innerHTML = '<option value="">-- Select a service --</option>';
  services.forEach(function(svc) {
    select.innerHTML += '<option value="' + svc.id + '">' + svc.name + '</option>';
  });
}

async function renderServiceList(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var services = await getAllServices();
  var teams = await getAllTeams();
  var companyId = getCurrentCompanyId();
  var allCompanyUsers = companyId ? await api.get('users', { companyId: companyId }) : [];

  var currentUser = getCurrentUser();
  if (currentUser && (currentUser.role === 'junior' || currentUser.role === 'senior') && currentUser.teamId) {
    services = services.filter(function(s) { return s.teamId === currentUser.teamId; });
  }

  if (services.length === 0) {
    container.innerHTML = '<p class="empty-state">No services registered for your team.</p>';
    return;
  }

  var canManage = hasPermission('teamadmin');

  var html = '';
  for (var i = 0; i < services.length; i++) {
    var service = services[i];
    var teamMatches = teams.filter(function(t) { return t.id === service.teamId; });
    var teamName = teamMatches.length > 0 ? teamMatches[0].name : 'Unknown Team';

    var teamLeads = allCompanyUsers.filter(function(u) {
      return u.teamId === service.teamId && u.role === 'teamadmin';
    });
    var teamLeadName = teamLeads.length > 0 ? teamLeads[0].name : 'Unassigned';

    var deps = await getServiceDependencies(service.id);
    var depsHtml = '';
    if (deps.length > 0) {
      for (var j = 0; j < deps.length; j++) {
        var depService = services.filter(function(s) { return s.id === deps[j].toServiceId; });
        var depName = depService.length > 0 ? depService[0].name : deps[j].toServiceId;
        depsHtml += '<span class="tag">' + depName + '</span>';
      }
    } else {
      depsHtml = '<span class="text-muted">None</span>';
    }

    var statusClass = service.status === 'healthy' ? 'health-dot--healthy' : (service.status === 'degraded' ? 'health-dot--degraded' : 'health-dot--down');

    var methodStr = (service.checkMethod || 'GET').toUpperCase();
    var intervalStr = (service.checkIntervalSeconds || 120) + 's';
    var bodyBadge = (service.requestBody && methodStr !== 'GET') ? '<span class="badge" style="background:rgba(59,130,246,0.12); color:#3b82f6; font-size:0.65rem; padding:1px 5px; font-weight:600;" title="Custom JSON Request Body Configured">{ JSON Body }</span>' : '';

    var actionsHtml = '';
    if (canManage) {
      actionsHtml =
        '<div style="display:flex; gap:0.35rem; align-items:center;">' +
          '<button class="btn btn--sm btn--outline" style="height:26px; padding:0 0.55rem; font-size:0.75rem;" onclick="openEditServiceModal(\'' + service.id + '\')">Edit</button>' +
          '<button class="btn btn--sm btn--danger" style="height:26px; padding:0 0.55rem; font-size:0.75rem;" onclick="confirmDeleteService(\'' + service.id + '\', \'' + service.name.replace(/'/g, "\\'") + '\')">Delete</button>' +
        '</div>';
    }

    var errorBanner = '';
    if (service.status === 'down' || service.lastError) {
      var errText = service.lastError || 'Service Down / Unreachable';
      errorBanner =
        '<div style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:var(--radius-sm); padding:0.4rem 0.65rem; font-size:0.75rem; color:var(--status-critical); font-weight:600; display:flex; justify-content:space-between; align-items:center;">' +
          '<span>Error: ' + errText + '</span>' +
          '<span class="badge badge--critical" style="font-size:0.65rem; padding:1px 6px;">DOWN</span>' +
        '</div>';
    }

    html +=
      '<div class="card service-card" style="display:flex; flex-direction:column; justify-content:space-between; padding:1.25rem; border-radius:var(--radius-md); min-width:0; overflow:hidden;">' +
        '<div>' +
          '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; gap:0.5rem;">' +
            '<div style="display:flex; align-items:center; gap:0.5rem; min-width:0; overflow:hidden;">' +
              '<span class="health-dot ' + statusClass + '" style="flex-shrink:0;" title="' + service.status + '"></span>' +
              '<h3 style="margin:0; font-size:1.05rem; font-weight:700; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + service.name + '">' + service.name + '</h3>' +
            '</div>' +
            actionsHtml +
          '</div>' +

          '<div style="display:flex; flex-direction:column; gap:0.5rem; font-size:0.8125rem; margin-bottom:0.75rem;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">' +
              '<div style="display:flex; align-items:center; gap:0.4rem;">' +
                '<span style="color:var(--text-muted);">Team:</span>' +
                '<strong style="color:var(--text-main);">' + teamName + '</strong>' +
              '</div>' +
              '<div style="display:flex; align-items:center; gap:0.4rem;">' +
                '<span style="color:var(--text-muted);">Lead:</span>' +
                '<span style="font-weight:600; color:var(--text-main);">' + teamLeadName + '</span>' +
              '</div>' +
            '</div>' +

            '<div style="background:var(--bg-base); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:0.45rem 0.65rem; display:flex; align-items:center; justify-content:space-between; gap:0.5rem; overflow:hidden; min-width:0;">' +
              '<div style="display:flex; align-items:center; gap:0.45rem; min-width:0; flex:1; overflow:hidden;">' +
                '<span class="badge badge--info" style="font-size:0.65rem; padding:1px 6px; font-weight:700; flex-shrink:0;">' + methodStr + '</span>' +
                bodyBadge +
                '<span class="mono" style="font-size:0.75rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0;" title="' + (service.healthEndpoint || '') + '">' + (service.healthEndpoint || 'No endpoint') + '</span>' +
              '</div>' +
              '<span style="font-size:0.7rem; color:var(--text-muted); flex-shrink:0; white-space:nowrap; font-weight:500;">Every ' + intervalStr + '</span>' +
            '</div>' +
            errorBanner +
          '</div>' +
        '</div>' +

        '<div style="border-top:1px solid var(--border-light); padding-top:0.6rem; font-size:0.775rem; color:var(--text-muted); display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">' +
          '<span>Depends on:</span>' +
          '<div style="display:inline-flex; gap:0.3rem; flex-wrap:wrap;">' + depsHtml + '</div>' +
        '</div>' +
      '</div>';
  }

  container.innerHTML = html;
}

// Open Edit Service Modal
async function openEditServiceModal(serviceId) {
  var service = await api.getById('services', serviceId);
  if (!service) return;

  var allTeams = await getAllTeams();
  var allServices = await getAllServices();
  var existingDeps = await getServiceDependencies(serviceId);
  var currentDepIds = existingDeps.map(function(d) { return d.toServiceId; });

  // Remove existing modal if any
  var oldModal = document.getElementById('edit-service-modal-overlay');
  if (oldModal) oldModal.remove();

  var overlay = document.createElement('div');
  overlay.id = 'edit-service-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:9999; padding:1rem; backdrop-filter:blur(4px);';

  var modal = document.createElement('div');
  modal.className = 'card fade-in';
  modal.style.cssText = 'max-width:580px; width:100%; max-height:90vh; overflow-y:auto; padding:1.75rem; border-radius:var(--radius-lg); box-shadow:0 20px 25px -5px rgba(0,0,0,0.3);';

  // Build team options
  var teamOptionsHtml = '';
  allTeams.forEach(function(t) {
    var selected = t.id === service.teamId ? 'selected' : '';
    teamOptionsHtml += '<option value="' + t.id + '" ' + selected + '>' + t.name + '</option>';
  });

  // Build dependency checkboxes
  var otherServices = allServices.filter(function(s) { return s.id !== serviceId; });
  var depCheckboxesHtml = '';
  if (otherServices.length === 0) {
    depCheckboxesHtml = '<span style="font-size:0.8rem; color:var(--text-subtle);">No other services available.</span>';
  } else {
    otherServices.forEach(function(s) {
      var isChecked = currentDepIds.indexOf(s.id) !== -1 ? 'checked' : '';
      var teamMatches = allTeams.filter(function(t) { return t.id === s.teamId; });
      var teamName = teamMatches.length > 0 ? teamMatches[0].name : 'Unknown Team';
      depCheckboxesHtml +=
        '<label style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.35rem; padding:0.25rem 0.5rem; border-radius:var(--radius-sm); background:var(--bg-base); cursor:pointer;">' +
          '<div style="display:flex; align-items:center; gap:0.5rem;">' +
            '<input type="checkbox" class="edit-dep-checkbox" value="' + s.id + '" ' + isChecked + '>' +
            '<span style="font-weight:600; font-size:0.85rem;">' + s.name + '</span>' +
          '</div>' +
          '<span class="badge badge--info" style="font-size:0.65rem;">' + teamName + '</span>' +
        '</label>';
    });
  }

  var method = (service.checkMethod || 'GET').toUpperCase();
  var interval = service.checkIntervalSeconds || 120;

  var currentBodyStr = '';
  if (service.requestBody) {
    if (typeof service.requestBody === 'object') {
      try { currentBodyStr = JSON.stringify(service.requestBody, null, 2); } catch(e) { currentBodyStr = String(service.requestBody); }
    } else {
      try {
        currentBodyStr = JSON.stringify(JSON.parse(service.requestBody), null, 2);
      } catch(e) {
        currentBodyStr = String(service.requestBody);
      }
    }
  }

  modal.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem; border-bottom:1px solid var(--border-light); padding-bottom:0.75rem;">' +
      '<div>' +
        '<h2 style="font-size:1.25rem; font-weight:800; margin-bottom:0.2rem;">Edit Service Configuration</h2>' +
        '<p class="text-muted" style="font-size:0.8rem; margin:0;">Update health endpoint monitoring, payload schema, owning team, and dependency graph</p>' +
      '</div>' +
      '<button class="btn btn--outline btn--sm" id="close-edit-modal-btn">&times; Close</button>' +
    '</div>' +

    '<form id="edit-service-form">' +
      '<div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem;">' +
        '<div class="form-group" style="margin:0;">' +
          '<label class="form-label" for="edit-service-name">Service Name</label>' +
          '<input class="form-input" type="text" id="edit-service-name" value="' + (service.name || '').replace(/"/g, '&quot;') + '" required>' +
        '</div>' +
        '<div class="form-group" style="margin:0;">' +
          '<label class="form-label" for="edit-service-team">Owning Team</label>' +
          '<select class="form-select" id="edit-service-team" required>' +
            teamOptionsHtml +
          '</select>' +
        '</div>' +
      '</div>' +

      '<div class="form-group" style="margin-bottom:1rem;">' +
        '<label class="form-label" for="edit-service-endpoint">Health Endpoint URL</label>' +
        '<input class="form-input" type="url" id="edit-service-endpoint" value="' + (service.healthEndpoint || '').replace(/"/g, '&quot;') + '" required>' +
      '</div>' +

      '<div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem;">' +
        '<div class="form-group" style="margin:0;">' +
          '<label class="form-label" for="edit-service-method">Check Method</label>' +
          '<select class="form-select" id="edit-service-method" onchange="var g = document.getElementById(\'edit-service-body-group\'); if (g) g.style.display = this.value === \'GET\' ? \'none\' : \'block\';">' +
            '<option value="GET" ' + (method === 'GET' ? 'selected' : '') + '>GET</option>' +
            '<option value="POST" ' + (method === 'POST' ? 'selected' : '') + '>POST</option>' +
            '<option value="PUT" ' + (method === 'PUT' ? 'selected' : '') + '>PUT</option>' +
            '<option value="DELETE" ' + (method === 'DELETE' ? 'selected' : '') + '>DELETE</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group" style="margin:0;">' +
          '<label class="form-label" for="edit-service-interval">Check Interval</label>' +
          '<select class="form-select" id="edit-service-interval">' +
            '<option value="120" ' + (interval == 120 ? 'selected' : '') + '>Every 2 min (default)</option>' +
            '<option value="60" ' + (interval == 60 ? 'selected' : '') + '>Every 1 min</option>' +
            '<option value="300" ' + (interval == 300 ? 'selected' : '') + '>Every 5 min</option>' +
            '<option value="900" ' + (interval == 900 ? 'selected' : '') + '>Every 15 min</option>' +
            '<option value="1800" ' + (interval == 1800 ? 'selected' : '') + '>Every 30 min</option>' +
            '<option value="30" ' + (interval == 30 ? 'selected' : '') + '>Every 30 sec (testing)</option>' +
            '<option value="15" ' + (interval == 15 ? 'selected' : '') + '>Every 15 sec (testing)</option>' +
            '<option value="1" ' + (interval == 1 ? 'selected' : '') + '>Every 1 sec (testing)</option>' +
          '</select>' +
        '</div>' +
      '</div>' +

      '<div class="form-group" id="edit-service-body-group" style="margin-bottom:1rem; display:' + (method === 'GET' ? 'none' : 'block') + ';">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">' +
          '<label class="form-label" for="edit-service-body" style="margin:0;">Request Body (JSON Schema / Payload)</label>' +
          '<span style="font-size:0.7rem; color:var(--text-subtle);">Optional JSON payload sent with probe</span>' +
        '</div>' +
        '<textarea class="form-input mono" id="edit-service-body" rows="4" style="font-size:0.775rem; font-family:monospace; resize:vertical;" placeholder=\'{\n  "status": "ping"\n}\'>' + currentBodyStr.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>' +
      '</div>' +

      '<div class="form-group" style="margin-bottom:1.5rem;">' +
        '<label class="form-label">Upstream Dependencies (Cross-Team Escalation Graph)</label>' +
        '<div style="max-height:140px; overflow-y:auto; padding:0.75rem; background:var(--bg-surface); border-radius:var(--radius-sm); border:1px solid var(--border-color);">' +
          depCheckboxesHtml +
        '</div>' +
      '</div>' +

      '<div style="display:flex; justify-content:flex-end; gap:0.75rem;">' +
        '<button type="button" class="btn btn--outline" id="cancel-edit-btn">Cancel</button>' +
        '<button type="submit" class="btn btn--primary" id="save-edit-btn">Save Changes</button>' +
      '</div>' +
    '</form>';

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById('close-edit-modal-btn').onclick = function() { overlay.remove(); };
  document.getElementById('cancel-edit-btn').onclick = function() { overlay.remove(); };
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  var editMethodSelect = document.getElementById('edit-service-method');
  var editBodyGroup = document.getElementById('edit-service-body-group');
  if (editMethodSelect && editBodyGroup) {
    editMethodSelect.addEventListener('change', function() {
      editBodyGroup.style.display = editMethodSelect.value === 'GET' ? 'none' : 'block';
    });
  }

  document.getElementById('edit-service-form').onsubmit = async function(e) {
    e.preventDefault();
    var updatedName = document.getElementById('edit-service-name').value.trim();
    var updatedTeam = document.getElementById('edit-service-team').value;
    var updatedEndpoint = document.getElementById('edit-service-endpoint').value.trim();
    var updatedMethod = document.getElementById('edit-service-method').value;
    var updatedInterval = document.getElementById('edit-service-interval').value;
    var updatedBodyRaw = document.getElementById('edit-service-body') ? document.getElementById('edit-service-body').value.trim() : '';

    var updatedDeps = [];
    var checkboxes = document.querySelectorAll('.edit-dep-checkbox:checked');
    checkboxes.forEach(function(cb) {
      updatedDeps.push(cb.value);
    });

    if (!updatedName || !updatedTeam || !updatedEndpoint) {
      showToast('Name, Owning Team, and Health Endpoint are required.', 'error');
      return;
    }

    var updatedBody = null;
    if (updatedMethod !== 'GET' && updatedBodyRaw) {
      try {
        JSON.parse(updatedBodyRaw);
        updatedBody = updatedBodyRaw;
      } catch(ex) {
        showToast('Invalid JSON in Request Body: ' + ex.message, 'error');
        return;
      }
    }

    try {
      await updateService(serviceId, updatedName, updatedTeam, updatedDeps, updatedEndpoint, updatedMethod, updatedInterval, updatedBody);
      showToast('Service "' + updatedName + '" updated successfully!', 'success');
      overlay.remove();

      if (document.getElementById('services-catalog-list')) {
        await renderServiceList('services-catalog-list');
        if (typeof populateDependsOnCheckboxes === 'function') await populateDependsOnCheckboxes();
      }
      if (document.getElementById('admin-service-list')) {
        await renderServiceList('admin-service-list');
        if (typeof populateDependsOnCheckboxes === 'function') await populateDependsOnCheckboxes();
      }
    } catch(err) {
      showToast('Error updating service: ' + err.message, 'error');
    }
  };
}

async function confirmDeleteService(serviceId, serviceName) {
  if (confirm('Are you sure you want to delete service "' + serviceName + '"?\n\nThis will remove its automated health checks and all dependency links.')) {
    try {
      await deleteService(serviceId);
      showToast('Service "' + serviceName + '" deleted.', 'info');

      if (document.getElementById('services-catalog-list')) {
        await renderServiceList('services-catalog-list');
        if (typeof populateDependsOnCheckboxes === 'function') await populateDependsOnCheckboxes();
      }
      if (document.getElementById('admin-service-list')) {
        await renderServiceList('admin-service-list');
        if (typeof populateDependsOnCheckboxes === 'function') await populateDependsOnCheckboxes();
      }
    } catch(err) {
      showToast('Error deleting service: ' + err.message, 'error');
    }
  }
}
