/**
 * Microservicio Auth
 *
 * POST /auth/otp/request  → genera y envía OTP por email
 * POST /auth/otp/verify   → valida OTP y devuelve JWT + redirect_to
 * GET  /auth/me           → info del token
 * POST /auth/invite       → invita a un proveedor
 * POST /auth/logout       → revoca el token
 * GET  /health            → health check
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 8001;

// ── Config ─────────────────────────────────────────────────────────────────────
const SECRET_KEY   = process.env.JWT_SECRET           || 'cambia-este-secreto-en-produccion';
const TOKEN_EXP    = parseInt(process.env.TOKEN_EXPIRE_MINUTES || '120');
const OTP_TTL      = parseInt(process.env.OTP_TTL_SECONDS       || '300');
const SMTP_HOST    = process.env.SMTP_HOST  || 'localhost';
const SMTP_PORT    = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER    = process.env.SMTP_USER  || '';
const SMTP_PASS    = process.env.SMTP_PASS  || '';
const SMTP_FROM    = process.env.SMTP_FROM  || 'portal@tuempresa.com';
const PORTAL_URL   = process.env.PORTAL_URL || `http://localhost:${PORT}`;
const DATA_PATH    = process.env.DATA_PATH || path.join(__dirname, '..', '..', 'data');
const DB_PATH      = process.env.AUTH_DB_PATH || path.join(DATA_PATH, 'auth.json');
const SUPPLIERS_DB_PATH = process.env.GESTION_DB_PATH || path.join(DATA_PATH, 'suppliers.json');
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'admin@tuempresa.com')
                      .split(',').map(e => e.trim().toLowerCase());
const ADMIN_EMAIL  = (process.env.ADMIN_EMAIL || ADMIN_EMAILS[0] || 'admin@tuempresa.com').trim().toLowerCase();

// ── Mapa de páginas permitidas por rol ────────────────────────────────────────
const DEFAULT_ROLE_PAGES = {
  admin:    ['/proveedores', '/perfil'],
  supplier: ['/perfil', '/perfil-edit']
};

// ── Middlewares globales ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── TinyDB-style JSON store ───────────────────────────────────────────────────
function sanitizeAuthDB(db) {
  db = db || {};
  if (!Array.isArray(db.otp_codes))      db.otp_codes      = [];
  if (!Array.isArray(db.users))          db.users          = [];
  if (!Array.isArray(db.revoked_tokens)) db.revoked_tokens = [];
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

function isTokenRevoked(jti, db) {
  if (!jti) return false;
  const data = db || loadDB();
  return Array.isArray(data.revoked_tokens) && data.revoked_tokens.some(item => item.jti === jti);
}

function revokeToken(token) {
  const decoded = jwt.decode(token);
  if (!decoded || !decoded.jti) return false;

  const db = loadDB();
  const now = Math.floor(Date.now() / 1000);
  db.revoked_tokens = db.revoked_tokens.filter(item => item.expires_at > now);

  if (!db.revoked_tokens.some(item => item.jti === decoded.jti)) {
    db.revoked_tokens.push({
      jti:        decoded.jti,
      revoked_at: now,
      expires_at: decoded.exp || now + TOKEN_EXP * 60
    });
    saveDB(db);
  }
  return true;
}

// ── Helpers de rol y redirección ──────────────────────────────────────────────
function getDefaultRedirect(db, role) {
  const pages = (db.role_pages && db.role_pages[role]) || DEFAULT_ROLE_PAGES[role] || ['/'];
  return Array.isArray(pages) && pages.length > 0 ? pages[0] : '/';
}

function getAllowedPages(db, role) {
  return (db.role_pages && db.role_pages[role]) || DEFAULT_ROLE_PAGES[role] || [];
}

// ── Mailer ─────────────────────────────────────────────────────────────────────
function getTransporter() {
  if (!SMTP_USER) return null;
  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS }
  });
}

function buildOtpEmailText(otp) {
  return `Portal de Proveedores\n\n` +
         `Tu código de acceso es: ${otp}\n\n` +
         `Válido durante ${Math.floor(OTP_TTL/60)} minutos.\n` +
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
        Válido durante ${Math.floor(OTP_TTL/60)} minutos.<br>
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
    from: SMTP_FROM, to,
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
    from: SMTP_FROM, to,
    subject: 'Invitación al Portal de Proveedores',
    text: buildInviteEmailText(to),
    html: buildInviteEmailHtml(to)
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function createJWT(email, role) {
  return jwt.sign(
    { sub: email, role, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID() },
    SECRET_KEY,
    { expiresIn: TOKEN_EXP * 60 }
  );
}

function isAuthorizedEmail(db, email) {
  const emailLower = String(email || '').toLowerCase().trim();
  if (!emailLower) return false;
  if (ADMIN_EMAILS.includes(emailLower) || emailLower === ADMIN_EMAIL) return true;
  return db.users.some(u => u.email === emailLower);
}

function getOrCreateUser(db, email) {
  let user = db.users.find(u => u.email === email);
  if (!user) {
    user = {
      id:         crypto.randomUUID(),
      email,
      role:       ADMIN_EMAILS.includes(email) || email === ADMIN_EMAIL ? 'admin' : 'supplier',
      created_at: new Date().toISOString()
    };
    db.users.push(user);
  }
  return user;
}

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'Token no proporcionado.' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), SECRET_KEY);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ detail: 'Token inválido o expirado.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ detail: 'Acceso restringido a administradores.' });
  }
  next();
}

// ── Rutas ──────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'auth' })
);

app.get('/auth/me', (req, res) => {
  if (req.session?.user) {
    return res.json({
      email: req.session.user.email,
      role: req.session.user.role
    });
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'No autenticado.' });
  }

  try {
    const payload = jwt.verify(auth.slice(7), SECRET_KEY);
    return res.json({
      email: payload.sub,
      role: payload.role,
      iat: payload.iat,
      exp: payload.exp
    });
  } catch (e) {
    return res.status(401).json({ detail: 'Token inválido o expirado.' });
  }
});

// Devuelve el mapa de páginas por rol (solo admin)
app.get('/auth/role-pages', authenticate, requireAdmin, (req, res) => {
  const db = loadDB();
  res.json({ role_pages: db.role_pages });
});

// Actualiza el mapa de páginas por rol (solo admin)
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
    email:      emailLower,
    otp,
    created_at: now,
    expires_at: now + OTP_TTL,
    used:       false
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
  const now        = Math.floor(Date.now() / 1000);

  const db     = loadDB();
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
  const user  = getOrCreateUser(db, emailLower);
  saveDB(db);

  const redirectTo   = getDefaultRedirect(db, user.role);
  const allowedPages = getAllowedPages(db, user.role);

  if (req.session) {
    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role
    };
  }

  res.json({
    ok: true,
    role: user.role,
    redirect_to: redirectTo,
    allowed_pages: allowedPages
  });
});

app.post('/auth/invite', authenticate, requireAdmin, async (req, res) => {
  const { name, email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(422).json({ detail: 'Email no válido.' });
  }

  const emailLower        = email.toLowerCase().trim();
  // El admin que invita es req.user.sub
  const responsibleEmail  = (req.user.sub || '').toLowerCase().trim();
  const db = loadDB();
  if (db.users.some(u => u.email === emailLower)) {
    return res.status(409).json({ detail: 'Ese correo ya está registrado.' });
  }

  const user = {
    id:         crypto.randomUUID(),
    email:      emailLower,
    role:       'supplier',
    created_at: new Date().toISOString()
  };
  db.users.push(user);
  saveDB(db);

  // ── Crear/actualizar entrada en suppliers.json con responsible_email ────────
  try {
    const sdb = loadSuppliersDB();
    let supplier = sdb.suppliers.find(s => s.email === emailLower);
    if (!supplier) {
      supplier = {
        id:                crypto.randomUUID(),
        alias:      name ? name.trim() : '',
        email_contacto:             emailLower,
        status:            'pendiente',
        responsible_email: responsibleEmail,
        created_at:        new Date().toISOString(),
        updated_at:        new Date().toISOString()
      };
      sdb.suppliers.push(supplier);
    } else {
      supplier.responsible_email = responsibleEmail;
      supplier.updated_at        = new Date().toISOString();
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

app.post('/auth/logout', (req, res) => {
  if (req.session) {
    return req.session.destroy(err => {
      if (err) {
        return res.status(500).json({ detail: 'No se pudo cerrar la sesión.' });
      }
      return res.json({ message: 'Sesión cerrada correctamente.' });
    });
  }

  return res.json({ message: 'Sesión cerrada correctamente.' });
});

// ── Start / Export ─────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`[auth] Puerto ${PORT}`)
  );
} else {

    module.exports = app;
    module.exports.authenticate = authenticate;

}
