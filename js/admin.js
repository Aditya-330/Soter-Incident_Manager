// Global filter state for user directory
var userDirFilters = {
  query: '',
  role: '',
  teamId: ''
};

async function initAdminPage() {
  await populateTeamDropdowns();
  await populateDependsOnCheckboxes();
  await populateUserDirFilterDropdowns();
  await renderUserDirectory();

  if (typeof renderTeamList === 'function') await renderTeamList('admin-team-list');
  if (typeof renderServiceList === 'function') await renderServiceList('admin-service-list');

  if (hasPermission('company_admin')) {
    await renderInviteCodes();
  }

  // Search & Filter event listeners for User Directory
  var searchInput = document.getElementById('user-dir-search');
  if (searchInput) {
    searchInput.addEventListener('input', function(e) {
      userDirFilters.query = e.target.value.trim().toLowerCase();
      renderUserDirectory();
    });
  }

  var roleFilter = document.getElementById('user-dir-role-filter');
  if (roleFilter) {
    roleFilter.addEventListener('change', function(e) {
      userDirFilters.role = e.target.value;
      renderUserDirectory();
    });
  }

  var teamFilter = document.getElementById('user-dir-team-filter');
  if (teamFilter) {
    teamFilter.addEventListener('change', function(e) {
      userDirFilters.teamId = e.target.value;
      renderUserDirectory();
    });
  }

  // Modal Add User Form
  var modalAddForm = document.getElementById('modal-add-user-form');
  if (modalAddForm) {
    modalAddForm.addEventListener('submit', handleAddUserSubmit);
  }

  // Modal Edit User Form
  var modalEditForm = document.getElementById('modal-edit-user-form');
  if (modalEditForm) {
    modalEditForm.addEventListener('submit', handleEditUserSubmit);
  }

  // Create Team Form
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
      await populateUserDirFilterDropdowns();
      await populateDependsOnCheckboxes();
      await renderTeamList('admin-team-list');
      await renderUserDirectory();
    });
  }

  // Provision Member Form (card 2)
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
          var roleLabel = role === 'junior' ? 'SDE I' : (role === 'senior' ? 'SDE II' : (role === 'teamadmin' ? 'Tech Lead' : 'Company Admin'));
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

  // Service Form
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

  // Assign Member Form (card 4)
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

async function populateUserDirFilterDropdowns() {
  var teamFilter = document.getElementById('user-dir-team-filter');
  if (!teamFilter) return;

  var teams = await getAllTeams();
  var html = '<option value="">All Teams</option>';
  html += '<option value="__unassigned__">Unassigned (No Team)</option>';
  teams.forEach(function(t) {
    html += '<option value="' + t.id + '">' + t.name + '</option>';
  });
  teamFilter.innerHTML = html;
  if (userDirFilters.teamId) {
    teamFilter.value = userDirFilters.teamId;
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

// -------------------------------------------------------------
// ORGANIZATION USER DIRECTORY — FULL CRUD & FILTERING
// -------------------------------------------------------------

function resetUserDirectoryFilters() {
  userDirFilters.query = '';
  userDirFilters.role = '';
  userDirFilters.teamId = '';

  var searchInput = document.getElementById('user-dir-search');
  if (searchInput) searchInput.value = '';

  var roleFilter = document.getElementById('user-dir-role-filter');
  if (roleFilter) roleFilter.value = '';

  var teamFilter = document.getElementById('user-dir-team-filter');
  if (teamFilter) teamFilter.value = '';

  renderUserDirectory();
}

async function renderUserDirectory() {
  var container = document.getElementById('user-directory');
  if (!container) return;

  var companyId = getCurrentCompanyId();
  var users = await api.get('users', { companyId: companyId });
  var teams = await getAllTeams();
  var currentUser = getCurrentUser();

  var totalCount = users.length;

  // Filter users
  var filteredUsers = users.filter(function(user) {
    if (userDirFilters.query) {
      var q = userDirFilters.query;
      var nameMatch = (user.name || '').toLowerCase().indexOf(q) !== -1;
      var emailMatch = (user.email || '').toLowerCase().indexOf(q) !== -1;
      if (!nameMatch && !emailMatch) return false;
    }

    if (userDirFilters.role) {
      if (user.role !== userDirFilters.role) return false;
    }

    if (userDirFilters.teamId) {
      if (userDirFilters.teamId === '__unassigned__') {
        if (user.teamId) return false;
      } else {
        if (user.teamId !== userDirFilters.teamId) return false;
      }
    }

    return true;
  });

  // Update count badge & reset filter button
  var countBadge = document.getElementById('user-dir-count');
  if (countBadge) {
    if (filteredUsers.length === totalCount) {
      countBadge.textContent = totalCount + (totalCount === 1 ? ' Member' : ' Members');
    } else {
      countBadge.textContent = filteredUsers.length + ' of ' + totalCount + ' Members';
    }
  }

  var resetBtn = document.getElementById('user-dir-reset-filter');
  if (resetBtn) {
    var hasActiveFilter = Boolean(userDirFilters.query || userDirFilters.role || userDirFilters.teamId);
    resetBtn.style.display = hasActiveFilter ? 'inline-flex' : 'none';
  }

  if (filteredUsers.length === 0) {
    container.innerHTML =
      '<div style="padding: 2.5rem; text-align: center; color: var(--text-muted);">' +
        '<div style="font-size:1.75rem; margin-bottom:0.5rem; opacity:0.6;">👥</div>' +
        '<div style="font-weight:600; font-size:0.95rem; margin-bottom:0.25rem;">No members found</div>' +
        '<div style="font-size:0.8rem; color:var(--text-subtle); margin-bottom:1rem;">Try adjusting your search query or role/team filters.</div>' +
        (userDirFilters.query || userDirFilters.role || userDirFilters.teamId ? '<button type="button" class="btn btn--sm btn--outline" onclick="resetUserDirectoryFilters()">Clear Filters</button>' : '') +
      '</div>';
    return;
  }

  var html =
    '<table style="width:100%; border-collapse: collapse; text-align: left;">' +
      '<thead>' +
        '<tr style="border-bottom: 1px solid var(--border-color); background:var(--bg-base);">' +
          '<th style="padding: 0.75rem 1rem; font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">Member</th>' +
          '<th style="padding: 0.75rem 1rem; font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">Email Address</th>' +
          '<th style="padding: 0.75rem 1rem; font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">Role / Tier</th>' +
          '<th style="padding: 0.75rem 1rem; font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">Assigned Team</th>' +
          '<th style="padding: 0.75rem 1rem; font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em; text-align:right;">Actions</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>';

  filteredUsers.forEach(function(user) {
    var teamName = 'Unassigned';
    var teamBadgeClass = 'badge--info';
    if (user.teamId) {
      var match = teams.filter(function(t) { return t.id === user.teamId; });
      if (match.length > 0) {
        teamName = match[0].name;
        if (teamName.toLowerCase() === 'admin') teamBadgeClass = 'badge--company_admin';
      }
    }

    var roleLabel = user.role === 'junior' ? 'SDE I (Junior)' :
      (user.role === 'senior' ? 'SDE II (Senior)' :
      (user.role === 'teamadmin' ? 'Tech Lead' :
      (user.role === 'company_admin' ? 'Company Admin' :
      (user.role === 'platform_superadmin' ? 'Platform Admin' : user.role))));

    var isSelf = currentUser && (currentUser.id === user.id || currentUser.email === user.email);
    var selfTag = isSelf ? ' <span style="font-size:0.7rem; color:var(--primary); font-weight:700; background:rgba(0,0,0,0.06); padding:2px 6px; border-radius:4px; margin-left:4px;">You</span>' : '';

    var initials = (user.name || 'U').split(' ').map(function(w){return w[0];}).join('').substring(0, 2).toUpperCase();

    html +=
      '<tr style="border-bottom: 1px solid var(--border-color); transition:background 0.15s ease;" onmouseover="this.style.background=\'var(--bg-surface-hover)\'" onmouseout="this.style.background=\'transparent\'">' +
        '<td style="padding: 0.85rem 1rem;">' +
          '<div style="display:flex; align-items:center; gap:0.65rem;">' +
            '<div style="width:30px; height:30px; border-radius:50%; background:var(--primary); color:var(--text-invert); display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:700; flex-shrink:0;">' + initials + '</div>' +
            '<div>' +
              '<div style="font-weight:600; color:var(--text-main); font-size:0.875rem;">' + user.name + selfTag + '</div>' +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td style="padding: 0.85rem 1rem; color: var(--text-muted); font-size:0.825rem; font-family:var(--font-mono);">' + user.email + '</td>' +
        '<td style="padding: 0.85rem 1rem;"><span class="badge badge--' + user.role + '" style="font-size:0.7rem;">' + roleLabel + '</span></td>' +
        '<td style="padding: 0.85rem 1rem;">' +
          (user.teamId ? '<span class="badge ' + teamBadgeClass + '" style="font-size:0.75rem; font-weight:600;">' + teamName + '</span>' : '<span style="color:var(--text-subtle); font-size:0.8rem; font-style:italic;">None (Unassigned)</span>') +
        '</td>' +
        '<td style="padding: 0.85rem 1rem; text-align:right; white-space:nowrap;">' +
          '<button type="button" class="btn btn--sm btn--outline" style="margin-right:6px; padding:0.25rem 0.65rem;" onclick="openEditUserModal(\'' + user.id + '\')">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="margin-right:3px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>' +
            'Edit' +
          '</button>' +
          '<button type="button" class="btn btn--sm btn--danger" style="padding:0.25rem 0.65rem;" onclick="confirmDeleteUser(\'' + user.id + '\')">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="margin-right:3px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>' +
            'Delete' +
          '</button>' +
        '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// -------------------------------------------------------------
// ADD USER MODAL HANDLERS
// -------------------------------------------------------------

async function openAddUserModal() {
  var modal = document.getElementById('user-add-modal');
  if (!modal) return;

  var teams = await getAllTeams();
  var teamSelect = document.getElementById('add-modal-team');
  if (teamSelect) {
    var html = '<option value="">-- No Team (Unassigned) --</option>';
    teams.forEach(function(t) {
      html += '<option value="' + t.id + '">' + t.name + '</option>';
    });
    teamSelect.innerHTML = html;
  }

  var form = document.getElementById('modal-add-user-form');
  if (form) form.reset();

  modal.style.display = 'flex';
  document.getElementById('add-modal-name').focus();
}

function closeAddUserModal() {
  var modal = document.getElementById('user-add-modal');
  if (modal) modal.style.display = 'none';
}

async function handleAddUserSubmit(e) {
  e.preventDefault();

  var name = document.getElementById('add-modal-name').value.trim();
  var email = document.getElementById('add-modal-email').value.trim();
  var password = document.getElementById('add-modal-password').value;
  var role = document.getElementById('add-modal-role').value;
  var teamId = document.getElementById('add-modal-team').value;
  var companyId = getCurrentCompanyId();

  if (!name || !email || !password) {
    showToast('Name, email, and password are required.', 'error');
    return;
  }

  // Check email duplicate across system
  var existing = await api.get('users', { email: email });
  if (existing.length > 0) {
    showToast('An account with email "' + email + '" already exists.', 'error');
    return;
  }

  var newUserId = generateId();
  var newUser = {
    id: newUserId,
    companyId: companyId,
    name: name,
    email: email,
    password: password,
    role: role || 'junior',
    teamId: teamId || null
  };

  try {
    await api.post('users', newUser);

    // Update team memberIds if team assigned
    if (teamId) {
      var team = await api.getById('teams', teamId);
      if (team) {
        var memberIds = team.memberIds || [];
        if (memberIds.indexOf(newUserId) === -1) {
          memberIds.push(newUserId);
          await api.patch('teams', teamId, { memberIds: memberIds });
        }
      }
    }

    if (typeof logAction === 'function') {
      var currentUser = getCurrentUser();
      var userName = currentUser ? currentUser.name : 'Company Admin';
      await logAction('USER_CREATED', 'User ' + name + ' (' + role + ') added to directory', newUserId, userName, companyId);
    }

    showToast('User "' + name + '" created successfully!', 'success');
    closeAddUserModal();

    await renderUserDirectory();
    await populateMemberUserDropdown();
    await populateTeamDropdowns();
    if (typeof renderTeamList === 'function') await renderTeamList('admin-team-list');
  } catch(ex) {
    showToast(ex.message || 'Error creating user.', 'error');
  }
}

// -------------------------------------------------------------
// EDIT USER MODAL HANDLERS
// -------------------------------------------------------------

async function openEditUserModal(userId) {
  var modal = document.getElementById('user-edit-modal');
  if (!modal) return;

  try {
    var user = await api.getById('users', userId);
    if (!user) {
      showToast('User not found.', 'error');
      return;
    }

    document.getElementById('edit-modal-id').value = user.id;
    document.getElementById('edit-modal-name').value = user.name || '';
    document.getElementById('edit-modal-email').value = user.email || '';
    document.getElementById('edit-modal-password').value = '';
    document.getElementById('edit-modal-role').value = user.role || 'junior';

    var idBadge = document.getElementById('edit-user-id-badge');
    if (idBadge) idBadge.textContent = 'User ID: ' + user.id;

    var teams = await getAllTeams();
    var teamSelect = document.getElementById('edit-modal-team');
    if (teamSelect) {
      var html = '<option value="">-- No Team (Unassigned) --</option>';
      teams.forEach(function(t) {
        var sel = user.teamId === t.id ? ' selected' : '';
        html += '<option value="' + t.id + '"' + sel + '>' + t.name + '</option>';
      });
      teamSelect.innerHTML = html;
    }

    modal.style.display = 'flex';
    document.getElementById('edit-modal-name').focus();
  } catch(ex) {
    showToast('Failed to load user details: ' + ex.message, 'error');
  }
}

function closeEditUserModal() {
  var modal = document.getElementById('user-edit-modal');
  if (modal) modal.style.display = 'none';
}

async function handleEditUserSubmit(e) {
  e.preventDefault();

  var userId = document.getElementById('edit-modal-id').value;
  var name = document.getElementById('edit-modal-name').value.trim();
  var email = document.getElementById('edit-modal-email').value.trim();
  var newPassword = document.getElementById('edit-modal-password').value;
  var role = document.getElementById('edit-modal-role').value;
  var newTeamId = document.getElementById('edit-modal-team').value || null;

  if (!userId || !name || !email) {
    showToast('Name and email are required.', 'error');
    return;
  }

  try {
    var originalUser = await api.getById('users', userId);
    if (!originalUser) {
      showToast('User record not found.', 'error');
      return;
    }

    // Check if new email is used by another user
    if (email.toLowerCase() !== (originalUser.email || '').toLowerCase()) {
      var existing = await api.get('users', { email: email });
      var conflict = existing.some(function(u) { return u.id !== userId; });
      if (conflict) {
        showToast('Email "' + email + '" is already in use by another account.', 'error');
        return;
      }
    }

    var payload = {
      name: name,
      email: email,
      role: role,
      teamId: newTeamId
    };

    if (newPassword) {
      payload.password = newPassword;
    }

    await api.patch('users', userId, payload);

    // Handle Team membership reassignment
    var oldTeamId = originalUser.teamId;
    if (oldTeamId && oldTeamId !== newTeamId) {
      try {
        var oldTeam = await api.getById('teams', oldTeamId);
        if (oldTeam && Array.isArray(oldTeam.memberIds)) {
          var updatedOldMemberIds = oldTeam.memberIds.filter(function(id) { return id !== userId; });
          await api.patch('teams', oldTeamId, { memberIds: updatedOldMemberIds });
        }
      } catch(ex) {
        console.warn('Could not remove user from previous team:', ex);
      }
    }

    if (newTeamId && oldTeamId !== newTeamId) {
      try {
        var newTeam = await api.getById('teams', newTeamId);
        if (newTeam) {
          var newMemberIds = newTeam.memberIds || [];
          if (newMemberIds.indexOf(userId) === -1) {
            newMemberIds.push(userId);
            await api.patch('teams', newTeamId, { memberIds: newMemberIds });
          }
        }
      } catch(ex) {
        console.warn('Could not add user to new team:', ex);
      }
    }

    // If updating current logged in user, refresh sessionStorage
    var currentUser = getCurrentUser();
    if (currentUser && currentUser.id === userId) {
      currentUser.name = name;
      currentUser.email = email;
      currentUser.role = role;
      currentUser.teamId = newTeamId;
      sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(currentUser));

      var sidebarUser = document.getElementById('sidebar-user');
      if (sidebarUser) {
        var roleDisplay = role === 'company_admin' ? 'Company Admin' : (role === 'platform_superadmin' ? 'Platform Admin' : role.charAt(0).toUpperCase() + role.slice(1));
        sidebarUser.innerHTML =
          '<div class="sidebar__user-info">' +
            '<div style="flex:1; min-width:0;">' +
              '<div class="sidebar__user-name">' + name + '</div>' +
              '<span class="badge badge--' + role + '" style="font-size:0.65rem;">' + roleDisplay + '</span>' +
            '</div>' +
          '</div>' +
          '<button class="sidebar__logout" onclick="logout()">Sign out</button>';
      }
    }

    if (typeof logAction === 'function') {
      var actorName = currentUser ? currentUser.name : 'Admin';
      await logAction('USER_UPDATED', 'User ' + name + ' profile and team assignment updated', userId, actorName, getCurrentCompanyId());
    }

    showToast('User "' + name + '" updated successfully!', 'success');
    closeEditUserModal();

    await renderUserDirectory();
    await populateMemberUserDropdown();
    await populateTeamDropdowns();
    if (typeof renderTeamList === 'function') await renderTeamList('admin-team-list');

    var manageTeamSelect = document.getElementById('manage-team-select');
    if (manageTeamSelect && manageTeamSelect.value) {
      await renderTeamMembers(manageTeamSelect.value);
    }
  } catch(ex) {
    showToast('Error updating user: ' + ex.message, 'error');
  }
}

// -------------------------------------------------------------
// DELETE USER MODAL & EXECUTION
// -------------------------------------------------------------

async function confirmDeleteUser(userId) {
  var modal = document.getElementById('user-delete-modal');
  if (!modal) return;

  try {
    var user = await api.getById('users', userId);
    if (!user) {
      showToast('User not found.', 'error');
      return;
    }

    // Safety check: Prevent deleting the only Company Admin in workspace
    if (user.role === 'company_admin') {
      var companyId = getCurrentCompanyId();
      var allCompanyUsers = await api.get('users', { companyId: companyId });
      var adminCount = allCompanyUsers.filter(function(u) { return u.role === 'company_admin'; }).length;
      if (adminCount <= 1) {
        showToast('Cannot delete this user. At least one Company Admin must remain to manage the workspace.', 'error');
        return;
      }
    }

    document.getElementById('delete-modal-user-id').value = user.id;
    var promptEl = document.getElementById('delete-modal-prompt');
    if (promptEl) {
      promptEl.innerHTML = 'Are you sure you want to delete user <strong>' + user.name + '</strong> (<span class="mono">' + user.email + '</span>)?<br><br><span style="font-size:0.8rem; color:var(--status-critical);">This will permanently delete their account and revoke all team assignments.</span>';
    }

    modal.style.display = 'flex';
  } catch(ex) {
    showToast('Failed to retrieve user: ' + ex.message, 'error');
  }
}

function closeDeleteUserModal() {
  var modal = document.getElementById('user-delete-modal');
  if (modal) modal.style.display = 'none';
}

async function executeDeleteUser() {
  var userId = document.getElementById('delete-modal-user-id').value;
  if (!userId) return;

  var confirmBtn = document.getElementById('delete-modal-confirm-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting...';
  }

  try {
    var user = await api.getById('users', userId);
    var userName = user ? user.name : 'User';
    var teamId = user ? user.teamId : null;

    // Remove user from team memberIds if assigned
    if (teamId) {
      try {
        var team = await api.getById('teams', teamId);
        if (team && Array.isArray(team.memberIds)) {
          var updatedMemberIds = team.memberIds.filter(function(id) { return id !== userId; });
          await api.patch('teams', teamId, { memberIds: updatedMemberIds });
        }
      } catch(ex) {
        console.warn('Could not remove user from team roster:', ex);
      }
    }

    await api.delete('users', userId);

    if (typeof logAction === 'function') {
      var currentUser = getCurrentUser();
      var actorName = currentUser ? currentUser.name : 'Company Admin';
      await logAction('USER_DELETED', 'User ' + userName + ' was deleted from the organization', userId, actorName, getCurrentCompanyId());
    }

    showToast('User "' + userName + '" was deleted.', 'success');
    closeDeleteUserModal();

    var currentUser = getCurrentUser();
    if (currentUser && currentUser.id === userId) {
      logout();
      return;
    }

    await renderUserDirectory();
    await populateMemberUserDropdown();
    await populateTeamDropdowns();
    if (typeof renderTeamList === 'function') await renderTeamList('admin-team-list');

    var manageTeamSelect = document.getElementById('manage-team-select');
    if (manageTeamSelect && manageTeamSelect.value) {
      await renderTeamMembers(manageTeamSelect.value);
    }
  } catch(ex) {
    showToast('Failed to delete user: ' + ex.message, 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete Account';
    }
  }
}

// -------------------------------------------------------------
// INVITE CODE GENERATION & COPY
// -------------------------------------------------------------

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
