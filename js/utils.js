
function getRelativeTime(isoString) {
  var msPerMinute = 60 * 1000;
  var msPerHour = msPerMinute * 60;
  var msPerDay = msPerHour * 24;
  var msPerMonth = msPerDay * 30;
  var msPerYear = msPerDay * 365;

  var elapsed = Date.now() - new Date(isoString).getTime();

  if (elapsed < msPerMinute) {
    return 'just now';
  } else if (elapsed < msPerHour) {
    return Math.round(elapsed/msPerMinute) + ' min ago';
  } else if (elapsed < msPerDay ) {
    return Math.round(elapsed/msPerHour ) + ' hrs ago';
  } else if (elapsed < msPerMonth) {
    return 'approx ' + Math.round(elapsed/msPerDay) + ' days ago';
  } else {
    return 'approx ' + Math.round(elapsed/msPerMonth) + ' months ago';
  }
}

function showConfirmModal(message, onConfirm) {

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'confirm-modal';

  var modal = document.createElement('div');
  modal.className = 'modal-box';

  var title = document.createElement('h3');
  title.style.marginTop = '0';
  title.textContent = 'Confirm Action';

  var text = document.createElement('p');
  text.textContent = message;

  var btnContainer = document.createElement('div');
  btnContainer.style.display = 'flex';
  btnContainer.style.justifyContent = 'flex-end';
  btnContainer.style.gap = '10px';
  btnContainer.style.marginTop = '20px';

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn--outline';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = function() { document.body.removeChild(overlay); };

  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn--primary';
  confirmBtn.textContent = 'Confirm';
  confirmBtn.onclick = function() {
    document.body.removeChild(overlay);
    onConfirm();
  };

  btnContainer.appendChild(cancelBtn);
  btnContainer.appendChild(confirmBtn);

  modal.appendChild(title);
  modal.appendChild(text);
  modal.appendChild(btnContainer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', function(e) {

    if (e.key === 'Escape') {
      var modal = document.getElementById('confirm-modal');
      if (modal) modal.remove();
    }

    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      var searchInput = document.getElementById('search-incidents');
      if (searchInput) {
        e.preventDefault();
        searchInput.focus();
      }
    }
  });
}

async function exportToJSON() {
  var companyId = getCurrentCompanyId();

  var data = {
    users: await api.get('users', { companyId: companyId }),
    teams: await api.get('teams', { companyId: companyId }),
    services: await api.get('services', { companyId: companyId }),
    incidents: await api.get('incidents', { companyId: companyId }),
    auditLogs: await api.get('auditLogs', { companyId: companyId }),
    escalationLogs: await api.get('escalationLogs'),
    dependencyGraph: await api.get('dependencyGraph', { companyId: companyId })
  };

  var json = JSON.stringify(data, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);

  var a = document.createElement('a');
  a.href = url;
  a.download = 'oncall-export-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Data exported successfully!', 'success');
}

function toggleDarkMode() {
  var isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

function initTheme() {
  var theme = localStorage.getItem('theme');
  if (theme === 'light') {
    document.body.classList.add('light-mode');
  }
}

initTheme();
initKeyboardShortcuts();
