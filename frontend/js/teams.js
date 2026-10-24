
async function getAllTeams() {
  var companyId = getCurrentCompanyId();
  if (!companyId) return [];
  return api.get('teams', { companyId: companyId });
}

async function addTeam(name, description) {
  var companyId = getCurrentCompanyId();
  var newTeam = {
    id: generateId(),
    companyId: companyId,
    name: name,
    description: description,
    memberIds: []
  };
  await api.post('teams', newTeam);

  if (typeof logAction === 'function') {
    var currentUser = getCurrentUser();
    var userName = currentUser ? currentUser.name : 'System';
    await logAction('TEAM_CREATED', 'Team "' + name + '" created', newTeam.id, userName, companyId);
  }

  return newTeam;
}

async function createAndAssignMember(name, email, password, role, teamId) {
  var companyId = getCurrentCompanyId();
  if (!companyId) throw new Error('No active company workspace context');

  var existing = await api.get('users', { email: email });
  if (existing.length > 0) {
    throw new Error('An account with email "' + email + '" already exists.');
  }

  var newUserId = generateId();
  var newUser = {
    id: newUserId,
    companyId: companyId,
    name: name,
    email: email,
    password: password || 'pass123',
    role: role || 'junior',
    teamId: teamId || null
  };

  await api.post('users', newUser);

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
    await logAction('MEMBER_PROVISIONED', 'Developer ' + name + ' (' + role + ') provisioned and assigned', newUserId, userName, companyId);
  }

  return newUser;
}

async function assignMemberToTeam(userId, teamId) {

  await api.patch('users', userId, { teamId: teamId });

  var team = await api.getById('teams', teamId);
  var memberIds = team.memberIds || [];
  if (memberIds.indexOf(userId) === -1) {
    memberIds.push(userId);
    await api.patch('teams', teamId, { memberIds: memberIds });
  }

  if (typeof logAction === 'function') {
    var user = await api.getById('users', userId);
    var currentUser = getCurrentUser();
    var userName = currentUser ? currentUser.name : 'System';
    await logAction('MEMBER_ADDED', user.name + ' added to team ' + team.name, user.id, userName, getCurrentCompanyId());
  }
}

async function removeMemberFromTeam(userId) {
  var user = await api.getById('users', userId);
  var oldTeamId = user.teamId;

  await api.patch('users', userId, { teamId: null });

  if (oldTeamId) {
    var team = await api.getById('teams', oldTeamId);
    var memberIds = (team.memberIds || []).filter(function(id) { return id !== userId; });
    await api.patch('teams', oldTeamId, { memberIds: memberIds });
  }

  if (typeof logAction === 'function') {
    var currentUser = getCurrentUser();
    var userName = currentUser ? currentUser.name : 'System';
    await logAction('MEMBER_REMOVED', user.name + ' removed from team', user.id, userName, getCurrentCompanyId());
  }
}

async function getTeamMembers(teamId) {
  return api.get('users', { teamId: teamId });
}

async function renderTeamList(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var teams = await getAllTeams();

  var currentUser = getCurrentUser();
  if (currentUser && (currentUser.role === 'junior' || currentUser.role === 'senior') && currentUser.teamId) {
    teams = teams.filter(function(t) { return t.id === currentUser.teamId; });
  }

  if (teams.length === 0) {
    container.innerHTML = '<p class="empty-state">No teams created yet.</p>';
    return;
  }

  var html = '';
  for (var i = 0; i < teams.length; i++) {
    var team = teams[i];
    var members = await getTeamMembers(team.id);
    var memberCount = members.length;
    var memberSummary = memberCount === 1 ? '1 member' : memberCount + ' members';

    var membersListHtml = '';
    if (members.length > 0) {
      membersListHtml = '<div style="margin-top:0.75rem; display:flex; flex-direction:column; gap:0.4rem; border-top:1px solid var(--border-light); padding-top:0.6rem;">';
      members.forEach(function(m) {
        var roleLabel = m.role === 'junior' ? 'SDE I (Tier 1)' : (m.role === 'senior' ? 'SDE II (Tier 2)' : (m.role === 'teamadmin' ? 'Team Lead (Tier 3)' : m.role));
        membersListHtml +=
          '<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem;">' +
            '<div>' +
              '<span style="font-weight:600; color:var(--text-main);">' + m.name + '</span>' +
              '<span style="font-size:0.7rem; color:var(--text-muted); margin-left:6px;">(' + m.email + ')</span>' +
            '</div>' +
            '<span class="badge badge--' + m.role + '" style="font-size:0.65rem;">' + roleLabel + '</span>' +
          '</div>';
      });
      membersListHtml += '</div>';
    } else {
      membersListHtml = '<div style="margin-top:0.6rem; font-size:0.75rem; color:var(--text-subtle);">No members assigned yet.</div>';
    }

    html +=
      '<div class="card">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
          '<h3 class="card__title" style="margin-bottom:0.25rem;">' + team.name + '</h3>' +
          '<span class="badge badge--info">' + memberSummary + '</span>' +
        '</div>' +
        '<p class="card__text" style="font-size:0.8125rem; color:var(--text-muted); margin-bottom:0.25rem;">' + (team.description || 'No description provided') + '</p>' +
        membersListHtml +
      '</div>';
  }

  container.innerHTML = html;
}
