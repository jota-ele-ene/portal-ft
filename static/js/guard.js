// guard.js – client-side route guard basado en allowed_pages del servidor

(function () {
  const token      = sessionStorage.getItem('portal_token');
  const role       = sessionStorage.getItem('portal_role') || 'supplier';
  const redirectTo = sessionStorage.getItem('portal_redirect_to') || '/';

  let allowed = [];
  try {
    allowed = JSON.parse(sessionStorage.getItem('portal_allowed_pages') || '[]');
  } catch (_) {
    allowed = [];
  }

  // Sin token → siempre al login raíz
  if (!token) {
    window.location.replace('/');
    return;
  }

  const currentPath = window.location.pathname;

  // Si tenemos lista de páginas permitidas, validar la ruta actual
  if (allowed.length > 0 && !allowed.includes(currentPath)) {
    // Primer elemento es la página por defecto del rol
    window.location.replace(allowed[0] || redirectTo || '/');
    return;
  }
})();

// API opcional
function ensureAuthenticated(expectedRole) {
  const token = sessionStorage.getItem('portal_token');
  const role  = sessionStorage.getItem('portal_role') || 'supplier';

  if (!token) {
    window.location.replace('/');
    return false;
  }

  if (expectedRole && role !== expectedRole) {
    // Si el rol no coincide, enviamos a la página por defecto registrada
    let allowed = [];
    try {
      allowed = JSON.parse(sessionStorage.getItem('portal_allowed_pages') || '[]');
    } catch (_) {
      allowed = [];
    }
    window.location.replace(allowed[0] || '/');
    return false;
  }

  let allowed = [];
  try {
    allowed = JSON.parse(sessionStorage.getItem('portal_allowed_pages') || '[]');
  } catch (_) {
    allowed = [];
  }

  const currentPath = window.location.pathname;
  if (allowed.length > 0 && !allowed.includes(currentPath)) {
    window.location.replace(allowed[0] || '/');
    return false;
  }

  return true;
}