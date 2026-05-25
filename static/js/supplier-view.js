(function(){
  const API = window.API || (window.APP_BASE || '').replace(/\/$/, '');
  const token = sessionStorage.getItem('portal_token') || window.token || null;
  let currentProfile = { documents: [] };
  if (!token) {
    window.location.href = '/';
  }

  async function fetchProfile() {
    try {
      const res = await fetch(`${API}/suppliers/me`, { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) {
        window.location.href = '/perfil-edit';
        return;
      }
      const data = await res.json();
      currentProfile = data || { documents: [] };
      if (!data || Object.keys(data).length === 0) {
        window.location.href = '/perfil-edit';
        return;
      }

      const fields = {
        summary_razon_social: data.razon_social,
        summary_nombre_comercial: data.nombre_comercial,
        summary_nif: data.nif,
        summary_actividad: data.actividad,
        summary_direccion: data.direccion,
        summary_codigo_postal: data.codigo_postal,
        summary_ciudad: data.ciudad,
        summary_persona_contacto: data.persona_contacto,
        summary_email_contacto: data.email_contacto,
        summary_telefono: data.telefono,
        summary_iban: data.iban,
        summary_banco: data.banco,
        summary_docs: (currentProfile.documents && currentProfile.documents.length) ? 'Subidos' : 'Pendiente',
        summary_files: (currentProfile.documents && currentProfile.documents.length)
          ? currentProfile.documents.map(doc => {
              const label = doc.label || doc.type || doc.original || doc.filename;
              return `<div class="doc-row"><button type="button" class="doc-link" onclick="openDocument('${encodeURIComponent(doc.filename)}')">${label}</button><span class="doc-actions"><button type="button" class="doc-action" title="Ver" onclick="openDocument('${encodeURIComponent(doc.filename)}')"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path><circle cx="12" cy="12" r="3"></circle></svg></button><button type="button" class="doc-action" title="Descargar" onclick="downloadDocument('${encodeURIComponent(doc.filename)}')"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2z"></path><path d="M12 11v6"></path><path d="M9 14l3 3 3-3"></path></svg></button><button type="button" class="doc-action" title="Eliminar" onclick="deleteDocument('${encodeURIComponent(doc.filename)}')"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg></button></span></div>`;
            }).join('')
          : 'No hay archivos cargados.'
      };

      Object.entries(fields).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'summary_files') {
          el.innerHTML = value;
        } else {
          el.textContent = value || '—';
        }
      });
    } catch (e) {
      console.error('fetchProfile error', e);
      window.location.href = '/perfil-edit';
    }
  }

  async function openDocument(filename) {
    if (!filename) return;
    try {
      const res = await fetch(`${API}/documents/download/${filename}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.detail || 'No se pudo descargar el documento.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error('download error', err);
      alert(err.message || 'Error al descargar el documento.');
    }
  }

  window.openDocument = openDocument;

  window.downloadDocument = downloadDocument;
  window.deleteDocument = deleteDocument;

  async function downloadDocument(filename) {
    if (!filename) return;
    try {
      const res = await fetch(`${API}/documents/download/${filename}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.detail || 'No se pudo descargar el documento.');
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
      alert(err.message || 'Error al descargar el documento.');
    }
  }

  async function deleteDocument(filename) {
    if (!filename) return;
    if (!confirm('¿Eliminar este documento?')) return;
    try {
      const res = await fetch(`${API}/documents/${filename}`, {
        method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || 'No se pudo eliminar el documento.');
      }
      // Actualizar la lista local y persistir en gestion para que no reaparezca
      currentProfile.documents = (currentProfile.documents || []).filter(d => encodeURIComponent(d.filename) !== filename);
      try {
        await fetch(`${API}/suppliers/me`, {
          method: 'PUT', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ documents: currentProfile.documents })
        });
      } catch (e) {
        console.error('Error al persistir metadatos tras eliminar:', e);
      }
      // Re-renderizar perfil sin recargar la página
      fetchProfile();
    } catch (err) {
      console.error('delete error', err);
      alert(err.message || 'Error al eliminar el documento.');
    }
  }

  function setActiveTab(index) {
    const tabs = Array.from(document.querySelectorAll('.tabs .tab'));
    const panels = Array.from(document.querySelectorAll('.tab-panel'));
    tabs.forEach((tab, idx) => tab.classList.toggle('active', idx === index));
    panels.forEach((panel, idx) => panel.classList.toggle('active', idx === index));
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('editProfileBtn');
    if (btn) btn.addEventListener('click', () => window.location.href = '/perfil-edit');

    const tabs = Array.from(document.querySelectorAll('.tabs .tab'));
    tabs.forEach((tab, index) => tab.addEventListener('click', () => setActiveTab(index)));
    setActiveTab(0);
    fetchProfile();
  });
})();
