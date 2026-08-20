
async function signup(name, email, password, role, inviteCode, directCompanyId) {

  var existing = await api.get('users', { email: email });
  if (existing.length > 0) {
    return { success: false, error: 'An account with this email already exists.' };
  }

  var companyId = directCompanyId || null;

  if (!companyId && inviteCode) {
    var codes = await api.get('inviteCodes', { code: inviteCode });
    if (codes.length === 0) {
      return { success: false, error: 'Invalid invite code.' };
    }
    companyId = codes[0].companyId;

    try {
      var company = await api.getById('companies', companyId);
      if (!company || company.status !== 'approved') {
        return { success: false, error: 'This company workspace is pending review or inactive.' };
      }
    } catch(e) {
      return { success: false, error: 'Unable to verify company status.' };
    }
  }

  if (!companyId) {
    return { success: false, error: 'An invite code is required to join a company.' };
  }

  if (!directCompanyId && (role === 'platform_superadmin' || role === 'company_admin' || role === 'superadmin' || role === 'teamadmin')) {
    return { success: false, error: 'Admin roles can only be assigned via company registration or admin promotion.' };
  }

  var newUser = {
    id: generateId(),
    companyId: companyId,
    name: name,
    email: email,
    password: password,
    role: role || 'junior',
    teamId: null 
  };

  await api.post('users', newUser);

  if (typeof logAction === 'function') {
    await logAction('USER_REGISTERED', 'User ' + name + ' registered as ' + (role || 'junior'), newUser.id, name, companyId);
  }

  return { success: true, user: newUser };
}

async function registerCompany(companyName, adminName, adminEmail, adminPassword, extraData) {

  var existing = await api.get('users', { email: adminEmail });
  if (existing.length > 0) {
    return { success: false, error: 'An account with this email already exists.' };
  }

  const companyId = generateId();
  var extra = extraData || {};

  var companyRecord = {
    id: companyId,
    name: companyName,
    status: 'pending',
    website: extra.website || '',
    size: extra.size || '',
    industry: extra.industry || '',
    location: extra.location || '',
    adminName: adminName,
    adminEmail: adminEmail,
    jobTitle: extra.jobTitle || '',
    phone: extra.phone || '',
    numCustomers: extra.numCustomers || '',
    revenueRange: extra.revenueRange || '',
    numEmployees: extra.numEmployees || '',
    techPartnerships: extra.techPartnerships || '',
    keyProducts: extra.keyProducts || '',
    businessOpportunity: extra.businessOpportunity || '',
    integrationType: extra.integrationType || '',
    productsToIntegrate: extra.productsToIntegrate || '',
    integrationRequirements: extra.integrationRequirements || '',
    techContact: extra.techContact || '',
    techStack: extra.techStack || '',
    createdAt: new Date().toISOString()
  };

  await api.post('companies', companyRecord);

  const newAdmin = {
    id: generateId(),
    companyId: companyId,
    name: adminName,
    email: adminEmail,
    password: adminPassword || 'admin123',
    role: 'company_admin',
    teamId: null
  };
  await api.post('users', newAdmin);

  if (typeof logAction === 'function') {
    await logAction('COMPANY_REGISTERED_PENDING', 'Company "' + companyName + '" submitted for approval by ' + adminName, companyId, adminName, companyId);
  }

  return { success: true, pending: true, companyId: companyId };
}

async function login(email, password) {
  var matched = await api.get('users', { email: email, password: password });

  if (matched.length === 0) {
    return { success: false, error: 'Invalid email or password.' };
  }

  var user = matched[0];

  if (user.role === 'platform_superadmin') {
    sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
    sessionStorage.removeItem('impersonated_company_id');
    return { success: true, user: user, redirect: 'platform-admin.html' };
  }

  if (user.companyId) {
    try {
      var company = await api.getById('companies', user.companyId);
      if (!company || company.status === 'pending') {
        return {
          success: false,
          status: 'pending',
          error: 'Your company registration is currently pending review. You will receive access once approved by the platform team.'
        };
      }
      if (company.status === 'rejected') {
        return {
          success: false,
          status: 'rejected',
          error: 'Your company registration request was not approved. Please contact platform support.'
        };
      }
      if (company.status !== 'approved') {
        return {
          success: false,
          status: 'inactive',
          error: 'Your company workspace is not active. Status: ' + company.status
        };
      }
    } catch(e) {
      console.warn('[Auth] Could not verify company status:', e);
    }
  }

  sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  sessionStorage.removeItem('impersonated_company_id');

  if (typeof logAction === 'function') {
    await logAction('USER_LOGIN', 'User ' + user.name + ' logged in', null, user.name, user.companyId);
  }

  return { success: true, user: user, redirect: 'dashboard.html' };
}

function logout() {
  var user = getCurrentUser();
  if (user && user.companyId && user.role !== 'platform_superadmin' && typeof logAction === 'function') {
    logAction('USER_LOGOUT', 'User ' + user.name + ' logged out', null, user.name, user.companyId);
  }
  sessionStorage.removeItem(CURRENT_USER_KEY);
  sessionStorage.removeItem('impersonated_company_id');
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
