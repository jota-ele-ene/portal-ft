// Calcular la base de la API correctamente aunque la URL sea /perfil-edit/:id o /perfil/:id
// En esos casos window.location.pathname sería /perfil-edit/<uuid> y el replace devolvería
// '/perfil-edit', que es incorrecto. Siempre usamos la raíz '/'.
window.APP_BASE = '';
window.API = window.__API_BASE__ || '';
window.token = window.token || sessionStorage.getItem('portal_token') || null;

// SUPPLIER_ID se inyecta desde la vista EJS cuando el admin edita un proveedor concreto
const supplierId = window.SUPPLIER_ID || null;

const currentProfile = { documents: [] };

if (!window.token) {
  window.location.href = '/';
}

// Devuelve la URL de API correcta según si somos admin editando otro proveedor o el propio
function profileUrl() {
  return supplierId
    ? `/suppliers/admin/${supplierId}`
    : `/suppliers/me`;
}

// URL a la que navegar al cancelar
function cancelUrl() {
  return supplierId ? `/perfil/${supplierId}` : '/perfil';
}

window.loadSupplierData = async function() {
  if (!window.token) return;
  try {
    const res = await fetch(profileUrl(), { headers: { 'Authorization': 'Bearer ' + window.token } });
    if (!res.ok) return;
    const data = await res.json();
    ['razon_social','nombre_comercial','nif','actividad','direccion','codigo_postal','ciudad',
     'persona_contacto','email_contacto','telefono','iban','banco'].forEach(f => {
      const el = document.getElementById(f);
      if (el && data[f] !== undefined && data[f] !== null) el.value = data[f];
    });
    currentProfile.documents = Array.isArray(data.documents) ? data.documents : [];
    renderUploadedDocs(currentProfile.documents);
    updateStatusBadges(data);
  } catch (error) {
    console.error('Error loading profile', error);
  }
};

function renderUploadedDocs(documents) {
  const container = document.getElementById('uploadedDocs');
  if (!container) return;
  if (!documents || documents.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:.95rem">No hay documentos cargados todavía.</div>';
    setBadge('statusDocs', 'pendiente');
    return;
  }

  const rows = documents.map(doc => {
    const label = doc.label || doc.type || doc.original || doc.filename;
    return `
      <div class="doc-row">
        <button type="button" class="doc-link" onclick="openDocument('${encodeURIComponent(doc.filename)}')">${label}</button>
        <span class="doc-actions">
          <button type="button" class="doc-action" title="Ver" onclick="openDocument('${encodeURIComponent(doc.filename)}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
          <button type="button" class="doc-action" title="Descargar" onclick="downloadDocument('${encodeURIComponent(doc.filename)}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2z"></path><path d="M12 11v6"></path><path d="M9 14l3 3 3-3"></path></svg>
          </button>
          <button type="button" class="doc-action" title="Eliminar" onclick="deleteDocument('${encodeURIComponent(doc.filename)}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </span>
      </div>`;
  }).join('');

  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:.75rem">${rows}</div>`;
  setBadge('statusDocs', documents.length ? 'aprobado' : 'pendiente');
}

async function openDocument(filename) {
  if (!filename || !window.token) return;
  try {
    const res = await fetch(`/documents/download/${filename}`, {
      headers: { 'Authorization': 'Bearer ' + window.token }
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      throw new Error(errData?.detail || 'No se pudo abrir el documento.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    console.error('openDocument error', err);
    showToast(err.message || 'Error al abrir el documento.', 'error');
  }
}

function updateStatusBadges(data) {
  if (data.razon_social && data.nif && data.direccion) setBadge('statusFiscal','aprobado');
  if (data.persona_contacto && data.email_contacto) setBadge('statusContacto','aprobado');
  if (data.iban) setBadge('statusBancario','aprobado');
  setBadge('statusDocs', (Array.isArray(data.documents) && data.documents.length) ? 'aprobado' : 'pendiente');
}

function setBadge(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  const labels = { pendiente:'Pendiente', revision:'En revisión', aprobado:'Completado', rechazado:'Rechazado' };
  el.className = `badge badge-${status}`;
  el.textContent = labels[status] || status;
}

async function saveDraft() { await saveSupplierData(false); }

async function saveSupplierData(submit = false) {
  if (!window.token) { showToast('Sesión no iniciada.', 'error'); return; }
  const fields = ['razon_social','nombre_comercial','nif','actividad','direccion','codigo_postal',
                  'ciudad','persona_contacto','email_contacto','telefono','iban','banco'];
  const required = ['razon_social','nif','direccion','persona_contacto','email_contacto','iban'];
  const body = {};
  let valid = true;

  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el && el.value.trim()) body[f] = el.value.trim();
    if (required.includes(f) && (!el || !el.value.trim())) {
      valid = false;
      if (el) el.classList.add('is-invalid');
    } else if (el) {
      el.classList.remove('is-invalid');
    }
  });

  if (submit && !valid) {
    showToast('Completa los campos obligatorios marcados con *', 'error');
    return;
  }

  const btn = document.getElementById('submitFormBtn');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(profileUrl(), {
      method: 'PUT', headers: { 'Authorization': 'Bearer ' + window.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.detail || 'Error al guardar los datos.');
    }
    const saved = await res.json();
    updateStatusBadges(saved);
    showToast(
      submit ? '¡Datos guardados correctamente!' : 'Borrador guardado.',
      'success',
      submit ? () => window.location.href = cancelUrl() : null
    );
  } catch (e) {
    showToast(e.message || 'Error al guardar.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showToast(msg, type = '', onHide) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show' + (type ? ' toast-' + type : '');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    t.className = '';
    if (typeof onHide === 'function') onHide();
  }, 4000);
}

function openUploadModal() {
  const modal = document.getElementById('uploadModal');
  if (!modal) return;
  modal.style.display = 'block';
  modal.removeAttribute('inert');
  document.getElementById('documentType').value = '';
  document.getElementById('documentLabel').value = '';
  document.getElementById('documentFile').value = '';
  document.getElementById('customLabelGroup').style.display = 'none';
}

function closeUploadModal() {
  const modal = document.getElementById('uploadModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('inert', '');
}

function onDocumentTypeChange() {
  const type = document.getElementById('documentType').value;
  const custom = document.getElementById('customLabelGroup');
  if (!custom) return;
  custom.style.display = type === 'Otro' ? 'block' : 'none';
}

async function submitDocumentUpload() {
  const typeEl = document.getElementById('documentType');
  const fileEl = document.getElementById('documentFile');
  const labelEl = document.getElementById('documentLabel');
  const errors = [];

  if (!typeEl || !typeEl.value) errors.push('Selecciona un tipo de documento.');
  if (!fileEl || !fileEl.files.length) errors.push('Selecciona un fichero para subir.');
  if (typeEl && typeEl.value === 'Otro' && labelEl && !labelEl.value.trim()) {
    errors.push('Escribe un nombre visible para el documento.');
  }
  if (errors.length) {
    showToast(errors.join(' '), 'error');
    return;
  }

  const file = fileEl.files[0];
  if (file.size > 10 * 1024 * 1024) {
    showToast('El fichero supera el límite de 10 MB.', 'error');
    return;
  }

  const form = new FormData();
  form.append('file', file);
  form.append('document_type', typeEl.value);
  form.append('document_label', (typeEl.value === 'Otro' ? labelEl.value.trim() : typeEl.value));

  try {
    const res = await fetch(`/documents/upload`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + window.token }, body: form
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || 'Error al subir el documento.');
    }
    const uploaded = await res.json();
    const newDoc = {
      filename: uploaded.filename,
      original: uploaded.original,
      type: uploaded.type,
      label: uploaded.label,
      uploaded_at: uploaded.uploaded_at
    };
    currentProfile.documents = currentProfile.documents.filter(d => d.filename !== newDoc.filename).concat(newDoc);
    await saveDocumentMetadata(currentProfile.documents);
    renderUploadedDocs(currentProfile.documents);
    showToast('Documento subido correctamente.', 'success');
    closeUploadModal();
  } catch (e) {
    showToast(e.message || 'Error al subir el documento.', 'error');
  }
}

async function saveDocumentMetadata(documents) {
  if (!window.token) return;
  try {
    const res = await fetch(profileUrl(), {
      method: 'PUT', headers: { 'Authorization': 'Bearer ' + window.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || 'Error al guardar metadatos de documentos.');
    }
    await res.json();
  } catch (error) {
    console.error('saveDocumentMetadata error', error);
    showToast('No se pudo guardar la información del documento.', 'error');
  }
}

function handleFiles(files) {
  return;
}

async function downloadDocument(filename) {
  if (!filename || !window.token) return;
  try {
    const res = await fetch(`/documents/download/${filename}`, {
      headers: { 'Authorization': 'Bearer ' + window.token }
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      throw new Error(errData?.detail || 'No se pudo descargar el documento.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = decodeURIComponent(filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    console.error('download error', err);
    showToast(err.message || 'Error al descargar el documento.', 'error');
  }
}

async function deleteDocument(filename) {
  if (!filename || !window.token) return;
  if (!confirm('¿Eliminar este documento?')) return;
  try {
    const res = await fetch(`/documents/${filename}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + window.token }
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      throw new Error(errData?.detail || 'No se pudo eliminar el documento.');
    }
    currentProfile.documents = currentProfile.documents.filter(doc => encodeURIComponent(doc.filename) !== filename);
    await saveDocumentMetadata(currentProfile.documents);
    renderUploadedDocs(currentProfile.documents);
  } catch (err) {
    console.error('delete error', err);
    showToast(err.message || 'Error al eliminar el documento.', 'error');
  }
}

function setActiveTab(index) {
  const tabs = Array.from(document.querySelectorAll('.tabs .tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  tabs.forEach((tab, idx) => tab.classList.toggle('active', idx === index));
  panels.forEach((panel, idx) => panel.classList.toggle('active', idx === index));
  const submitBtn = document.getElementById('submitFormBtn');
  if (submitBtn) {
    submitBtn.textContent = index === panels.length - 1 ? 'Enviar para revisión' : 'Siguiente';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadSupplierData();

  // Botón cancelar: vuelve al perfil correcto según si somos admin o proveedor
  const cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => window.location.href = cancelUrl());

  const form = document.getElementById('supplierForm');
  const tabs = Array.from(document.querySelectorAll('.tabs .tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));

  tabs.forEach((tab, idx) => tab.addEventListener('click', () => setActiveTab(idx)));

  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const activeIndex = panels.findIndex(p => p.classList.contains('active'));
      const lastIndex = panels.length - 1;
      if (activeIndex < lastIndex) {
        setActiveTab(activeIndex + 1);
        return;
      }
      await saveSupplierData(true);
    });
  }

  const typeSelect = document.getElementById('documentType');
  if (typeSelect) typeSelect.addEventListener('change', onDocumentTypeChange);

  const initialIndex = panels.findIndex(p => p.classList.contains('active'));
  setActiveTab(initialIndex >= 0 ? initialIndex : 0);
});
