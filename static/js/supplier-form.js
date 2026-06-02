// Calcular la base de la API correctamente aunque la URL sea /perfil-edit/:id o /perfil/:id
// En esos casos window.location.pathname sería /perfil-edit/<uuid> y el replace devolvería
// '/perfil-edit', que es incorrecto. Siempre usamos la raíz '/'.
window.APP_BASE = '';
window.API = window.__API_BASE__ || '';
window.token = window.token || sessionStorage.getItem('portal_token') || null;


// SUPPLIER_ID se inyecta desde la vista EJS cuando el admin edita un proveedor concreto
const supplierId = window.SUPPLIER_ID || null;


const currentProfile = { documents: [] };


// Constantes y cachés para datos relacionados con direcciones, bancos y documentos
const VALID_VIA_TYPES = ['Calle','Avenida','Paseo','Plaza','Camino','Travesía','Carretera','Urbanización','Ronda'];
const DOC_TYPES = [
  'Certificado de titularidad bancaria',
  'Copia del modelo 036/037 donde conste el epígrafe de IAE',
  'Otro'
];
const CP_PROVINCES = {
  '01':'Álava','02':'Albacete','03':'Alicante','04':'Almería','05':'Ávila','06':'Badajoz','07':'Islas Baleares','08':'Barcelona',
  '09':'Burgos','10':'Cáceres','11':'Cádiz','12':'Castellón','13':'Ciudad Real','14':'Córdoba','15':'A Coruña','16':'Cuenca',
  '17':'Girona','18':'Granada','19':'Guadalajara','20':'Guipúzcoa','21':'Huelva','22':'Huesca','23':'Jaén','24':'León',
  '25':'Lleida','26':'La Rioja','27':'Lugo','28':'Madrid','29':'Málaga','30':'Murcia','31':'Navarra','32':'Ourense','33':'Asturias',
  '34':'Palencia','35':'Las Palmas','36':'Pontevedra','37':'Salamanca','38':'Santa Cruz de Tenerife','39':'Cantabria','40':'Segovia',
  '41':'Sevilla','42':'Soria','43':'Tarragona','44':'Teruel','45':'Toledo','46':'Valencia','47':'Valladolid','48':'Vizcaya','49':'Zamora',
  '50':'Zaragoza','51':'Ceuta','52':'Melilla'
};


if (!window.token) {
  window.location.href = '/';
}


// ── Helpers para el overlay de progreso ──────────────────────────────────────
let _barInterval = null;

function showOverlay() {
  const overlay = document.getElementById('overlay-actualizando');
  const barFill  = document.getElementById('bar-fill-actualizando');
  if (!overlay) return;
  overlay.style.display = 'flex';
  if (barFill) {
    let pct = 0;
    barFill.style.width = '0%';
    _barInterval = setInterval(() => {
      if (pct < 80) { pct += Math.random() * 8; barFill.style.width = Math.min(pct, 80) + '%'; }
    }, 250);
  }
}

function hideOverlay(success = true) {
  clearInterval(_barInterval);
  _barInterval = null;
  const overlay = document.getElementById('overlay-actualizando');
  const barFill  = document.getElementById('bar-fill-actualizando');
  if (barFill) barFill.style.width = success ? '100%' : '0%';
  // Breve pausa para que el usuario vea el 100 % antes de ocultar
  setTimeout(() => {
    if (overlay) overlay.style.display = 'none';
    if (barFill) barFill.style.width = '0%';
  }, success ? 600 : 0);
}


// Caché en memoria de entidades bancarias consultadas durante la sesión
const BANK_CODES = {};


// loadBankCodes ya no descarga un fichero estático (que no existe).
// La caché se rellena bajo demanda en fetchBankEntity().
async function loadBankCodes() {
  // No-op: mantenemos la firma para no cambiar el DOMContentLoaded listener.
}


// Consulta el endpoint /bank-entity y almacena el resultado en caché.
async function fetchBankEntity(bankCode) {
  if (!bankCode) return null;
  if (BANK_CODES[bankCode]) return BANK_CODES[bankCode];
  try {
    const res = await fetch(`/bank-entity?code=${encodeURIComponent(bankCode)}`);
    if (res.ok) {
      const data = await res.json();
      BANK_CODES[bankCode] = { nombre: data.name || '', swift: data.bic || '' };
      return BANK_CODES[bankCode];
    }
  } catch (e) {
    console.error('fetchBankEntity error', e);
  }
  return null;
}


async function getBankTextFromCode(bankCode) {
  if (!bankCode) return '';
  const entity = await fetchBankEntity(bankCode);
  if (entity && entity.nombre) return entity.nombre;
  return `Entidad ${bankCode}`;
}


function getBranchTextFromCode(branchCode) {
  if (!branchCode) return '';
  return `Sucursal ${branchCode}`;
}


async function getSwiftFromCode(bankCode) {
  if (!bankCode) return '';
  const entity = await fetchBankEntity(bankCode);
  return (entity && entity.swift) ? entity.swift : '';
}


// Extraer datos del IBAN
async function extractIbanData() {
  const ibanEl = document.getElementById('iban');
  const swiftEl = document.getElementById('swift');
  const bancoEl = document.getElementById('banco');
  const sucursalEl = document.getElementById('sucursal');
  if (!ibanEl || !swiftEl) return;

  const iban = ibanEl.value.trim().toUpperCase().replace(/\s+/g, '');
  const codigoEntidadEl = document.getElementById('codigo_entidad');
  const codigoSucursalEl = document.getElementById('codigo_sucursal');
  const branchAddressEl = document.getElementById('branchAddressResult');
  if (!iban || iban.length < 24) {
    swiftEl.value = '';
    if (bancoEl) bancoEl.value = '';
    if (sucursalEl) sucursalEl.value = '';
    if (codigoEntidadEl) codigoEntidadEl.value = '';
    if (codigoSucursalEl) codigoSucursalEl.value = '';
    if (branchAddressEl) branchAddressEl.textContent = 'No disponible';
    return;
  }

  // El IBAN español tiene formato: CC DD BBBB SSSS CCCCCCCCCC
  // CC = país, DD = dígitos de control, BBBB = código banco, SSSS = sucursal
  const countryCode = iban.substring(0, 2);
  const bankCode = iban.substring(4, 8);
  const branchCode = iban.substring(8, 12);

  if (countryCode !== 'ES') {
    swiftEl.value = '';
    if (bancoEl) bancoEl.value = '';
    if (sucursalEl) sucursalEl.value = '';
    if (codigoEntidadEl) codigoEntidadEl.value = '';
    if (codigoSucursalEl) codigoSucursalEl.value = '';
    if (branchAddressEl) branchAddressEl.textContent = 'No disponible';
    return;
  }

  const swift = await getSwiftFromCode(bankCode);
  const bankText = await getBankTextFromCode(bankCode);
  const branchText = getBranchTextFromCode(branchCode);

  swiftEl.value = swift;
  if (bancoEl) bancoEl.value = bankText;
  if (sucursalEl) sucursalEl.value = branchText;
  if (codigoEntidadEl) codigoEntidadEl.value = bankCode;
  if (codigoSucursalEl) codigoSucursalEl.value = branchCode;
  if (branchAddressEl && bankCode && branchCode) {
    fetchBranchAddress(bankCode, branchCode)
      .then(address => { branchAddressEl.textContent = address || 'No disponible'; })
      .catch(() => { branchAddressEl.textContent = 'No disponible'; });
  }
}


async function fetchBranchAddress(entidad, sucursal) {
  if (!entidad || !sucursal) return '';
  try {
    const res = await fetch(`/branch-address?entidad=${encodeURIComponent(entidad)}&sucursal=${encodeURIComponent(sucursal)}`);
    if (!res.ok) return '';
    const json = await res.json();
    return json.address || '';
  } catch (e) {
    console.error('fetchBranchAddress error', e);
    return '';
  }
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


async function loadSupplierData() {
  if (!window.token) return;
  try {
    const res = await fetch(profileUrl(), { headers: { 'Authorization': 'Bearer ' + window.token } });
    if (!res.ok) return;
    const data = await res.json();
    ['razon_social','nombre_comercial','nif','actividad','codigo_postal','ciudad',
     'persona_contacto','email_contacto','telefono','iban','swift','banco','sucursal','codigo_entidad','codigo_sucursal','pais_residencia_fiscal'].forEach(f => {
      const el = document.getElementById(f);
      if (el && data[f] !== undefined && data[f] !== null) el.value = data[f];
    });
    if (data.codigo_entidad && data.codigo_sucursal) {
      const branchAddressEl = document.getElementById('branchAddressResult');
      if (branchAddressEl) {
        fetchBranchAddress(data.codigo_entidad, data.codigo_sucursal)
          .then(address => { branchAddressEl.textContent = address || 'No disponible'; })
          .catch(() => { branchAddressEl.textContent = 'No disponible'; });
      }
    }
    const monedaEl = document.getElementById('moneda_pago');
    if (monedaEl && data.moneda_pago) {
      monedaEl.value = data.moneda_pago;
    } else if (monedaEl) {
      monedaEl.value = 'EUR';
    }
    const tipoViaEl = document.getElementById('tipo_via');
    const dirEl = document.getElementById('direccion');
    if (tipoViaEl && data.tipo_via) tipoViaEl.value = data.tipo_via;
    if (dirEl && data.direccion) {
      const parsed = parseAddressString(data.direccion);
      if (tipoViaEl && !tipoViaEl.value && parsed.tipo) tipoViaEl.value = parsed.tipo;
      dirEl.value = parsed.direccion;
    }
    if (data.iban) {
      await extractIbanData();
    }
    const altaEl = document.getElementById('alta_036');
    if (altaEl) {
      altaEl.value = data.alta_036 === true ? 'true' : data.alta_036 === false ? 'false' : 'none';
    }
    currentProfile.documents = Array.isArray(data.documents) ? data.documents : [];
    renderUploadedDocs(currentProfile.documents);
    updateStatusBadges(data);
  } catch (error) {
    console.error('Error loading profile', error);
  }
}


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


function normalizeNif(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}


function isValidNifNieCif(value) {
  const input = normalizeNif(value);
  if (!input) return false;
  const nifReg = /^[0-9]{8}[A-Z]$/;
  const nieReg = /^[XYZ][0-9]{7}[A-Z]$/;
  const cifReg = /^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/;
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';

  if (nifReg.test(input)) {
    return input[8] === letters[parseInt(input.substr(0, 8), 10) % 23];
  }

  if (nieReg.test(input)) {
    const prefix = { X: '0', Y: '1', Z: '2' };
    const number = prefix[input[0]] + input.substr(1, 7);
    return input[8] === letters[parseInt(number, 10) % 23];
  }

  if (cifReg.test(input)) {
    const digits = input.substr(1, 7).split('').map(Number);
    let sumA = 0;
    let sumB = 0;
    digits.forEach((digit, index) => {
      if (index % 2 === 0) {
        sumA += digit;
      } else {
        const doubled = digit * 2;
        sumB += Math.floor(doubled / 10) + (doubled % 10);
      }
    });
    const total = sumA + sumB;
    const control = (10 - (total % 10)) % 10;
    const controlLetters = 'JABCDEFGHI';
    return input[8] === String(control) || input[8] === controlLetters[control];
  }

  return false;
}


function getProvinceFromPostalCode(cp) {
  const postal = String(cp || '').trim();
  if (!validator || !validator.isPostalCode(postal, 'ES')) return null;
  return CP_PROVINCES[postal.slice(0, 2)] || null;
}


function parseAddressString(full) {
  const address = String(full || '').trim();
  for (const tipo of VALID_VIA_TYPES) {
    if (address.toLowerCase().startsWith(tipo.toLowerCase() + ' ')) {
      return { tipo, direccion: address.slice(tipo.length + 1).trim() };
    }
  }
  return { tipo: '', direccion: address };
}


function normalizeAddress(value) {
  const original = String(value || '').trim();
  if (!original) return '';
  const hasNumber = /\b(\d+|S\/?N)\b/i.test(original);
  if (hasNumber) return original;
  return original.replace(/\,*\s*$/, '') + ', S/N';
}


function validatePhoneNumber(value) {
  const phone = String(value || '').trim();
  if (!phone) return true;
  const normalized = phone.replace(/[\s()+-\.]/g, '');
  return /^\+?\d{9,15}$/.test(normalized);
}


function validateDocuments() {
  const docs = currentProfile.documents || [];
  const hasBankCert = docs.some(doc => {
    const label = (doc.type || doc.label || '').toString().toLowerCase();
    return label.includes('certificado de titularidad bancaria');
  });
  const has036 = docs.some(doc => {
    const label = (doc.type || doc.label || '').toString().toLowerCase();
    return label.includes('036/037') || label.includes('modelo 036') || label.includes('modelo 037');
  });
  const errors = [];
  if (!hasBankCert) {
    errors.push('Sube el Certificado de titularidad bancaria.');
  }
  const alta036 = document.getElementById('alta_036')?.value === 'true';
  if (alta036 && !has036) {
    errors.push('Sube la Copia del modelo 036/037 donde conste el epígrafe de IAE.');
  }
  return errors;
}


function openAltaModal() {
  const modal = document.getElementById('altaModal');
  if (!modal) return;
  modal.style.display = 'block';
  modal.removeAttribute('inert');
}


function closeAltaModal() {
  const modal = document.getElementById('altaModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('inert', '');
}


function submitAltaModal() {
  const selected = document.querySelector('input[name="altaHacienda"]:checked');
  if (!selected) {
    showToast('Selecciona si estás dado de alta en Hacienda.', 'error');
    return;
  }
  const alta = selected.value === 'si';
  const altaEl = document.getElementById('alta_036');
  if (altaEl) altaEl.value = alta ? 'true' : 'false';
  closeAltaModal();
  showToast('Respuesta registrada.', 'success');
}


function handleNifBlur() {
  const nifEl = document.getElementById('nif');
  const altaEl = document.getElementById('alta_036');
  if (!nifEl || !altaEl) return;
  const value = nifEl.value.trim();
  if (value && isValidNifNieCif(value) && altaEl.value === 'none') {
    openAltaModal();
  }
}


function validateFormFields() {
  const errors = [];
  const razon = document.getElementById('razon_social')?.value.trim();
  const nif = document.getElementById('nif')?.value.trim();
  const tipoVia = document.getElementById('tipo_via')?.value.trim();
  const direccionValue = document.getElementById('direccion')?.value.trim();
  const postal = document.getElementById('codigo_postal')?.value.trim();
  const ciudad = document.getElementById('ciudad')?.value.trim();
  const pais = document.getElementById('pais_residencia_fiscal')?.value.trim();
  const persona = document.getElementById('persona_contacto')?.value.trim();
  const email = document.getElementById('email_contacto')?.value.trim();
  const telefono = document.getElementById('telefono')?.value.trim();
  const iban = document.getElementById('iban')?.value.trim();

  if (!razon) errors.push('Razón social es obligatoria.');
  if (!nif) {
    errors.push('NIF/NIE/CIF es obligatorio.');
  } else if (!isValidNifNieCif(nif)) {
    errors.push('El NIF/NIE/CIF no es válido.');
  }
  if (!tipoVia) errors.push('Selecciona el tipo de vía.');
  if (!direccionValue) {
    errors.push('Nombre de la vía y número es obligatorio.');
  }
  if (direccionValue && !/\d|S\/?N/i.test(direccionValue)) {
    errors.push('Indica un número de vía o añade S/N en la dirección.');
  }
  if (!postal) {
    errors.push('El código postal es obligatorio.');
  } else if (!validator.isPostalCode(postal, 'ES')) {
    errors.push('El código postal debe ser un CP español de 5 dígitos.');
  }
  if (!ciudad) errors.push('La ciudad es obligatoria.');
  if (!pais) errors.push('El país de residencia fiscal es obligatorio.');
  if (!persona) errors.push('La persona de contacto es obligatoria.');
  if (!email) {
    errors.push('El email de contacto es obligatorio.');
  } else if (!validator.isEmail(email)) {
    errors.push('El email de contacto no es válido.');
  }
  if (telefono && !validatePhoneNumber(telefono)) {
    errors.push('El teléfono no es válido.');
  }
  if (!iban) {
    errors.push('El IBAN es obligatorio.');
  } else if (!validator.isIBAN(iban)) {
    errors.push('El IBAN no es válido.');
  }
  errors.push(...validateDocuments());
  return errors;
}


function collectSupplierData() {
  const tipoVia = document.getElementById('tipo_via')?.value.trim();
  const direccionValue = document.getElementById('direccion')?.value.trim();
  const postal = document.getElementById('codigo_postal')?.value.trim();
  const provincia = getProvinceFromPostalCode(postal);
  const normalizedDireccion = normalizeAddress(direccionValue);
  if (document.getElementById('direccion')) {
    document.getElementById('direccion').value = normalizedDireccion;
  }
  return {
    razon_social: document.getElementById('razon_social')?.value.trim(),
    nombre_comercial: document.getElementById('nombre_comercial')?.value.trim(),
    nif: normalizeNif(document.getElementById('nif')?.value.trim()),
    actividad: document.getElementById('actividad')?.value.trim(),
    tipo_via: tipoVia,
    direccion: `${normalizedDireccion}`.trim(),
    codigo_postal: postal,
    provincia,
    ciudad: document.getElementById('ciudad')?.value.trim(),
    pais_residencia_fiscal: document.getElementById('pais_residencia_fiscal')?.value.trim(),
    persona_contacto: document.getElementById('persona_contacto')?.value.trim(),
    email_contacto: document.getElementById('email_contacto')?.value.trim(),
    telefono: document.getElementById('telefono')?.value.trim(),
    iban: document.getElementById('iban')?.value.trim(),
    swift: document.getElementById('swift')?.value.trim(),
    banco: document.getElementById('banco')?.value.trim(),
    sucursal: document.getElementById('sucursal')?.value.trim(),
    codigo_entidad: document.getElementById('codigo_entidad')?.value.trim(),
    codigo_sucursal: document.getElementById('codigo_sucursal')?.value.trim(),
    moneda_pago: document.getElementById('moneda_pago')?.value || 'EUR',
    alta_036: document.getElementById('alta_036')?.value === 'true'
  };
}


async function saveDraft() { await saveSupplierData(false); }


async function saveSupplierData(submit = false) {
  if (!window.token) { showToast('Sesión no iniciada.', 'error'); return; }
  const errors = validateFormFields();
  if (submit && errors.length) {
    showToast(errors.join(' '), 'error');
    return;
  }

  if (submit) {
    const altaEl = document.getElementById('alta_036');
    if (!altaEl || altaEl.value === 'none') {
      openAltaModal();
      showToast('Responde si estás dado de alta en Hacienda antes de enviar.', 'error');
      return;
    }
  }

  if (errors.length) {
    showToast(errors.join(' '), 'error');
    return;
  }

  const body = collectSupplierData();
  const btn = document.getElementById('submitFormBtn');
  if (btn) btn.disabled = true;

  // Mostrar pestaña de carga (solo en envío final, no en borrador)
  if (submit && typeof showSendingTab === 'function') {
    showSendingTab();
  }

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
  if (typeEl && typeEl.value && !DOC_TYPES.includes(typeEl.value)) {
    errors.push('El tipo de documento no es válido.');
  }
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
  const tabs = Array.from(document.querySelectorAll('.tabs .tab:not(.tab-sending)'));
  const panels = Array.from(document.querySelectorAll('.tab-panel:not(#tab-sending)'));
  tabs.forEach((tab, idx) => tab.classList.toggle('active', idx === index));
  panels.forEach((panel, idx) => {
    panel.classList.toggle('active', idx === index);
    panel.style.display = idx === index ? '' : 'none';
  });
  const submitBtn = document.getElementById('submitFormBtn');
  if (submitBtn) {
    submitBtn.textContent = index === panels.length - 1 ? 'Enviar para revisión' : 'Siguiente';
  }
}


async function handlePostalCodeChange() {
  const postalEl = document.getElementById('codigo_postal');
  const provinciaEl = document.getElementById('provincia');
  const ciudadEl = document.getElementById('ciudad');

  if (!postalEl) {
    console.warn('handlePostalCodeChange: no se encontró el input codigo_postal');
    return;
  }

  const postal = postalEl.value.trim();
  if (!postal) {
    console.warn('handlePostalCodeChange: codigo_postal vacío');
    return;
  }

  if (!validator || !validator.isPostalCode(postal, 'ES')) {
    console.warn('handlePostalCodeChange: codigo_postal no válido', postal);
    return;
  }

  if (typeof CP_PROVINCES !== 'undefined') {
    const provinciaPorPrefijo = CP_PROVINCES[postal.slice(0, 2)];
    if (provinciaEl && provinciaPorPrefijo && !provinciaEl.value.trim()) {
      provinciaEl.value = provinciaPorPrefijo;
    }
  }

  try {
    const res = await fetch(`/postal-info?cp=${encodeURIComponent(postal)}`);
    if (!res.ok) {
      console.error('handlePostalCodeChange: respuesta no OK de /postal-info', res.status);
      return;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.error('postal-info devolvió contenido no JSON:', contentType);
      return;
    }

    const data = await res.json();
    if (provinciaEl && data.provincia) provinciaEl.value = data.provincia;
    if (ciudadEl && data.ciudad) ciudadEl.value = data.ciudad;
  } catch (e) {
    console.error('handlePostalCodeChange error', e);
  }
}


document.addEventListener('DOMContentLoaded', async () => {
  await loadBankCodes();
  await loadSupplierData();

  const cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => window.location.href = cancelUrl());

  const form = document.getElementById('supplierForm');
  const tabs = Array.from(document.querySelectorAll('.tabs .tab:not(.tab-sending)'));
  const panels = Array.from(document.querySelectorAll('.tab-panel:not(#tab-sending)'));

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
      // Último paso: saveSupplierData mostrará el overlay internamente
      await saveSupplierData(true);
    });
  }

  const nifEl = document.getElementById('nif');
  if (nifEl) nifEl.addEventListener('blur', handleNifBlur);

  const ibanEl = document.getElementById('iban');
  if (ibanEl) ibanEl.addEventListener('blur', () => extractIbanData().catch(e => console.error('IBAN extraction error', e)));

  const postalEl = document.getElementById('codigo_postal');
  if (postalEl) {
    postalEl.addEventListener('blur', handlePostalCodeChange);
    postalEl.addEventListener('change', handlePostalCodeChange);
  }

  const input = document.querySelector('#telefono');
  if (!input) return;
  const iti = window.intlTelInput(input, {
    initialCountry: 'es',
    preferredCountries: ['es', 'pt', 'fr', 'it', 'gb'],
    separateDialCode: true,
    nationalMode: false,
    strictMode: true
  });

  const typeSelect = document.getElementById('documentType');
  if (typeSelect) typeSelect.addEventListener('change', onDocumentTypeChange);

  const initialIndex = panels.findIndex(p => p.classList.contains('active'));
  setActiveTab(initialIndex >= 0 ? initialIndex : 0);
});