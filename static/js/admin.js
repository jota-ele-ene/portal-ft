window.APP_BASE = window.APP_BASE || window.location.pathname.replace(/\/[^/]*$/, '');
window.API = window.API || (window.__API_BASE__ || window.APP_BASE).replace(/\/$/, '');

let adminToken = window.token || sessionStorage.getItem('portal_token') || null;
let allSuppliers = [];
let adminEmailLocal = '';

console.log('Admin dashboard JS cargado en', window.location.pathname);

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show' + (type ? ' toast-' + type : '');
  clearTimeout(window._tt);
  window._tt = setTimeout(() => (t.className = ''), 4000);
}

function openAddInviteModal() {
  const modal = document.getElementById('inviteModal');
  const options = document.getElementById('inviteOptionScreen');
  const form = document.getElementById('inviteFormScreen');
  const error = document.getElementById('inviteError');
  const success = document.getElementById('inviteSuccess');
  const input = document.getElementById('inviteEmailInput');
  if (!modal || !options || !form) return;
  modal.style.display = 'flex';
  options.style.display = 'block';
  form.style.display = 'none';
  if (error) error.style.display = 'none';
  if (success) success.style.display = 'none';
  if (input) input.value = '';
}

function closeInviteModal() {
  const modal = document.getElementById('inviteModal');
  if (!modal) return;
  modal.style.display = 'none';
}

function showInviteForm() {
  const options = document.getElementById('inviteOptionScreen');
  const form = document.getElementById('inviteFormScreen');
  const error = document.getElementById('inviteError');
  const success = document.getElementById('inviteSuccess');
  if (!options || !form) return;
  options.style.display = 'none';
  form.style.display = 'block';
  if (error) error.style.display = 'none';
  if (success) success.style.display = 'none';
}

async function inviteSupplier() {
  const emailInput = document.getElementById('inviteEmailInput');
  const error = document.getElementById('inviteError');
  const success = document.getElementById('inviteSuccess');
  if (!emailInput || !error || !success) return;

  const email = emailInput.value.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    error.textContent = 'Introduce un correo válido.';
    error.style.display = 'block';
    success.style.display = 'none';
    return;
  }

  error.style.display = 'none';
  success.style.display = 'none';

  try {
    const res = await fetch(`${API}/auth/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + adminToken
      },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al enviar la invitación.');

    success.textContent = 'Invitación enviada correctamente.';
    success.style.display = 'block';
    emailInput.value = '';
  } catch (e) {
    error.textContent = e.message;
    error.style.display = 'block';
    success.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const dashboard = document.getElementById('admin-dashboard');
  const adminEmailDisplay = document.getElementById('adminEmailDisplay');
  const adminUserArea = document.getElementById('adminUserArea');

  const role = sessionStorage.getItem('portal_role') || '';
  const token = sessionStorage.getItem('portal_token') || null;
  const email = sessionStorage.getItem('portal_email') || '';

  if (role === 'admin' && token) {
    adminToken = token;
    adminEmailLocal = email;
  }

  if (adminUserArea && adminEmailDisplay && adminEmailLocal) {
    adminEmailDisplay.textContent = adminEmailLocal;
    adminUserArea.style.display = 'flex';
  }

  if (dashboard) {
    if (!adminToken) {
      showToast('Sesión de administrador no válida. Vuelve a iniciar sesión.', 'error');
      window.location.href = '/';
      return;
    }
    loadSuppliers();
  }
});

async function loadSuppliers() {
  try {
    const res = await fetch(`${API}/suppliers/admin/list`, {
      headers: { Authorization: 'Bearer ' + adminToken }
    });
    if (!res.ok) throw new Error('Error al cargar proveedores.');

    const data = await res.json();
    allSuppliers = data.suppliers || [];

    const countEl = document.getElementById('supplierCount');
    if (countEl) {
      countEl.textContent = `${allSuppliers.length} proveedor(es) registrado(s)`;
    }
    renderTable(allSuppliers);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function filterTable() {
  const qEl = document.getElementById('searchInput');
  const stEl = document.getElementById('statusFilter');
  if (!qEl || !stEl) return;

  const q = qEl.value.toLowerCase();
  const st = stEl.value;

  renderTable(
    allSuppliers.filter(s => {
      const matchQ =
        !q ||
        (s.razon_social || '').toLowerCase().includes(q) ||
        (s.nif || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q);
      return matchQ && (!st || s.status === st);
    })
  );
}

function renderTable(suppliers) {
  const tbody = document.getElementById('suppliersBody');
  if (!tbody) return;

  if (!suppliers.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:2.5rem;color:var(--text-faint)">Sin resultados.</td></tr>';
    return;
  }

  const labels = {
    pendiente: 'Pendiente',
    revision: 'En revisión',
    aprobado: 'Aprobado',
    rechazado: 'Rechazado'
  };

  tbody.innerHTML = suppliers
    .map(
      s => `
    <tr>
      <td style="font-weight:600">${s.razon_social || '—'}</td>
      <td style="font-family:monospace;font-size:.82rem">${s.nif || '—'}</td>
      <td>${s.email || '—'}</td>
      <td><span class="badge badge-${s.status || 'pendiente'}">${labels[s.status] || 'Pendiente'}</span></td>
      <td style="color:var(--text-muted);font-size:.78rem">
        ${s.updated_at ? new Date(s.updated_at).toLocaleDateString('es-ES') : '—'}
      </td>
      <td>
        <select class="form-control" style="width:130px;font-size:.78rem;padding:.3rem .5rem"
          onchange="updateStatus('${s.id}',this.value)">
          <option value="">Cambiar…</option>
          <option value="revision">En revisión</option>
          <option value="aprobado">Aprobado</option>
          <option value="rechazado">Rechazado</option>
          <option value="pendiente">Pendiente</option>
        </select>
      </td>
      <td>
        <a href="/perfil/${s.id}" class="btn btn-secondary" style="font-size:.78rem;padding:.3rem .6rem">Ver</a>
        <a href="/perfil-edit/${s.id}" class="btn btn-primary" style="font-size:.78rem;padding:.3rem .6rem">Editar</a>
      </td>
    </tr>`
    )
    .join('');
}

async function updateStatus(id, status) {
  if (!status) return;
  try {
    const res = await fetch(`${API}/suppliers/admin/${id}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + adminToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Error al actualizar.');
    showToast('Estado actualizado.', 'success');
    await loadSuppliers();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function adminLogout() {
  adminToken = null;
  sessionStorage.removeItem('portal_token');
  sessionStorage.removeItem('portal_role');
  sessionStorage.removeItem('portal_email');
  const adminUserArea = document.getElementById('adminUserArea');
  if (adminUserArea) adminUserArea.style.display = 'none';
  window.location.href = '/';
}
