// guard.js – client-side route guard basado en allowed_pages del servidor

function showRouteToast(msg, type = 'error') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show' + (type ? ' toast-' + type : '');
  clearTimeout(window._routeToastTimer);
  window._routeToastTimer = setTimeout(() => (t.className = ''), 4000);
}

function getAllowedPages() {
  try {
    return JSON.parse(sessionStorage.getItem('portal_allowed_pages') || '[]');
  } catch (_) {
    return [];
  }
}

function isAllowedPath(pathname) {
  const allowed = getAllowedPages();
  console.log('isAllowedPath(): Checking if', pathname, 'is allowed against', allowed);
  return allowed.some(route => pathname === route || pathname.startsWith(route + '/'));
}

function goIfAllowed(pathname) {
  console.log('goIfAllowed(): Attempting to navigate to', pathname);
  if (!isAllowedPath(pathname.split('?')[0])) {
    showRouteToast('No estás autorizado para acceder a la página que intentas cargar.', 'error');
    return false;
  }

  window.location.href = pathname;
  return true;
}

(function () {
  const role = sessionStorage.getItem('portal_role') || 'supplier';
  const allowed = getAllowedPages();

  if (!role || !allowed.length) {
    return;
  }
})();

function ensureAuthenticated(expectedRole) {
  const role = sessionStorage.getItem('portal_role') || 'supplier';

  if (!role) {
    window.location.replace('/');
    return false;
  }

  if (expectedRole && role !== expectedRole) {
    showRouteToast('No estás autorizado para acceder a la página que intentas cargar.', 'error');
    return false;
  }

  const currentPath = window.location.pathname;
  if (!isAllowedPath(currentPath)) {
    showRouteToast('No estás autorizado para acceder a la página que intentas cargar.', 'error');
    return false;
  }

  return true;
}

window.goIfAllowed = goIfAllowed;
window.isAllowedPath = isAllowedPath;
window.ensureAuthenticated = ensureAuthenticated;