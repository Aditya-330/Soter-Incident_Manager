
async function initAdminPage() {
  await populateTeamDropdowns();
  await populateDependsOnCheckboxes();
  await renderUserDirectory();

  if (typeof renderTeamList === 'function') await renderTeamList('admin-team-list');
  if (typeof renderServiceList === 'function') await renderServiceList('admin-service-list');

  if (hasPermission('company_admin')) {
    await renderInviteCodes();
  }

  var teamForm = document.getElementById('add-team-form');
  if (teamForm) {
    teamForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      var name = document.getElementById('team-name').value.trim();
      var desc = document.getElementById('team-description').value.trim();

      if (!name) {
        showToast('Team name is required.', 'error');
        return;
      }

      var existingTeams = await getAllTeams();
      var isDuplicate = existingTeams.some(function(t) {
        return t.name.trim().toLowerCase() === name.toLowerCase();
      });
      if (isDuplicate) {
        showToast('A team named "' + name + '" already exists.', 'error');
        return;
      }

      await addTeam(name, desc);
      showToast('Team "' + name + '" created successfully!', 'success');
      teamForm.reset();

      await populateTeamDropdowns();
      await populateDependsOnCheckboxes();
      await renderTeamList('admin-team-list');
    });
  }

  var adminProvForm = document.getElementById('admin-provision-member-form');
  if (adminProvForm) {
    adminProvForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      var name = document.getElementById('admin-member-name').value.trim();
      var email = document.getElementById('admin-member-email').value.trim();
      var password = document.getElementById('admin-member-password').value;
      var role = document.getElementById('admin-member-role').value;
      var teamId = document.getElementById('admin-member-team').value;

      if (!name || !email || !password || !teamId) {
        showToast('Please fill out all developer details and select a team.', 'error');
        return;
      }

      try {
        if (typeof createAndAssignMember === 'function') {
          await createAndAssignMember(name, email, password, role, teamId);
          var roleLabel = role === 'junior' ? 'SDE I' : (role === 'senior' ? 'SDE II' : 'Tech Lead');
          showToast('Developer ' + name + ' (' + roleLabel + ') provisioned successfully!', 'success');
          adminProvForm.reset();
          await renderUserDirectory();
          await populateMemberUserDropdown();
          if (typeof renderTeamList === 'function') await renderTeamList('admin-team-list');
        }
      } catch(ex) {
        showToast(ex.message || 'Error provisioning developer.', 'error');
      }
    });
  }

  var serviceForm = document.getElementById('add-service-form');
  if (serviceForm) {
    var checkMethodSelect = document.getElementById('service-check-method');
    var bodyGroup = document.getElementById('service-body-group');
    if (checkMethodSelect && bodyGroup) {
      checkMethodSelect.addEventListener('change', function() {
        bodyGroup.style.display = checkMethodSelect.value === 'GET' ? 'none' : 'block';
      });
    }

    serviceForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      var name = document.getElementById('service-name').value.trim();
      var teamId = document.getElementById('service-team').value;
      var healthEndpoint = document.getElementById('service-health-endpoint').value.trim();
      var checkMethod = document.getElementById('service-check-method').value || 'GET';
      var checkIntervalSeconds = document.getElementById('service-check-interval').value || '120';
      var bodyRaw = document.getElementById('service-body') ? document.getElementById('service-body').value.trim() : '';

      var dependsOn = [];
      var checkboxes = document.querySelectorAll('.dep-checkbox:checked');
      checkboxes.forEach(function(cb) {
        dependsOn.push(cb.value);
      });

      if (!name || !teamId || !healthEndpoint) {
        showToast('Name, Health Endpoint, and Team are required.', 'error');
        return;
      }

      if (checkMethod !== 'GET' && !document.getElementById('service-check-interval').value) {
        showToast('Check interval is required for ' + checkMethod + ' methods.', 'error');
        return;
      }

      var requestBody = null;
      if (checkMethod !== 'GET' && bodyRaw) {
        try {
          JSON.parse(bodyRaw);
          requestBody = bodyRaw;
        } catch(ex) {
          showToast('Invalid JSON in Request Body: ' + ex.message, 'error');
          return;
        }
      }

      await addService(name, teamId, dependsOn, healthEndpoint, checkMethod, parseInt(checkIntervalSeconds), requestBody);
      showToast('Service "' + name + '" registered successfully!', 'success');
      serviceForm.reset();
      if (bodyGroup) bodyGroup.style.display = 'none';

      await populateDependsOnCheckboxes();
      await renderServiceList('admin-service-list');
    });
  }

  var memberForm = document.getElementById('add-member-form');
  if (memberForm) {
    await populateMemberUserDropdown();
    memberForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      var userId = document.getElementById('member-user').value;
      var teamId = document.getElementById('manage-team-select').value;

      if (!userId || !teamId) {
        showToast('Please select both a user and a team.', 'error');
        return;
      }

      await assignMemberToTeam(userId, teamId);
      showToast('Member assigned successfully.', 'success');

      await renderTeamMembers(teamId);
      await renderUserDirectory();
      await renderTeamList('admin-team-list');
      await populateMemberUserDropdown();
    });
  }

  var manageTeamSelect = document.getElementById('manage-team-select');
  if (manageTeamSelect) {
    manageTeamSelect.addEventListener('change', async function(e) {
      await renderTeamMembers(e.target.value);
    });

    if (manageTeamSelect.value) {
      await renderTeamMembers(manageTeamSelect.value);
    }
  }
}

async function populateTeamDropdowns() {
  var teams = await getAllTeams();
  var currentUser = getCurrentUser();
  var html = '<option value="">-- Select a Team --</option>';

  teams.forEach(function(team) {
    html += '<option value="' + team.id + '">' + team.name + '</option>';
  });

  var serviceTeamDropdown = document.getElementById('service-team');
  var provTeamDropdown = document.getElementById('admin-member-team');
  var manageTeamDropdown = document.getElementById('manage-team-select');

  if (currentUser && currentUser.role === 'teamadmin' && currentUser.teamId) {
    var myTeam = teams.filter(function(t) { return t.id === currentUser.teamId; })[0];
    var teamAdminHtml = myTeam ? '<option value="' + myTeam.id + '" selected>' + myTeam.name + ' (Your Team)</option>' : '<option value="">-- Error: You have no team --</option>';

    if (serviceTeamDropdown) serviceTeamDropdown.innerHTML = teamAdminHtml;
    if (provTeamDropdown) provTeamDropdown.innerHTML = teamAdminHtml;
    if (manageTeamDropdown) manageTeamDropdown.innerHTML = teamAdminHtml;
  } else {
    if (serviceTeamDropdown) serviceTeamDropdown.innerHTML = html;
    if (provTeamDropdown) provTeamDropdown.innerHTML = html;
    if (manageTeamDropdown) manageTeamDropdown.innerHTML = html;
  }
}

async function populateMemberUserDropdown() {
  var select = document.getElementById('member-user');
  if (!select) return;

  var companyId = getCurrentCompanyId();
  var users = await api.get('users', { companyId: companyId });

  var availableUsers = users.filter(function(u) {
    return u.teamId === null && u.role !== 'company_admin' && u.role !== 'superadmin' && u.role !== 'platform_superadmin';
  });

  var html = '<option value="">-- Select a User --</option>';
  availableUsers.forEach(function(u) {
    html += '<option value="' + u.id + '">' + u.name + ' (' + u.role + ')</option>';
  });

  select.innerHTML = html;
}

async function renderTeamMembers(teamId) {
  var container = document.getElementById('team-members-list');
  if (!container) return;

  if (!teamId) {
    container.innerHTML = '<p class="text-muted">Select a team to view members.</p>';
    return;
  }

  var members = await getTeamMembers(teamId);
  if (members.length === 0) {
    container.innerHTML = '<p class="text-muted">No members in this team.</p>';
    return;
  }

  var html = '<ul style="list-style:none; padding:0; margin:0;">';
  members.forEach(function(m) {
    html +=
      '<li style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid var(--border-color);">' +
        '<div>' +
          '<strong>' + m.name + '</strong> ' +
          '<span class="badge badge--' + m.role + '" style="margin-left:8px;">' + m.role + '</span>' +
        '</div>' +
        '<button class="btn btn--sm btn--danger" onclick="handleRemoveMember(\'' + m.id + '\', \'' + teamId + '\')">Remove</button>' +
      '</li>';
  });
  html += '</ul>';

  container.innerHTML = html;
}

async function handleRemoveMember(userId, teamId) {
  if (typeof showConfirmModal === 'function') {
    showConfirmModal('Remove this user from the team?', async function() {
      await removeMemberFromTeam(userId);
      await renderTeamMembers(teamId);
      await renderUserDirectory();
      await renderTeamList('admin-team-list');
      await populateMemberUserDropdown();
      showToast('Member removed from team.', 'success');
    });
  } else {
    if (confirm('Remove this user from the team?')) {
      await removeMemberFromTeam(userId);
      await renderTeamMembers(teamId);
      await renderUserDirectory();
      await renderTeamList('admin-team-list');
      await populateMemberUserDropdown();
      showToast('Member removed from team.', 'success');
    }
  }
}

async function populateDependsOnCheckboxes() {
  var container = document.getElementById('depends-on-list');
  if (!container) return;

  var services = await getAllServices();
  var teams = await getAllTeams();

  if (services.length === 0) {
    container.innerHTML = '<span style="color:var(--text-subtle); font-size:0.85rem;">No other services registered yet.</span>';
    return;
  }

  var html = '';
  services.forEach(function(svc) {
    var teamMatches = teams.filter(function(t) { return t.id === svc.teamId; });
    var teamName = teamMatches.length > 0 ? teamMatches[0].name : 'Unknown Team';

    html +=
      '<label style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.4rem; padding:0.3rem 0.5rem; border-radius:var(--radius-sm); background:var(--bg-base); cursor:pointer;">' +
        '<div style="display:flex; align-items:center; gap:0.5rem;">' +
          '<input type="checkbox" class="dep-checkbox" value="' + svc.id + '">' +
          '<span style="font-weight:600; font-size:0.85rem; color:var(--text-main);">' + svc.name + '</span>' +
        '</div>' +
        '<span class="badge badge--info" style="font-size:0.65rem;">' + teamName + '</span>' +
      '</label>';
  });

  container.innerHTML = html;
}

async function renderUserDirectory() {
  var container = document.getElementById('user-directory');
  if (!container) return;

  var companyId = getCurrentCompanyId();
  var users = await api.get('users', { companyId: companyId });
  var teams = await getAllTeams();

  var html =
    '<table style="width:100%; border-collapse: collapse; text-align: left;">' +
      '<thead>' +
        '<tr style="border-bottom: 1px solid var(--border-color);">' +
          '<th style="padding: 0.75rem;">Name</th>' +
          '<th style="padding: 0.75rem;">Email</th>' +
          '<th style="padding: 0.75rem;">Role</th>' +
          '<th style="padding: 0.75rem;">Team</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>';

  users.forEach(function(user) {
    var teamName = 'None';
    if (user.teamId) {
      var match = teams.filter(function(t) { return t.id === user.teamId; });
      if (match.length > 0) teamName = match[0].name;
    }

    var roleLabel = user.role === 'junior' ? 'SDE I (Junior)' : (user.role === 'senior' ? 'SDE II (Senior)' : (user.role === 'teamadmin' ? 'Tech Lead' : (user.role === 'company_admin' ? 'Company Admin' : (user.role === 'platform_superadmin' ? 'Platform Admin' : user.role))));

    html +=
      '<tr style="border-bottom: 1px solid var(--border-color);">' +
        '<td style="padding: 0.75rem; font-weight:600;">' + user.name + '</td>' +
        '<td style="padding: 0.75rem; color: var(--text-muted);">' + user.email + '</td>' +
        '<td style="padding: 0.75rem;"><span class="badge badge--' + user.role + '">' + roleLabel + '</span></td>' +
        '<td style="padding: 0.75rem;">' + teamName + '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

async function generateInviteCode() {
  var companyId = getCurrentCompanyId();
  var currentUser = getCurrentUser();
  var code = 'INV-' + Math.random().toString(36).substring(2, 8).toUpperCase();

  await api.post('inviteCodes', {
    id: generateId(),
    companyId: companyId,
    code: code,
    createdBy: currentUser.id,
    createdAt: new Date().toISOString()
  });

  showToast('New invite code generated: ' + code, 'success');
  await renderInviteCodes();
}

async function renderInviteCodes() {
  var container = document.getElementById('invite-codes-list');
  if (!container) return;

  var companyId = getCurrentCompanyId();
  var codes = await api.get('inviteCodes', { companyId: companyId });

  if (codes.length === 0) {
    container.innerHTML = '<p class="text-muted">No invite codes yet.</p>';
    return;
  }

  var html = '<ul style="list-style:none; padding:0; margin:0;">';
  codes.forEach(function(c) {
    html +=
      '<li style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid var(--border-color);">' +
        '<div>' +
          '<code style="background:var(--bg-surface-hover); padding:4px 8px; border-radius:4px; font-size:0.9rem;">' + c.code + '</code>' +
          '<span class="text-muted" style="margin-left:8px; font-size:0.8rem;">Created ' + (c.createdAt && typeof getRelativeTime === 'function' ? getRelativeTime(c.createdAt) : (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : 'at setup')) + '</span>' +
        '</div>' +
        '<button class="btn btn--sm btn--outline" onclick="copyInviteCode(\'' + c.code + '\')">Copy</button>' +
      '</li>';
  });
  html += '</ul>';

  container.innerHTML = html;
}

function copyInviteCode(code) {
  navigator.clipboard.writeText(code).then(function() {
    showToast('Invite code copied: ' + code, 'success');
  }).catch(function() {
    showToast('Failed to copy. Code: ' + code, 'error');
  });
}
