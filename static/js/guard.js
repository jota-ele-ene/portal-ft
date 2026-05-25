function ensureAuthenticated(expectedRole) {
  const token = sessionStorage.getItem('portal_token');
  const role  = sessionStorage.getItem('portal_role') || 'supplier';

  // 1) Sin token → a login con next SOLO UNA VEZ
  if (!token) {
    const here = window.location.pathname + window.location.search;
    const loginUrl = new URL('/', window.location.origin);
    loginUrl.searchParams.set('next', here);
    window.location.href = loginUrl.toString();
    return false;
  }

  // 2) Con token, ya NO usamos ?next para nada, solo miramos rol
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