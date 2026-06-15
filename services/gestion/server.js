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
const TEMPLATES_PATH = path.join(__dirname, 'email-templates');

function loadEmailTemplate(name) {
  const file = path.join(TEMPLATES_PATH, `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[gestion] No se pudo cargar plantilla '${name}':`, e.message);
    return null;
  }
}

function renderTemplate(template, data) {
  let subject = template.subject || '';
  let html = template.html || '';
  let text = template.text || '';

  const replacer = (str) =>
    str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = data[key];
      if (val === undefined || val === null) return '';
      if (typeof val === 'boolean') return val ? 'Sí' : 'No';
      return String(val);
    });

  return {
    subject: replacer(subject),
    html: replacer(html),
    text: replacer(text)
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

async function sendResponsibleEmail(supplier) {
  const to = supplier.responsible_email || process.env.DEFAULT_RESPONSIBLE_EMAIL;
  if (!to) {
    console.warn('[gestion] sendResponsibleEmail: no hay responsible_email ni DEFAULT_RESPONSIBLE_EMAIL configurado.');
    return;
  }

  const tpl = loadEmailTemplate('perfil-actualizado');
  if (!tpl) return;

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
          <td style="padding:.5rem;border-bottom:1px solid #eee;color:#666;width:40%">Documento</td>
          <td style="padding:.5rem;border-bottom:1px solid #eee">${label} <span style="color:#666">(${original}${uploaded ? `, ${uploaded}` : ''})</span></td>
        </tr>`;
      }).join('')
    : `<tr>
        <td style="padding:.5rem;border-bottom:1px solid #eee;color:#666;width:40%">Documentos</td>
        <td style="padding:.5rem;border-bottom:1px solid #eee">Sin documentos adjuntos</td>
      </tr>`;

  const document_rows_text = docs.length
    ? docs.map(doc => {
        const label = doc.label || doc.type || doc.original || doc.filename;
        const original = doc.original || doc.filename || '';
        const uploaded = doc.uploaded_at || '';
        return `- ${label}${original ? ` (${original}` : ''}${uploaded ? `${original ? ', ' : ' ('}${uploaded}` : ''}${original || uploaded ? ')' : ''}`;
      }).join('\n')
    : '- Sin documentos adjuntos';

  const templateData = {
    ...supplier,
    document_names,
    document_rows_html,
    document_rows_text
  };

  const { subject, html, text } = renderTemplate(tpl, templateData);
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
    await transport.sendMail({ from, to, subject, html, text, attachments });
    console.log(`[gestion] Correo enviado a ${to} para proveedor ${supplier.id} con ${attachments.length} adjuntos`);
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
    //db.suppliers.push(s);
  }
  return s;
}

function hasMinimum(s) {
  return s.razon_social && s.nif && s.persona_contacto && s.iban;
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

  // Sincronizar estado en auth.json (nuevo: proveedor pasó a 'revision')
  syncUserStatusInAuthDB(email, s.status);

  sendResponsibleEmail(s).catch(e => console.error('[gestion] sendResponsibleEmail error:', e.message));

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
  Object.assign(s, updates);

  if (hasMinimum(s) && s.status === 'pendiente') s.status = 'revision';

  saveDB(db);

  // Sincronizar estado en auth.json
  syncUserStatusInAuthDB(s.email, s.status);

  sendResponsibleEmail(s).catch(e => console.error('[gestion] sendResponsibleEmail error:', e.message));

  res.json(s);
});

async function sendSupplierRejectionEmail(supplier, observations) {
  const to = supplier.email || supplier.responsible_email || process.env.DEFAULT_RESPONSIBLE_EMAIL;
  if (!to) {
    console.warn(`[gestion] sendSupplierRejectionEmail: proveedor ${supplier.id} sin email de destino`);
    return;
  }

  const tpl = loadEmailTemplate('supplier-rejected');
  if (!tpl) return;

  const supplierName = supplier.alias || supplier.razon_social || supplier.nombre_comercial || supplier.name || supplier.email || 'proveedor';
  const portalUrl = process.env.PORTAL_URL || process.env.PORTAL_FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:8000';

  const { subject, html, text } = renderTemplate(tpl, {
    supplier_name: supplierName,
    observations: observations || '',
    portal_url: portalUrl,
    admin_email: process.env.ADMIN_EMAIL || process.env.DEFAULT_RESPONSIBLE_EMAIL || ''
  });

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'portal@empresa.local';

  try {
    const transport = createTransport();
    await transport.sendMail({ from, to, subject, html, text });
    console.log(`[gestion] Correo de rechazo enviado a ${to} para proveedor ${supplier.id}`);
  } catch (e) {
    console.error('[gestion] Error enviando correo de rechazo:', e.message);
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

  if (status === 'rechazado') {
    await sendSupplierRejectionEmail(s, rejectionNote);
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
