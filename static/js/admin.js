window.APP_BASE = window.APP_BASE || window.location.pathname.replace(/\/[^/]*$/, '');
window.API = window.API || (window.__API_BASE__ || window.APP_BASE).replace(/\/$/, '');

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
  const nameInput = document.getElementById('inviteNameInput');

  if (!modal || !options || !form) return;

  modal.style.display = 'flex';
  options.style.display = 'block';
  form.style.display = 'none';

  if (error) error.style.display = 'none';
  if (success) success.style.display = 'none';
  if (input) input.value = '';
  if (nameInput) nameInput.value = '';
}

function closeInviteModal() {
  const modal = document.getElementById('inviteModal');
  if (!modal) return;
  modal.style.display = 'none';
}

function showInviteForm() {
  const modal = document.getElementById('inviteModal');
  const options = document.getElementById('inviteOptionScreen');
  const form = document.getElementById('inviteFormScreen');
  const error = document.getElementById('inviteError');
  const success = document.getElementById('inviteSuccess');

  if (!modal || !options || !form) return;

  modal.style.display = 'flex';
  options.style.display = 'none';
  form.style.display = 'block';

  if (error) error.style.display = 'none';
  if (success) success.style.display = 'none';
}

async function fetchCurrentUser() {
  const res = await fetch(`${API}/auth/me`, {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });

  const raw = await res.text();
  console.log('/auth/me status:', res.status, 'body:', raw);

  if (!res.ok) {
    throw new Error(`auth/me ${res.status}`);
  }

  let me;
  try {
    me = JSON.parse(raw);
  } catch {
    throw new Error('auth/me no devolvió JSON');
  }

  if (!me || !me.role) {
    throw new Error('auth/me sin role');
  }

  return me;
}

async function inviteSupplier() {
  const emailInput = document.getElementById('inviteEmailInput');
  const nameInput = document.getElementById('inviteNameInput');
  const error = document.getElementById('inviteError');
  const success = document.getElementById('inviteSuccess');

  if (!emailInput || !error || !success) return;

  const email = emailInput.value.trim();
  const name = nameInput ? nameInput.value.trim() : '';

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
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, email })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || 'Error al enviar la invitación.');
    }

    success.textContent = 'Invitación enviada correctamente.';
    success.style.display = 'block';
    emailInput.value = '';
    if (nameInput) nameInput.value = '';

    await loadSuppliers();
  } catch (e) {
    error.textContent = e.message || 'Error al enviar la invitación.';
    error.style.display = 'block';
    success.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const dashboard = document.getElementById('admin-dashboard');
  const adminEmailDisplay = document.getElementById('adminEmailDisplay');
  const adminUserArea = document.getElementById('adminUserArea');

  try {
    const me = await fetchCurrentUser();
    adminEmailLocal = me.email || '';

    if (adminUserArea && adminEmailDisplay && adminEmailLocal) {
      adminEmailDisplay.textContent = adminEmailLocal;
      adminUserArea.style.display = 'flex';
    }

    if (dashboard) {
      await loadSuppliers();
    }
  } catch (e) {
      console.error('Fallo cargando sesión en /proveedores:', e);
      showToast('No se pudo validar la sesión.', 'error');
    return;
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.action-menu-wrapper')) {
      document.querySelectorAll('.action-menu').forEach(m => {
        m.style.display = 'none';
      });
    }

    if (!e.target.closest('.status-dropdown-wrapper')) {
      document.querySelectorAll('.status-dropdown').forEach(m => {
        m.style.display = 'none';
      });
    }
  });
});

async function loadSuppliers() {
  try {
    const res = await fetch(`${API}/suppliers/admin/list`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json'
      }
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || 'Error al cargar proveedores.');
    }

    allSuppliers = data.suppliers || [];

    const countEl = document.getElementById('supplierCount');
    if (countEl) {
      countEl.textContent = `${allSuppliers.length} proveedor(es) registrado(s)`;
    }

    renderTable(allSuppliers);
  } catch (e) {
    showToast(e.message || 'Error al cargar proveedores.', 'error');
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
        (s.alias || '').toLowerCase().includes(q) ||
        (s.nif || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        (s.responsible_email || '').toLowerCase().includes(q);

      return matchQ && (!st || s.status === st);
    })
  );
}

const STATUS_LABELS = {
  pendiente: 'Pendiente',
  revision: 'En revisión',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado'
};

const STATUS_NEXT = ['pendiente', 'revision', 'aprobado', 'rechazado'];

function renderTable(suppliers) {
  const tbody = document.getElementById('suppliersBody');
  if (!tbody) return;

  if (!suppliers.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align:center;padding:2.5rem;color:var(--text-faint)">Sin resultados.</td></tr>';
    return;
  }

  tbody.innerHTML = suppliers
    .map(s => {
      const nombre = s.alias || s.razon_social || s.nombre_comercial || s.email || '—';
      const responsable = s.responsible_email || '—';
      const status = s.status || 'pendiente';
      const fecha = s.updated_at ? new Date(s.updated_at).toLocaleDateString('es-ES') : '—';

      const statusOptions = STATUS_NEXT
        .filter(st => st !== status)
        .map(
          st => `
            <button
              class="status-option"
              onclick="updateStatus('${s.id}','${st}');closeStatusDropdown(this)"
              style="display:block;width:100%;text-align:left;padding:.4rem .75rem;border:none;background:none;cursor:pointer;font-size:.82rem;color:var(--text)"
            >
              ${STATUS_LABELS[st]}
            </button>
          `
        )
        .join('');

      return `
        <tr>
          <td style="font-weight:600">
            <a href="/perfil/${s.id}" style="color:var(--primary);text-decoration:none">${nombre}</a>
          </td>
          <td style="font-size:.82rem;color:var(--text-muted)">${responsable}</td>
          <td>
            <div class="status-dropdown-wrapper" style="position:relative;display:inline-block">
              <button
                class="badge badge-${status}"
                onclick="toggleStatusDropdown(this)"
                title="Cambiar estado"
                style="cursor:pointer;border:none;background:none;padding:0;font:inherit"
              >
                ${STATUS_LABELS[status]}
              </button>
              <div
                class="status-dropdown"
                style="display:none;position:absolute;top:110%;left:0;min-width:170px;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:.5rem;box-shadow:0 8px 24px rgba(0,0,0,.08);z-index:20;padding:.25rem 0"
              >
                ${statusOptions}
              </div>
            </div>
          </td>
          <td style="color:var(--text-muted);font-size:.78rem">${fecha}</td>
        </tr>
      `;
    })
    .join('');
}

function toggleActionMenu(btn) {
  document.querySelectorAll('.action-menu').forEach(m => {
    if (m !== btn.nextElementSibling) m.style.display = 'none';
  });

  const menu = btn.nextElementSibling;
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
}

function toggleStatusDropdown(btn) {
  document.querySelectorAll('.status-dropdown').forEach(m => {
    if (m !== btn.nextElementSibling) m.style.display = 'none';
  });

  const dropdown = btn.nextElementSibling;
  if (dropdown) {
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  }
}

function closeStatusDropdown(optionBtn) {
  const dropdown = optionBtn.closest('.status-dropdown');
  if (dropdown) dropdown.style.display = 'none';
}

async function updateStatus(id, status) {
  if (!status) return;

  try {
    const res = await fetch(`${API}/suppliers/admin/${id}/status`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || 'Error al actualizar.');
    }

    showToast('Estado actualizado.', 'success');
    await loadSuppliers();
  } catch (e) {
    showToast(e.message || 'Error al actualizar.', 'error');
  }
}

async function adminLogout() {
  try {
    await fetch(`${API}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json'
      }
    });
  } catch (e) {
    console.warn('Error al cerrar sesión', e);
  } finally {
    sessionStorage.removeItem('portal_token');
    sessionStorage.removeItem('portal_role');
    sessionStorage.removeItem('portal_email');
    window.location.href = '/';
  }
}