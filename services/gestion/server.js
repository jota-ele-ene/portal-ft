'use strict';

/**
 * Microservicio Gestión — Puerto 8002
 *
 * GET    /suppliers/me                    → perfil del proveedor autenticado
 * PUT    /suppliers/me                    → actualiza perfil (+ envía correo al responsable)
 * GET    /suppliers/admin/list           → lista todos (solo admin)
 * GET    /suppliers/admin/:id            → detalle de un proveedor (solo admin)
 * PUT    /suppliers/admin/:id            → edita un proveedor (solo admin, + correo)
 * PATCH  /suppliers/admin/:id/status     → cambia estado (solo admin)
 * GET    /health
 */

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 8002;

app.use(cors());
app.use(express.json());

const SECRET_KEY = process.env.JWT_SECRET || 'cambia-este-secreto-en-produccion';
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', '..', 'data');
const AUTH_DB_PATH = path.join(DATA_PATH, 'auth.json');
const DB_PATH = process.env.GESTION_DB_PATH || path.join(DATA_PATH, 'suppliers.json');

// ── Plantillas de correo ───────────────────────────────────────────────────────
const TEMPLATES_PATH = path.join(__dirname, '..', '..', 'email-templates');

function renderTemplate(name, data) {
  const jsonPath = path.join(TEMPLATES_PATH, `${name}.json`);
  const template = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const subjectRaw = template.subject || '';
  const htmlRaw = fs.readFileSync(path.join(TEMPLATES_PATH, template.html), 'utf8');
  const textRaw = fs.readFileSync(path.join(TEMPLATES_PATH, template.text), 'utf8');

  const replacer = (str) =>
    str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = data[key];
      if (val === undefined || val === null) return '';
      if (typeof val === 'boolean') return val ? 'Sí' : 'No';
      return String(val);
    });

  return {
    subject: replacer(subjectRaw),
    html: replacer(htmlRaw),
    text: replacer(textRaw)
  };
}

// ── Mailer ─────────────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: Number(process.env.SMTP_PORT) || 1025,
    secure: process.env.SMTP_SECURE === 'true',
    auth: (process.env.SMTP_USER && process.env.SMTP_PASS)
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  });
}

/**
 * Replica la misma lógica de sanitización de email que usa el servicio
 * de archivos (services/archivos/server.js) para construir el slug de
 * la carpeta donde se almacenan los documentos subidos.
 *
 * @param {string} email
 * @returns {string}
 */
function sanitizeEmail(email) {
  return (email || 'unknown').replace(/[^a-zA-Z0-9@._\-]/g, '_');
}

// ── Etiquetas legibles para los campos del proveedor ──────────────────────────
const FIELD_LABELS = {
  razon_social:           'Razón social',
  nombre_comercial:       'Nombre comercial',
  nif:                    'NIF / CIF',
  actividad:              'Actividad',
  tipo_via:               'Tipo de vía',
  direccion:              'Dirección',
  codigo_postal:          'Código postal',
  provincia:              'Provincia',
  ciudad:                 'Ciudad',
  pais_residencia_fiscal: 'País de residencia fiscal',
  persona_contacto:       'Persona de contacto',
  email_contacto:         'Email de contacto',
  email:                  'Email',
  telefono:               'Teléfono',
  iban:                   'IBAN',
  swift:                  'SWIFT / BIC',
  banco:                  'Banco',
  sucursal:               'Sucursal',
  codigo_entidad:         'Código entidad',
  codigo_sucursal:        'Código sucursal',
  moneda_pago:            'Moneda de pago',
  alta_036:               'Alta modelo 036',
  status:                 'Estado',
  responsible_email:      'Email responsable',
  created_at:             'Fecha de alta',
  updated_at:             'Última actualización'
};

const PROFILE_FIELD_ORDER = [
  'razon_social', 'nombre_comercial', 'nif', 'actividad',
  'tipo_via', 'direccion', 'codigo_postal', 'provincia', 'ciudad', 'pais_residencia_fiscal',
  'persona_contacto', 'email_contacto', 'email', 'telefono',
  'iban', 'swift', 'banco', 'sucursal', 'codigo_entidad', 'codigo_sucursal', 'moneda_pago',
  'alta_036', 'status', 'responsible_email', 'created_at', 'updated_at'
];

/**
 * Construye las filas HTML y texto plano con todos los datos del proveedor.
 * Omite campos internos (id, documents, etc.) y los que estén vacíos.
 */
function buildProfileRows(supplier) {
  const rows_html = [];
  const rows_text = [];

  PROFILE_FIELD_ORDER.forEach(field => {
    const raw = supplier[field];
    if (raw === undefined || raw === null || raw === '') return;

    const label = FIELD_LABELS[field] || field;
    const display = typeof raw === 'boolean' ? (raw ? 'Sí' : 'No') : String(raw);

    rows_html.push(
      `<tr>` +
      `<td style="padding:.5rem;border-bottom:1px solid #888;color:#666;width:40%;vertical-align:top">${label}</td>` +
      `<td style="padding:.5rem;border-bottom:1px solid #888;vertical-align:top">${display}</td>` +
      `</tr>`
    );
    rows_text.push(`${label}: ${display}`);
  });

  return {
    all_data_rows_html: rows_html.join(''),
    all_data_rows_text: rows_text.join('\n')
  };
}

async function sendResponsibleEmail(supplier) {
  const gestEmail = process.env.GEST_EMAIL;
  const responsibleEmail = supplier.responsible_email || process.env.DEFAULT_RESPONSIBLE_EMAIL;

  if (!gestEmail && !responsibleEmail) {
    console.warn('[gestion] sendResponsibleEmail: no hay destinatarios configurados (GEST_EMAIL o responsable).');
    return;
  }

  const to = gestEmail || responsibleEmail;
  const cc = gestEmail ? responsibleEmail : undefined;

  // ── Ruta correcta de documentos ──────────────────────────────────────────────
  // El servicio de archivos guarda los ficheros en:
  //   DATA_PATH/uploads/<sanitizeEmail(supplier.email)>/
  // (mismo algoritmo sanitizeEmail que services/archivos/server.js)
  const supplierEmail = supplier.email || supplier.email_contacto || '';
  const emailSlug = sanitizeEmail(supplierEmail);
  const supplierDocsDir = path.join(DATA_PATH, 'uploads', emailSlug);

  const docs = Array.isArray(supplier.documents) ? supplier.documents : [];

  const document_names = docs.length
    ? docs.map(doc => doc.label || doc.type || doc.original || doc.filename).join(', ')
    : 'Sin documentos adjuntos';

  const document_rows_html = docs.length
    ? docs.map(doc => {
        const label = doc.label || doc.type || doc.original || doc.filename;
        const original = doc.original || doc.filename || '';
        const uploaded = doc.uploaded_at || '';
        return `<tr>
          <td style="padding:.5rem;border-bottom:1px solid #888;color:#666;width:40%">Documento</td>
          <td style="padding:.5rem;border-bottom:1px solid #888">${label} <span style="color:#666">(${original}${uploaded ? `, ${uploaded}` : ''})</span></td>
        </tr>`;
      }).join('')
    : `<tr>
        <td style="padding:.5rem;border-bottom:1px solid #888;color:#666;width:40%">Documentos</td>
        <td style="padding:.5rem;border-bottom:1px solid #888">Sin documentos adjuntos</td>
      </tr>`;

  const document_rows_text = docs.length
    ? docs.map(doc => {
        const label = doc.label || doc.type || doc.original || doc.filename;
        const original = doc.original || doc.filename || '';
        const uploaded = doc.uploaded_at || '';
        return `- ${label}${original ? ` (${original}` : ''}${uploaded ? `${original ? ', ' : ' ('}${uploaded}` : ''}${original || uploaded ? ')' : ''}`;
      }).join('\n')
    : '- Sin documentos adjuntos';

  // ── Datos completos del proveedor ─────────────────────────────────────────
  const { all_data_rows_html, all_data_rows_text } = buildProfileRows(supplier);

  const templateData = {
    ...supplier,
    document_names,
    document_rows_html,
    document_rows_text,
    all_data_rows_html,
    all_data_rows_text,
    admin_email: process.env.ADMIN_EMAIL || process.env.DEFAULT_RESPONSIBLE_EMAIL || '',
    portal_url: process.env.PORTAL_URL || process.env.PORTAL_FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:8000'
  };

  const rendered = renderTemplate('perfil-actualizado', templateData);
  if (!rendered) return;
  const { subject, html, text } = rendered;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'portal@empresa.local';

  const attachments = docs
    .map(doc => {
      const filename = doc.filename;
      if (!filename) return null;
      const fullPath = path.join(supplierDocsDir, filename);
      if (!fs.existsSync(fullPath)) {
        console.warn(`[gestion] Adjunto no encontrado: ${fullPath}`);
        return null;
      }
      return {
        filename: doc.original || filename,
        path: fullPath
      };
    })
    .filter(Boolean);

  try {
    const transport = createTransport();
    await transport.sendMail({ from, to, cc, subject, html, text, attachments });
    console.log(`[gestion] Correo enviado a ${to}${cc ? ' con CC a ' + cc : ''} para proveedor ${supplier.id} con ${attachments.length} adjuntos`);
  } catch (e) {
    console.error('[gestion] Error enviando correo de notificación:', e.message);
  }
}

// ── JSON store ─────────────────────────────────────────────────────────────────
function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify({ suppliers: [] }), 'utf8');
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { suppliers: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function loadAuthDB() {
  try {
    if (!fs.existsSync(AUTH_DB_PATH)) return { users: [], otp_codes: [], revoked_tokens: [] };
    return JSON.parse(fs.readFileSync(AUTH_DB_PATH, 'utf8'));
  } catch {
    return { users: [], otp_codes: [], revoked_tokens: [] };
  }
}

function saveAuthDB(data) {
  fs.mkdirSync(path.dirname(AUTH_DB_PATH), { recursive: true });
  fs.writeFileSync(AUTH_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function isTokenRevoked(jti) {
  if (!jti) return false;
  const db = loadAuthDB();
  return Array.isArray(db.revoked_tokens) && db.revoked_tokens.some(item => item.jti === jti);
}

/**
 * Mapea el estado del proveedor (suppliers.json) al estado del usuario (auth.json).
 *
 * Mapa:
 *   pendiente → active   (el proveedor existe, puede acceder)
 *   revision  → active   (en revisión, sigue activo)
 *   aprobado  → active   (aprobado definitivamente)
 *   rechazado → disabled (se deniega el acceso)
 */
function supplierStatusToUserStatus(supplierStatus) {
  const map = {
    pendiente: 'active',
    revision:  'active',
    aprobado:  'active',
    rechazado: 'disabled'
  };
  return map[supplierStatus] || 'active';
}

/**
 * Sincroniza el estado del proveedor en el registro de usuario de auth.json.
 * Busca al usuario por email y actualiza su campo `status`.
 *
 * @param {string} email          - Email del proveedor
 * @param {string} supplierStatus - Nuevo estado en suppliers.json
 */
function syncUserStatusInAuthDB(email, supplierStatus) {
  console.log(`[gestion] syncUserStatusInAuthDB: sincronizando estado para ${email} → '${supplierStatus}'`);  
  if (!email) return;
  try {
    const authDB = loadAuthDB();
    if (!Array.isArray(authDB.users)) return;

    const userStatus = supplierStatusToUserStatus(supplierStatus);
    const user = authDB.users.find(u => u.email === email.toLowerCase().trim());

    console.log(`[gestion] syncUserStatusInAuthDB: usuario encontrado en auth.json:`, !!user, `actualizando status a '${userStatus}'`);
    if (user) {
      user.status = userStatus;
      user.updated_at = new Date().toISOString();
      saveAuthDB(authDB);
      console.log(`[gestion] auth.json actualizado: usuario ${email} → status '${userStatus}' (proveedor '${supplierStatus}')`);
    } else {
      console.warn(`[gestion] syncUserStatusInAuthDB: no se encontró usuario con email '${email}' en auth.json`);
    }
  } catch (e) {
    console.error('[gestion] Error sincronizando estado en auth.json:', e.message);
  }
}

/**
 * authenticate:
 * 1. Primero intenta sesión de servidor: req.session.user
 * 2. Si no existe, intenta Bearer JWT como fallback de compatibilidad
 */
function authenticate(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'No autenticado.' });
  }

  try {
    const payload = jwt.verify(auth.slice(7), SECRET_KEY);
    if (isTokenRevoked(payload.jti)) {
      return res.status(401).json({ detail: 'Token inválido o expirado.' });
    }

    req.user = {
      id: payload.id || null,
      email: payload.sub,
      role: payload.role,
      sub: payload.sub
    };

    return next();
  } catch {
    return res.status(401).json({ detail: 'Token inválido o expirado.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ detail: 'Acceso restringido a administradores.' });
  }
  next();
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function getOrCreate(db, email) {
  let s = db.suppliers.find(x => x.email_contacto === email || x.email === email);

  if (!s) {
    s = {
      id: crypto.randomUUID(),
      email,
      status: 'nuevo',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    return s;
  }

  // Normalizar suppliers invitados para que el formulario pueda prerrellenar
  return {
    ...s,
    razon_social: s.razon_social || s.alias || '',
    nombre_comercial: s.nombre_comercial || s.alias || '',
    persona_contacto: s.persona_contacto || s.alias || '',
    email_contacto: s.email_contacto || s.email || '',
    telefono: s.telefono || '',
    direccion: s.direccion || '',
    codigo_postal: s.codigo_postal || '',
    ciudad: s.ciudad || '',
    pais_residencia_fiscal: s.pais_residencia_fiscal || 'España',
    iban: s.iban || '',
    swift: s.swift || '',
    banco: s.banco || '',
    sucursal: s.sucursal || '',
    codigo_entidad: s.codigo_entidad || '',
    codigo_sucursal: s.codigo_sucursal || '',
    moneda_pago: s.moneda_pago || 'EUR',
    alta_036: typeof s.alta_036 === 'boolean' ? s.alta_036 : null
  };
}

function hasMinimum(s) {
  return s.razon_social && s.nif && s.persona_contacto && s.iban;
}

/**
 * Devuelve true si el body del PUT contiene únicamente la actualización
 * de documentos, sin cambios reales de perfil.
 */
function isDocumentsOnlyUpdate(body) {
  const profileFields = [
    'razon_social', 'nombre_comercial', 'nif', 'actividad', 'tipo_via', 'direccion',
    'codigo_postal', 'provincia', 'ciudad', 'pais_residencia_fiscal', 'persona_contacto',
    'email_contacto', 'telefono', 'iban', 'swift', 'banco', 'sucursal',
    'codigo_entidad', 'codigo_sucursal', 'moneda_pago', 'alta_036', 'status',
    'responsible_email'
  ];

  return (
    Array.isArray(body.documents) &&
    !profileFields.some(f => f in body)
  );
}

function updateUserStatus(db, email, status) {
  const user = db.users.find(u => u.email === email);
  if (!user) return null;
  user.status = status;
  user.updated_at = new Date().toISOString();
  return user;
}

const ALLOWED_FIELDS = [
  'razon_social', 'nombre_comercial', 'nif', 'actividad', 'tipo_via', 'direccion',
  'codigo_postal', 'provincia', 'ciudad', 'pais_residencia_fiscal', 'persona_contacto', 'email_contacto',
  'telefono', 'iban', 'swift', 'banco', 'sucursal', 'codigo_entidad', 'codigo_sucursal', 'moneda_pago', 'alta_036'
];

// responsible_email solo editable por admin
const ADMIN_FIELDS = ['responsible_email'];

const VALID_STATUSES = new Set(['pendiente', 'revision', 'aprobado', 'rechazado']);

// ── Rutas ──────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gestion' }));

app.get('/suppliers/me', authenticate, (req, res) => {
  const email = req.user.email || req.user.sub;
  const db = loadDB();
  const s = getOrCreate(db, email);
  saveDB(db);
  res.json(s);
});

app.put('/suppliers/me', authenticate, async (req, res) => {
  const db = loadDB();
  const email = req.user.email || req.user.sub;
  let s = db.suppliers.find(x => x.email === email);

  const documentsOnly = isDocumentsOnlyUpdate(req.body);

  const updates = {};
  ALLOWED_FIELDS.forEach(f => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });

  if (Array.isArray(req.body.documents)) {
    updates.documents = req.body.documents.map(doc => ({
      filename: doc.filename,
      original: doc.original || doc.filename,
      type: doc.type || 'Documento',
      label: doc.label || doc.type || doc.filename,
      uploaded_at: doc.uploaded_at || new Date().toISOString()
    }));
  }

  if (!s?.responsible_email) {
    updates.responsible_email = req.user.email || req.user.sub;
    updates.mail = "";
    updates.email_contacto = "";
  }

  updates.updated_at = new Date().toISOString();

  if (s) {
    // Si el proveedor estaba rechazado y edita sus datos, volver a "revision" y limpiar observaciones
    if (s.status === 'rechazado') {
      updates.status = 'revision';
      updates.observations = '';
      console.log(`[gestion] PUT /suppliers/me: proveedor ${s.id} estaba rechazado → cambiando a 'revision' y borrando observaciones`);
    }
    Object.assign(s, updates);
  } else {
    s = {
      id: crypto.randomUUID(),
      email,
      status: 'pendiente',
      created_at: new Date().toISOString(),
      ...updates
    };
    db.suppliers.push(s);
  }

  if (hasMinimum(s) && s.status === 'pendiente') s.status = 'revision';
  saveDB(db);

  // Sincronizar estado en auth.json
  syncUserStatusInAuthDB(email, s.status);

  if (!documentsOnly && hasMinimum(s)) {
    sendResponsibleEmail(s).catch(e => console.error('[gestion] sendResponsibleEmail error:', e.message));
  } else {
    console.log(`[gestion] PUT /suppliers/me: correo omitido (documentsOnly=${documentsOnly}, hasMinimum=${hasMinimum(s)})`);
  }

  res.json(s);
});

app.get('/suppliers/admin/list', authenticate, (req, res) => {
  const db = loadDB();
  res.json({ suppliers: db.suppliers, total: db.suppliers.length });
});

app.get('/suppliers/admin/:id', authenticate, (req, res) => {
  const db = loadDB();
  const s = db.suppliers.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ detail: 'Proveedor no encontrado.' });
  res.json(s);
});

app.put('/suppliers/admin/:id', authenticate, requireAdmin, async (req, res) => {
  const db = loadDB();
  const s = db.suppliers.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ detail: 'Proveedor no encontrado.' });

  const documentsOnly = isDocumentsOnlyUpdate(req.body);

  const updates = {};
  [...ALLOWED_FIELDS, ...ADMIN_FIELDS].forEach(f => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });

  if (Array.isArray(req.body.documents)) {
    updates.documents = req.body.documents.map(doc => ({
      filename: doc.filename,
      original: doc.original || doc.filename,
      type: doc.type || 'Documento',
      label: doc.label || doc.type || doc.filename,
      uploaded_at: doc.uploaded_at || new Date().toISOString()
    }));
  }

  updates.updated_at = new Date().toISOString();

  // Si el proveedor estaba rechazado y el admin edita sus datos, volver a "revision" y limpiar observaciones
  if (s.status === 'rechazado') {
    updates.status = 'revision';
    updates.observations = '';
    console.log(`[gestion] PUT /suppliers/admin/:id: proveedor ${s.id} estaba rechazado → cambiando a 'revision' y borrando observaciones`);
  }

  Object.assign(s, updates);

  if (hasMinimum(s) && s.status === 'pendiente') s.status = 'revision';

  saveDB(db);

  // Sincronizar estado en auth.json
  syncUserStatusInAuthDB(s.email, s.status);

  if (!documentsOnly && hasMinimum(s)) {
    sendResponsibleEmail(s).catch(e => console.error('[gestion] sendResponsibleEmail error:', e.message));
  } else {
    console.log(`[gestion] PUT /suppliers/admin/:id: correo omitido (documentsOnly=${documentsOnly}, hasMinimum=${hasMinimum(s)})`);
  }

  res.json(s);
});

async function sendSupplierStatusEmail(supplier, status, observations) {
  const to = supplier.email || supplier.responsible_email || process.env.DEFAULT_RESPONSIBLE_EMAIL;
  if (!to) {
    console.warn(`[gestion] sendSupplierStatusEmail: proveedor ${supplier.id} sin email de destino`);
    return;
  }

  const statusText = status === 'aprobado' ? 'aprobada' : 'rechazada';
  const supplierName = supplier.alias || supplier.razon_social || supplier.nombre_comercial || supplier.name || supplier.email || 'proveedor';
  const portalUrl = process.env.PORTAL_URL || process.env.PORTAL_FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:8000';

  const obsTrimmed = String(observations || '').trim();
  const templateData = {
    supplier_name: supplierName,
    status_text: statusText,
    observations_html: obsTrimmed ? `<p><strong>Comentarios:</strong></p><div style="padding:12px 14px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;white-space:pre-wrap">${obsTrimmed}</div>` : '',
    observations_text: obsTrimmed ? `\nComentarios:\n${obsTrimmed}\n` : '',
    portal_url: portalUrl,
    admin_email: process.env.ADMIN_EMAIL || process.env.DEFAULT_RESPONSIBLE_EMAIL || ''
  };

  const rendered = renderTemplate('supplier-result', templateData);
  if (!rendered) return;
  const { subject, html, text } = rendered;

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'portal@empresa.local';

  try {
    const transport = createTransport();
    await transport.sendMail({ from, to, subject, html, text });
    console.log(`[gestion] Correo de resultado (${status}) enviado a ${to} para proveedor ${supplier.id}`);
  } catch (e) {
    console.error(`[gestion] Error enviando correo de resultado (${status}):`, e.message);
  }
}

app.patch('/suppliers/admin/:id/status', authenticate, requireAdmin, async (req, res) => {
  const { status, observations } = req.body;

  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({
      detail: `Estado inválido. Válidos: ${[...VALID_STATUSES].join(', ')}`
    });
  }

  const rejectionNote = String(observations || '').trim();
  if (status === 'rechazado' && !rejectionNote) {
    return res.status(400).json({
      detail: 'Las observaciones son obligatorias cuando el proveedor se marca como rechazado.'
    });
  }

  const db = loadDB();
  const s = db.suppliers.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ detail: 'Proveedor no encontrado.' });

  s.status = status;
  s.updated_at = new Date().toISOString();
  s.observations = status === 'rechazado' ? rejectionNote : '';

  saveDB(db);

  // Mantener acceso al portal incluso si está rechazado, para que pueda corregir datos.
  syncUserStatusInAuthDB(s.email, status === 'rechazado' ? 'revision' : status);

  if (status === 'rechazado' || status === 'aprobado') {
    await sendSupplierStatusEmail(s, status, rejectionNote);
  }

  res.json(s);
});

// ── Start ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  app.listen(PORT, '0.0.0.0', () => console.log(`[gestion] Puerto ${PORT}`));
} else {
  module.exports = app;
}
