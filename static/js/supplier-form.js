window.APP_BASE = window.APP_BASE || window.location.pathname.replace(/\/[^/]*$/, '');
window.API = window.API || (window.__API_BASE__ || window.APP_BASE).replace(/\/$/, '');
const pendingFiles = [];

// Recuperar token desde sessionStorage
window.token = window.token || sessionStorage.getItem('portal_token') || null;

// Si no hay token, redirigir a login
if (!window.token) {
  window.location.href = '/';
}

window.loadSupplierData = async function() {
  if (!window.token) return;
  try {
    const res = await fetch(`${API}/suppliers/me`, { headers: { 'Authorization': 'Bearer ' + window.token } });
    if (!res.ok) return;
    const data = await res.json();
    ['razon_social','nombre_comercial','nif','actividad','direccion','codigo_postal','ciudad',
     'persona_contacto','email_contacto','telefono','iban','banco'].forEach(f => {
      const el = document.getElementById(f);
      if (el && data[f]) el.value = data[f];
    });
    updateStatusBadges(data);
  } catch {}
};

function updateStatusBadges(data) {
  if (data.razon_social && data.nif && data.direccion) setBadge('statusFiscal','aprobado');
  if (data.persona_contacto && data.email_contacto) setBadge('statusContacto','aprobado');
  if (data.iban) setBadge('statusBancario','aprobado');
}

function setBadge(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  const labels = { pendiente:'Pendiente', revision:'En revisión', aprobado:'Completado', rechazado:'Rechazado' };
  el.className = `badge badge-${status}`;
  el.textContent = labels[status] || status;
}

async function saveDraft() { await saveSupplierData(false); }

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show' + (type ? ' toast-' + type : '');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => (t.className = ''), 4000);
}

function showStep(stepId) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  const step = document.getElementById(stepId);
  if (step) step.classList.add('active');
}

function goToForm() {
  showStep('step-form');
  loadSupplierData();
}

document.addEventListener('DOMContentLoaded', () => {
  // Cargar datos guardados del proveedor
  loadSupplierData();
  
  const form = document.getElementById('supplierForm');
  if (form) form.addEventListener('submit', async e => { e.preventDefault(); await saveSupplierData(true); });
  const zone = document.getElementById('uploadZone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });
  }
});

async function saveSupplierData(submit = false) {
  if (!window.token) { showToast('Sesión no iniciada.', 'error'); return; }
  const fields = ['razon_social','nombre_comercial','nif','actividad','direccion','codigo_postal',
                  'ciudad','persona_contacto','email_contacto','telefono','iban','banco'];
  const required = ['razon_social','nif','direccion','persona_contacto','email_contacto','iban'];
  const body = {}; let valid = true;
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el && el.value.trim()) body[f] = el.value.trim();
    if (required.includes(f) && (!el || !el.value.trim())) { valid = false; if(el) el.classList.add('is-invalid'); }
    else if (el) el.classList.remove('is-invalid');
  });
  if (submit && !valid) { showToast('Completa los campos obligatorios marcados con *', 'error'); return; }
  const btn = document.getElementById('submitFormBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API}/suppliers/me`, {
      method: 'PUT', headers: { 'Authorization': 'Bearer ' + window.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Error al guardar los datos.');
    const saved = await res.json();
    updateStatusBadges(saved);
    if (pendingFiles.length > 0) await uploadPendingFiles();
    showToast(submit ? '¡Datos enviados correctamente!' : 'Borrador guardado.', 'success');
    if (submit) showStep('step-done');
  } catch (e) { showToast(e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

function handleFiles(files) {
  [...files].forEach(file => {
    if (file.size > 10 * 1024 * 1024) { showToast(`${file.name} supera 10 MB.`, 'error'); return; }
    pendingFiles.push(file);
    const list = document.getElementById('fileList');
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;background:var(--bg);border-radius:var(--radius-md);font-size:.82rem;border:1px solid var(--border)';
    item.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${file.name}</span><span style="color:var(--text-faint);font-size:.75rem">${(file.size/1024).toFixed(0)} KB</span>`;
    if (list) list.appendChild(item);
  });
  setBadge('statusDocs', pendingFiles.length > 0 ? 'revision' : 'pendiente');
}

async function uploadPendingFiles() {
  for (const file of pendingFiles) {
    const fd = new FormData();
    fd.append('file', file);
    await fetch(`${API}/documents/upload`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + window.token }, body: fd });
  }
  pendingFiles.length = 0;
  setBadge('statusDocs', 'aprobado');
}

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tabs .tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');

      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(target).classList.add('active');
    });
  });
});