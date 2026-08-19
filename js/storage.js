
var API_BASE = 'http://localhost:3001';

var ROLE_LEVELS = {
  platform_superadmin: 5,
  company_admin: 4,
  superadmin: 4, 
  teamadmin: 3,
  senior: 2,
  junior: 1
};

var CURRENT_USER_KEY = 'current_user';

function sanitizePayload(data) {
  if (!data || typeof data !== 'object') return data;
  var copy = Array.isArray(data) ? [] : {};
  for (var key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      if (typeof key === 'string' && key.endsWith('Id') && (data[key] === null || data[key] === undefined)) {
        copy[key] = '';
      } else if (typeof data[key] === 'object' && data[key] !== null) {
        copy[key] = sanitizePayload(data[key]);
      } else {
        copy[key] = data[key];
      }
    }
  }
  return copy;
}

var api = {

  get: function(resource, queryParams) {
    var url = API_BASE + '/' + resource;
    if (queryParams && typeof queryParams === 'object') {
      var parts = [];
      Object.keys(queryParams).forEach(function(key) {
        if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
          parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(queryParams[key]));
        }
      });
      if (parts.length > 0) {
        url += '?' + parts.join('&');
      }
    }
    return fetch(url).then(function(res) {
      if (!res.ok) throw new Error('API GET failed: ' + res.status);
      return res.json();
    });
  },

  getById: function(resource, id) {
    return fetch(API_BASE + '/' + resource + '/' + id).then(function(res) {
      if (!res.ok) throw new Error('API GET by ID failed: ' + res.status);
      return res.json();
    });
  },

  post: function(resource, data) {
    var cleanData = sanitizePayload(data);
    return fetch(API_BASE + '/' + resource, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanData)
    }).then(function(res) {
      if (!res.ok) throw new Error('API POST failed: ' + res.status);
      return res.json();
    });
  },

  put: function(resource, id, data) {
    var cleanData = sanitizePayload(data);
    return fetch(API_BASE + '/' + resource + '/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanData)
    }).then(function(res) {
      if (!res.ok) throw new Error('API PUT failed: ' + res.status);
      return res.json();
    });
  },

  patch: function(resource, id, data) {
    var cleanData = sanitizePayload(data);
    return fetch(API_BASE + '/' + resource + '/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanData)
    }).then(function(res) {
      if (!res.ok) throw new Error('API PATCH failed: ' + res.status);
      return res.json();
    });
  },

  delete: function(resource, id) {
    return fetch(API_BASE + '/' + resource + '/' + id, {
      method: 'DELETE'
    }).then(function(res) {
      if (res.status === 404) return {}; 
      if (!res.ok) throw new Error('API DELETE failed: ' + res.status);

      return res.text().then(function(text) {
        try { return text ? JSON.parse(text) : {}; } catch(e) { return {}; }
      });
    });
  }
};

function getCurrentUser() {
  var data = sessionStorage.getItem(CURRENT_USER_KEY);
  if (!data) return null;
  return JSON.parse(data);
}

function getCurrentCompanyId() {
  var user = getCurrentUser();
  if (!user) return null;
  if (user.role === 'platform_superadmin') {
    return sessionStorage.getItem('impersonated_company_id') || user.companyId || null;
  }
  return user.companyId || null;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function showToast(message, type) {
  var toast = document.createElement('div');
  toast.className = 'toast toast--' + (type || 'info');
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(function() {
    toast.classList.add('toast--visible');
  }, 10);

  setTimeout(function() {
    toast.classList.remove('toast--visible');
    setTimeout(function() {
      if (toast.parentElement) toast.remove();
    }, 300);
  }, 3000);
}
