/**
 * Microservicio Auth
 *
 * POST /auth/otp/request  → genera y envía OTP por email
 * POST /auth/otp/verify   → valida OTP, crea sesión y devuelve redirect_to
 * GET  /auth/me           → info de la sesión
 * GET  /auth/role-pages   → mapa de páginas por rol (admin)
 * PUT  /auth/role-pages   → actualiza mapa de páginas por rol (admin)
 * POST /auth/invite       → invita a un proveedor (admin)
 * POST /auth/logout       → cierra la sesión
 * GET  /health            → health check
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8001;

// ── Config ──────────────────────────────────────────────────────────────────────
const OTP_TTL = parseInt(process.env.OTP_TTL_SECONDS || '300', 10);
const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'portal@tuempresa.com';
const PORTAL_URL = process.env.PORTAL_URL || `http://localhost:${PORT}`;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@tuempresa.com').trim().toLowerCase();
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || ADMIN_EMAIL)
  .split(',')
  .map(v => v.trim().toLowerCase())
  .filter(Boolean);

const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-este-secreto-de-sesion-en-produccion';
const SESSION_NAME = process.env.SESSION_NAME || 'portal.sid';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || String(8 * 60 * 60 * 1000), 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || process.env.PORTAL_FRONTEND_URL || '';
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', '..', 'data');
const DB_PATH = process.env.AUTH_DB_PATH || path.join(DATA_PATH, 'auth.json');
const SUPPLIERS_DB_PATH = process.env.GESTION_DB_PATH || path.join(DATA_PATH, 'suppliers.json');
const ROLES_ROUTES_PATH = path.join(DATA_PATH, 'roles_routes.json');

// ── Mapa de páginas permitidas por rol ───────────────────────────────────────────────
const DEFAULT_ROLE_PAGES = {
  admin: ['/proveedores', '/perfil', '/perfil-edit'],
  user: ['/proveedores', '/perfil'],
  supplier: ['/perfil']
};

// ── App settings ───────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ── Middlewares globales ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: FRONTEND_ORIGIN || true,
  credentials: true
}));

app.use(express.json());

app.use(session({
  name: SESSION_NAME,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'lax' : 'lax',
    maxAge: SESSION_TTL_MS
  }
}));

// ── TinyDB-style JSON store ──────────────────────────────────────────────────────────────
function sanitizeAuthDB(db) {
  db = db || {};
  if (!Array.isArray(db.otp_codes)) db.otp_codes = [];
  if (!Array.isArray(db.users)) db.users = [];
  if (!db.role_pages || typeof db.role_pages !== 'object') {
    db.role_pages = DEFAULT_ROLE_PAGES;
  }
  return db;
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const dir = path.dirname(DB_PATH);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        DB_PATH,
        JSON.stringify(sanitizeAuthDB({}), null, 2),
        'utf8'
      );
    }
    return sanitizeAuthDB(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
  } catch {
    return sanitizeAuthDB({});
  }
}

function saveDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(sanitizeAuthDB(data), null, 2), 'utf8');
}

function loadSuppliersDB() {
  try {
    if (!fs.existsSync(SUPPLIERS_DB_PATH)) return { suppliers: [] };
    return JSON.parse(fs.readFileSync(SUPPLIERS_DB_PATH, 'utf8'));
  } catch {
    return { suppliers: [] };
  }
}

function saveSuppliersDB(data) {
  fs.mkdirSync(path.dirname(SUPPLIERS_DB_PATH), { recursive: true });
  fs.writeFileSync(SUPPLIERS_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function stripJsonComments(content) {
  return String(content || '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

function loadRoleRoutes() {
  try {
    if (!fs.existsSync(ROLES_ROUTES_PATH)) return DEFAULT_ROLE_PAGES;
    const raw = fs.readFileSync(ROLES_ROUTES_PATH, 'utf8');
    const parsed = JSON.parse(stripJsonComments(raw));
    if (!parsed || typeof parsed !== 'object') return DEFAULT_ROLE_PAGES;
    return parsed;
  } catch {
    return DEFAULT_ROLE_PAGES;
  }
}

// ── Helpers de rol y redirección ───────────────────────────────────────────────────────────
function getAllowedPages(role) {
  const rolesRoutes = loadRoleRoutes();
  const pages = rolesRoutes[String(role || '').trim()] || DEFAULT_ROLE_PAGES[role] || ['/'];
  return Array.isArray(pages) ? pages : ['/'];
}

function getDefaultRedirect(role) {
  const pages = getAllowedPages(role);
  return pages[0] || '/';
}

// ── Mailer ───────────────────────────────────────────────────────────────────────────
function getTransporter() {
  if (!SMTP_USER) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

function buildOtpEmailText(otp) {
  return `Portal de Proveedores\n\n` +
         `Tu código de acceso es: ${otp}\n\n` +
         `Válido durante ${Math.floor(OTP_TTL / 60)} minutos.\n` +
         `Si no solicitaste este código, ignóralo.\n\n` +
         `Si necesitas ayuda, contacta a ${ADMIN_EMAIL}.`;
}

function buildOtpEmailHtml(otp) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:2rem">
      <h2 style="color:#1a56db">Portal de Proveedores</h2>
      <p>Tu código de acceso es:</p>
      <div style="font-size:2.5rem;font-weight:700;letter-spacing:.3em;background:#f0f4ff;padding:1rem;border-radius:8px;text-align:center;color:#1a56db">${otp}</div>
      <p style="color:#6b7280;font-size:.95rem;margin-top:1rem;line-height:1.5">
        Válido durante ${Math.floor(OTP_TTL / 60)} minutos.<br>
        Si no solicitaste este código, ignora este mensaje.
      </p>
      <p style="color:#6b7280;font-size:.85rem;line-height:1.5;margin-top:1.5rem">
        Si necesitas ayuda, contacta a <strong>${ADMIN_EMAIL}</strong>.
      </p>
    </div>`;
}

function buildInviteEmailText(email) {
  return `Has sido invitado al Portal de Proveedores.\n\n` +
         `Accede con este correo: ${email}\n` +
         `Entra al portal aquí: ${PORTAL_URL}\n\n` +
         `Si tienes algún problema, contacta a ${ADMIN_EMAIL}.`;
}

function buildInviteEmailHtml(email) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:2rem">
      <h2 style="color:#1a56db">Invitación al Portal de Proveedores</h2>
      <p>Has sido invitado a acceder al portal utilizando este correo:</p>
      <p style="font-size:1rem;font-weight:600;color:#111827;word-break:break-word">${email}</p>
      <p style="margin-top:1rem;color:#374151;line-height:1.6">
        Haz clic en el siguiente enlace para iniciar sesión y gestionar tu perfil de proveedor:
      </p>
      <a href="${PORTAL_URL}" style="display:inline-block;margin-top:1rem;padding:.9rem 1.2rem;background:#1a56db;color:#fff;border-radius:.75rem;text-decoration:none">Abrir Portal</a>
      <p style="color:#6b7280;font-size:.85rem;line-height:1.5;margin-top:1.5rem">
        Si tienes algún problema, contacta a <strong>${ADMIN_EMAIL}</strong>.
      </p>
    </div>`;
}

async function sendOtpEmail(to, otp) {
  const transporter = getTransporter();
  console.log(`[DEV] OTP para ${to}: ${otp}`);
  if (!transporter) return;
  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: `Tu código de acceso: ${otp}`,
    text: buildOtpEmailText(otp),
    html: buildOtpEmailHtml(otp)
  });
}

async function sendInviteEmail(to) {
  const transporter = getTransporter();
  console.log(`[DEV] Invitación para ${to}: ${PORTAL_URL}`);
  if (!transporter) return;
  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: 'Invitación al Portal de Proveedores',
    text: buildInviteEmailText(to),
    html: buildInviteEmailHtml(to)
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────
function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function isAuthorizedEmail(db, email) {
  const emailLower = String(email || '').toLowerCase().trim();
  if (!emailLower) return false;
  return db.users.some(u => u.email === emailLower);
}

function getOrCreateUser(db, email) {
  let user = db.users.find(u => u.email === email);
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      email,
      status: 'new',
      role: ADMIN_EMAILS.includes(email) ? 'admin' : 'supplier',
      created_at: new Date().toISOString()
    };
    db.users.push(user);
  }
  return user;
}

/**
 * Actualiza el status de un usuario en el objeto db (en memoria).
 * La persistencia queda a cargo del caller mediante saveDB(db).
 *
 * @param {object} db     - Objeto cargado de auth.json
 * @param {string} email  - Email del usuario a actualizar
 * @param {string} status - Nuevo estado
 * @returns {object|null} El usuario actualizado, o null si no se encontró
 */
function updateUserStatus(db, email, status) {
  const user = db.users.find(u => u.email === email);
  if (!user) return null;
  user.status = status;
  user.updated_at = new Date().toISOString();
  return user;
}

// ── Middlewares de autenticación y autorización ───────────────────────────────────────────

function authenticate(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ detail: 'No autenticado.' });
  }
  req.user = req.session.user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ detail: 'Acceso restringido a administradores.' });
  }
  next();
}

function requireAdminUser(req, res, next) {
  if ( (req.user?.role !== 'admin') && (req.user?.role !== 'user') ) {
    return res.status(403).json({ detail: 'Operación restringido a usuarios autorizados.' });
  }
  next();
}

// ── Rutas ──────────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'auth' })
);

app.get('/auth/me', authenticate, (req, res) => {
  return res.json({
    id: req.user.id,
    email: req.user.email,
    role: req.user.role
  });
});

app.get('/auth/role-pages', authenticate, requireAdmin, (req, res) => {
  const db = loadDB();
  const rolePages = db.role_pages || loadRoleRoutes();
  res.json({ role_pages: rolePages });
});

app.put('/auth/role-pages', authenticate, requireAdmin, (req, res) => {
  const { role_pages } = req.body;
  if (!role_pages || typeof role_pages !== 'object') {
    return res.status(422).json({ detail: 'role_pages debe ser un objeto.' });
  }
  const db = loadDB();
  db.role_pages = role_pages;
  saveDB(db);
  res.json({ message: 'Mapa de páginas actualizado.', role_pages: db.role_pages });
});

app.post('/auth/otp/request', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(422).json({ detail: 'Email no válido.' });
  }

  const emailLower = email.toLowerCase().trim();
  const db = loadDB();

  if (!isAuthorizedEmail(db, emailLower)) {
    return res.status(403).json({
      detail: `No eres un usuario autorizado. Si crees que necesitas acceso, contacta a ${ADMIN_EMAIL}.`
    });
  }

  const otp = generateOtp();
  const now = Math.floor(Date.now() / 1000);

  db.otp_codes = db.otp_codes.filter(o => o.email !== emailLower);
  db.otp_codes.push({
    email: emailLower,
    otp,
    created_at: now,
    expires_at: now + OTP_TTL,
    used: false
  });
  saveDB(db);

  try {
    await sendOtpEmail(emailLower, otp);
    res.json({ message: 'Código enviado. Revisa tu bandeja de entrada.', expires_in: OTP_TTL });
  } catch (e) {
    console.error('[SMTP]', e.message);
    res.status(500).json({ detail: 'Error al enviar el email. Contacta con soporte.' });
  }
});

app.post('/auth/otp/verify', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(422).json({ detail: 'Email y código son obligatorios.' });
  }

  const emailLower = email.toLowerCase().trim();
  const now = Math.floor(Date.now() / 1000);
  const db = loadDB();
  const record = db.otp_codes.find(o => o.email === emailLower && !o.used);

  if (!record) {
    return res.status(400).json({ detail: 'No hay un código activo para este correo.' });
  }

  if (record.otp !== String(otp).trim()) {
    return res.status(400).json({ detail: 'Código incorrecto.' });
  }

  if (now > record.expires_at) {
    db.otp_codes = db.otp_codes.filter(o => o.email !== emailLower);
    saveDB(db);
    return res.status(400).json({ detail: 'El código ha expirado. Solicita uno nuevo.' });
  }

  record.used = true;
  const user = getOrCreateUser(db, emailLower);
  saveDB(db);

  const redirectTo = getDefaultRedirect(user.role);
  const allowedPages = getAllowedPages(user.role);

  req.session.user = {
    id: user.id,
    email: user.email,
    status: user.status,
    role: user.role
  };

  return req.session.save(err => {
    if (err) {
      console.error('[session.save]', err);
      return res.status(500).json({ detail: 'No se pudo iniciar la sesión.' });
    }

    return res.json({
      ok: true,
      role: user.role,
      redirect_to: redirectTo,
      allowed_pages: allowedPages
    });
  });
});

app.post('/auth/invite', authenticate, requireAdminUser, async (req, res) => {
  const { name, email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(422).json({ detail: 'Email no válido.' });
  }

  const emailLower = email.toLowerCase().trim();
  const responsibleEmail = (req.user.email || '').toLowerCase().trim();
  const db = loadDB();

  if (db.users.some(u => u.email === emailLower)) {
    return res.status(409).json({ detail: 'Ese correo ya está registrado.' });
  }

  const user = {
    id: crypto.randomUUID(),
    email: emailLower,
    role: 'supplier',
    status: 'invited',
    created_at: new Date().toISOString()
  };

  db.users.push(user);
  saveDB(db);

  try {
    const sdb = loadSuppliersDB();
    let supplier = sdb.suppliers.find(s => s.email_contacto === emailLower || s.email === emailLower);

    if (!supplier) {
      supplier = {
        id: crypto.randomUUID(),
        alias: name ? name.trim() : '',
        email: emailLower,
        status: 'pendiente',
        responsible_email: responsibleEmail,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      sdb.suppliers.push(supplier);
    } else {
      supplier.alias = name ? name.trim() : supplier.alias || '';
      supplier.email = emailLower;
      supplier.responsible_email = responsibleEmail;
      supplier.updated_at = new Date().toISOString();
    }

    saveSuppliersDB(sdb);
  } catch (e) {
    console.error('[invite] Error actualizando suppliers.json:', e.message);
  }

  try {
    await sendInviteEmail(emailLower);
    res.json({ message: 'Invitación enviada correctamente.' });
  } catch (e) {
    console.error('[SMTP]', e.message);
    res.status(500).json({ detail: 'Error al enviar la invitación. Intenta de nuevo más tarde.' });
  }
});

// PUT /auth/users/:id  —  actualizar rol y/o estado de un usuario (solo admin)
app.put('/auth/users/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { role, status } = req.body;

  const VALID_ROLES   = ['admin', 'user', 'supplier'];
  const VALID_STATUSES = ['new', 'invited', 'active', 'disabled'];

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(422).json({ detail: `Rol no válido. Valores permitidos: ${VALID_ROLES.join(', ')}.` });
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(422).json({ detail: `Estado no válido. Valores permitidos: ${VALID_STATUSES.join(', ')}.` });
  }

  const db = loadDB();
  const user = db.users.find(u => u.id === id);

  if (!user) {
    return res.status(404).json({ detail: 'Usuario no encontrado.' });
  }

  if (role)   user.role   = role;
  if (status) user.status = status;
  user.updated_at = new Date().toISOString();

  saveDB(db);
  res.json({ message: 'Usuario actualizado correctamente.', user });
});

// GET /auth/users  —  listar usuarios (solo admin)
app.get('/auth/users', authenticate, requireAdmin, (req, res) => {
  const db = loadDB();
  res.json({ users: db.users });
});

app.post('/auth/logout', authenticate, (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ detail: 'No se pudo cerrar la sesión.' });
    }

    res.clearCookie(SESSION_NAME, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: IS_PROD ? 'lax' : 'lax'
    });

    return res.json({ message: 'Sesión cerrada correctamente.' });
  });
});

// ── Start / Export ────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`[auth] Puerto ${PORT}`)
  );
} else {
  module.exports = app;
  module.exports.authenticate = authenticate;
  module.exports.requireAdmin = requireAdmin;
}
