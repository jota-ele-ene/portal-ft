let adminToken = null, allSuppliers = [], adminEmailLocal = '';

function showAdminStep(id) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (type ? ' toast-' + type : '');
  clearTimeout(window._tt); window._tt = setTimeout(() => t.className = '', 4000);
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#adminOtpInputs .otp-digit').forEach((input, i, all) => {
    input.addEventListener('input', () => {
      input.classList.toggle('filled', !!input.value);
      if (input.value && i < all.length - 1) all[i+1].focus();
    });
    input.addEventListener('keydown', e => { if (e.key==='Backspace' && !input.value && i>0) all[i-1].focus(); });
    input.addEventListener('paste', e => {
      e.preventDefault();
      const p = (e.clipboardData||window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6);
      [...p].forEach((ch,j) => { if(all[j]){ all[j].value=ch; all[j].classList.add('filled'); } });
    });
  });
});

async function adminLogin() {
  const email = document.getElementById('adminEmailInput').value.trim();
  if (!email) { showToast('Introduce un correo.', 'error'); return; }
  adminEmailLocal = email;
  try {
    const res = await fetch('/api/auth/otp/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al solicitar OTP.');
    document.getElementById('adminOtpEmail').textContent = `Código enviado a ${email}`;
    showAdminStep('admin-otp');
    document.querySelector('#adminOtpInputs .otp-digit').focus();
  } catch (e) { showToast(e.message, 'error'); }
}

async function adminVerifyOtp() {
  const otp = [...document.querySelectorAll('#adminOtpInputs .otp-digit')].map(i => i.value).join('');
  const errEl = document.getElementById('adminOtpError');
  if (otp.length < 6) { errEl.textContent='Introduce los 6 dígitos.'; errEl.style.display='block'; return; }
  errEl.style.display = 'none';
  try {
    const res = await fetch('/api/auth/otp/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmailLocal, otp })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Código incorrecto.');
    if (data.role !== 'admin') throw new Error('Sin permisos de administrador.');
    adminToken = data.access_token;
    document.getElementById('adminEmailDisplay').textContent = adminEmailLocal;
    document.getElementById('adminUserArea').style.display = 'flex';
    showAdminStep('admin-dashboard');
    loadSuppliers();
  } catch (e) { errEl.textContent=e.message; errEl.style.display='block'; }
}

async function loadSuppliers() {
  try {
    const res = await fetch('/api/suppliers/admin/list', { headers: { 'Authorization': 'Bearer ' + adminToken } });
    if (!res.ok) throw new Error('Error al cargar proveedores.');
    const data = await res.json();
    allSuppliers = data.suppliers || [];
    document.getElementById('supplierCount').textContent = `${allSuppliers.length} proveedor(es) registrado(s)`;
    renderTable(allSuppliers);
  } catch (e) { showToast(e.message, 'error'); }
}

function filterTable() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const st = document.getElementById('statusFilter').value;
  renderTable(allSuppliers.filter(s => {
    const matchQ = !q || (s.razon_social||'').toLowerCase().includes(q) || (s.nif||'').toLowerCase().includes(q) || (s.email||'').toLowerCase().includes(q);
    return matchQ && (!st || s.status === st);
  }));
}

function renderTable(suppliers) {
  const tbody = document.getElementById('suppliersBody');
  if (!suppliers.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2.5rem;color:var(--text-faint)">Sin resultados.</td></tr>'; return; }
  const labels = { pendiente:'Pendiente', revision:'En revisión', aprobado:'Aprobado', rechazado:'Rechazado' };
  tbody.innerHTML = suppliers.map(s => `
    <tr>
      <td style="font-weight:600">${s.razon_social||'—'}</td>
      <td style="font-family:monospace;font-size:.82rem">${s.nif||'—'}</td>
      <td>${s.email||'—'}</td>
      <td><span class="badge badge-${s.status||'pendiente'}">${labels[s.status]||'Pendiente'}</span></td>
      <td style="color:var(--text-muted);font-size:.78rem">${s.updated_at ? new Date(s.updated_at).toLocaleDateString('es-ES') : '—'}</td>
      <td>
        <select class="form-control" style="width:130px;font-size:.78rem;padding:.3rem .5rem" onchange="updateStatus('${s.id}',this.value)">
          <option value="">Cambiar…</option>
          <option value="revision">En revisión</option>
          <option value="aprobado">Aprobado</option>
          <option value="rechazado">Rechazado</option>
          <option value="pendiente">Pendiente</option>
        </select>
      </td>
    </tr>`).join('');
}

async function updateStatus(id, status) {
  if (!status) return;
  try {
    const res = await fetch(`/api/suppliers/admin/${id}/status`, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Error al actualizar.');
    showToast('Estado actualizado.', 'success');
    await loadSuppliers();
  } catch (e) { showToast(e.message, 'error'); }
}

function logout() { adminToken = null; document.getElementById('adminUserArea').style.display='none'; showAdminStep('admin-login'); }
