// guard.js – client-side route guard; NO ?next= logic
function ensureAuthenticated(expectedRole) {
  const token = sessionStorage.getItem('portal_token');
  const role  = sessionStorage.getItem('portal_role') || 'supplier';

  // Sin token → siempre a login sin parámetros
  if (!token) {
    window.location.href = '/';
    return false;
  }

  // Con token, redirigir a la página por defecto del rol si no coincide
  if (expectedRole === 'admin' && role !== 'admin') {
    window.location.href = '/perfil';
    return false;
  }

  if (expectedRole === 'supplier' && role === 'admin') {
    window.location.href = '/proveedores';
    return false;
  }

  return true;
}
