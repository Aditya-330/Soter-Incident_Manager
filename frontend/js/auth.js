
async function signup(name, email, password, role, inviteCode, directCompanyId) {
  try {
    var payload = { name: name, email: email, password: password, role: role, inviteCode: inviteCode };
    var res = await fetch(API_BASE + '/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json();
    if (!data.success) return { success: false, error: data.error || 'Signup failed.' };
    return { success: true, token: data.token || null, user: data.user };
  } catch (e) {
    return { success: false, error: 'Network error. Please try again.' };
  }
}

async function registerCompany(companyName, adminName, adminEmail, adminPassword, extraData) {
  try {
    var extra = extraData || {};
    var payload = Object.assign({
      companyName: companyName,
      adminName: adminName,
      adminEmail: adminEmail,
      adminPassword: adminPassword || 'admin123'
    }, extra);

    var res = await fetch(API_BASE + '/api/auth/register-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json();
    if (!data.success) return { success: false, error: data.error || 'Registration failed.' };
    return { success: true, pending: true, companyId: data.companyId };
  } catch (e) {
    return { success: false, error: 'Network error. Please try again.' };
  }
}

async function login(email, password) {
  try {
    var res = await fetch(API_BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    });
    var data = await res.json();

    if (!data.success) {
      return { success: false, error: data.error || 'Invalid email or password.', status: data.status };
    }

    // Store JWT
    if (data.token) setToken(data.token);

    // Store user in session (same shape as before)
    var user = data.user;
    sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
    sessionStorage.removeItem('impersonated_company_id');

    return { success: true, user: user, redirect: data.redirect || 'dashboard.html' };
  } catch (e) {
    return { success: false, error: 'Network error. Please try again.' };
  }
}

function logout() {
  var user = getCurrentUser();
  if (user && user.companyId && user.role !== 'platform_superadmin' && typeof logAction === 'function') {
    logAction('USER_LOGOUT', 'User ' + user.name + ' logged out', null, user.name, user.companyId);
  }
  sessionStorage.removeItem(CURRENT_USER_KEY);
  sessionStorage.removeItem('impersonated_company_id');
  clearToken();
  window.location.href = 'index.html';
}

function hasPermission(minRole) {
  var user = getCurrentUser();
  if (!user) return false;

  var userLevel = ROLE_LEVELS[user.role] || 0;
  var requiredLevel = ROLE_LEVELS[minRole] || 0;

  return userLevel >= requiredLevel;
}

function requireLogin() {
  var user = getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  if (user.role === 'platform_superadmin' && !sessionStorage.getItem('impersonated_company_id')) {

    if (!window.location.pathname.endsWith('platform-admin.html')) {
      window.location.href = 'platform-admin.html';
    }
  }
}

function requireRole(minRole) {
  var user = getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  if (!hasPermission(minRole)) {
    if (user.role === 'platform_superadmin') {
      window.location.href = 'platform-admin.html';
    } else {
      window.location.href = 'dashboard.html';
    }
  }
}

function renderNavUser(containerId) {
  var container = document.getElementById(containerId);
  var user = getCurrentUser();
  if (!container || !user) return;

  var roleDisplay = user.role === 'company_admin' ? 'Company Admin' : (user.role === 'platform_superadmin' ? 'Platform Admin' : user.role.charAt(0).toUpperCase() + user.role.slice(1));

  container.innerHTML =
    '<span class="nav-user-name">' + user.name + '</span>' +
    '<span class="badge badge--' + user.role + '">' + roleDisplay + '</span>' +
    '<button class="btn btn--sm btn--outline" onclick="logout()">Logout</button>';
}
