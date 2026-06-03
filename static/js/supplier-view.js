(function(){
  // Siempre usar rutas absolutas desde la raíz para evitar que /perfil/:id
  // corrompa la base de la API (e.g. window.APP_BASE daría '/perfil' en vez de '')
  const API = window.__API_BASE__ || '';
  // SUPPLIER_ID se inyecta desde la vista EJS cuando el admin visualiza un proveedor concreto
  const supplierId = window.SUPPLIER_ID || null;
  let currentProfile = { documents: [] };

  // Devuelve la URL de API correcta según si somos admin viendo otro proveedor o el propio
  function profileUrl() {
    return supplierId
      ? `/suppliers/admin/${supplierId}`
      : `/suppliers/me`;
  }

  async function fetchProfile() {
    try {
      const res = await fetch(profileUrl(), { headers: {         credentials: 'include' } });
      if (!res.ok) {
        window.location.href = supplierId ? '/proveedores' : '/perfil-edit';
        return;
      }
      const data = await res.json();
      currentProfile = data || { documents: [] };
      if (!supplierId && (!data || Object.keys(data).length === 0)) {
        window.location.href = '/perfil-edit';
        return;
      }

      const fields = {
        summary_razon_social: data.razon_social,
        summary_nombre_comercial: data.nombre_comercial,
        summary_nif: data.nif,
        summary_actividad: data.actividad,
        summary_tipo_via: data.tipo_via,
        summary_direccion: data.direccion,
        summary_codigo_postal: data.codigo_postal,
        summary_ciudad: data.ciudad,
        summary_pais_residencia_fiscal: data.pais_residencia_fiscal,
        summary_persona_contacto: data.persona_contacto,
        summary_email_contacto: data.email_contacto,
        summary_telefono: data.telefono,
        summary_iban: data.iban,
        summary_swift: data.swift,
        summary_banco: data.banco,
        summary_sucursal: data.sucursal,
        summary_moneda_pago: data.moneda_pago || 'EUR',
        summary_updatedAt: new Date(data.updated_at).toLocaleString('es-ES', { dateStyle: 'long' }),
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
      if (data.codigo_entidad && data.codigo_sucursal) {
        const addressEl = document.getElementById('branchAddressResult');
        if (addressEl) {
          fetch(`/branch-address?entidad=${encodeURIComponent(data.codigo_entidad)}&sucursal=${encodeURIComponent(data.codigo_sucursal)}`)
            .then(res => res.ok ? res.json() : Promise.reject())
            .then(json => { addressEl.textContent = json.address || 'No disponible'; })
            .catch(() => { addressEl.textContent = 'No disponible'; });
        }
      }
    } catch (e) {
      console.error('fetchProfile error', e);
      window.location.href = supplierId ? '/proveedores' : '/perfil-edit';
    }
  }

  async function openDocument(filename) {
    if (!filename) return;
    try {
      const res = await fetch(`/documents/download/${filename}`, {
        credentials: 'include'
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
      const res = await fetch(`/documents/download/${filename}`, {
        credentials: 'include'
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
      const res = await fetch(`/documents/${filename}`, {
        method: 'DELETE', headers: {         credentials: 'include' }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || 'No se pudo eliminar el documento.');
      }
      currentProfile.documents = (currentProfile.documents || []).filter(d => encodeURIComponent(d.filename) !== filename);
      try {
        await fetch(profileUrl(), {
          method: 'PUT', headers: {         credentials: 'include' },
          body: JSON.stringify({ documents: currentProfile.documents })
        });
      } catch (e) {
        console.error('Error al persistir metadatos tras eliminar:', e);
      }
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
    if (btn) btn.addEventListener('click', () => {
      window.location.href = supplierId ? `/perfil-edit/${supplierId}` : '/perfil-edit';
    });

    const tabs = Array.from(document.querySelectorAll('.tabs .tab'));
    tabs.forEach((tab, index) => tab.addEventListener('click', () => setActiveTab(index)));
    setActiveTab(0);
    fetchProfile();
  });
})();
