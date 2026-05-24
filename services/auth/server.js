/**
 * Microservicio Auth — Puerto 8001
 *
 * POST /auth/otp/request  → genera y envía OTP por email
 * POST /auth/otp/verify   → valida OTP y devuelve JWT
 * GET  /health            → health check
 */

'use strict';

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
const DATA_PATH    = process.env.DATA_PATH || path.join(__dirname, '..', '..', 'data');
const DB_PATH      = process.env.AUTH_DB_PATH || path.join(DATA_PATH, 'auth.json');
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'admin@tuempresa.com')
                      .split(',').map(e => e.trim().toLowerCase());

// ── Middlewares globales ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── TinyDB-style JSON store ───────────────────────────────────────────────────
function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const dir = path.dirname(DB_PATH);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify({ otp_codes: [], users: [] }), 'utf8');
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { otp_codes: [], users: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ── Mailer ─────────────────────────────────────────────────────────────────────
function getTransporter() {
  if (!SMTP_USER) return null; // modo dev: imprimir en consola
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function sendOtpEmail(to, otp) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[DEV] OTP para ${to}: ${otp}`);
    return;
  }
  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: `Tu código de acceso: ${otp}`,
    text: `Portal de Proveedores

Tu código de acceso es: ${otp}

Válido durante ${Math.floor(OTP_TTL/60)} minutos.
Si no solicitaste este código, ignóralo.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem">
        <h2 style="color:#1a56db">Portal de Proveedores</h2>
        <p>Tu código de acceso es:</p>
        <div style="font-size:2.5rem;font-weight:700;letter-spacing:.3em;background:#f0f4ff;padding:1rem;border-radius:8px;text-align:center;color:#1a56db">${otp}</div>
        <p style="color:#666;font-size:.88rem;margin-top:1rem">
          Válido durante ${Math.floor(OTP_TTL/60)} minutos.
          Si no solicitaste este código, ignora este mensaje.
        </p>
      </div>`
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function createJWT(email, role) {
  return jwt.sign(
    { sub: email, role, iat: Math.floor(Date.now() / 1000) },
    SECRET_KEY,
    { expiresIn: TOKEN_EXP * 60 }
  );
}

function getOrCreateUser(db, email) {
  let user = db.users.find(u => u.email === email);
  if (!user) {
    user = {
      id:         crypto.randomUUID(),
      email,
      role:       ADMIN_EMAILS.includes(email) ? 'admin' : 'supplier',
      created_at: new Date().toISOString()
    };
    db.users.push(user);
  }
  return user;
}

// ── Rutas ──────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'auth' })
);

app.post('/auth/otp/request', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(422).json({ detail: 'Email no válido.' });
  }

  const emailLower = email.toLowerCase().trim();
  const otp        = generateOtp();
  const now        = Math.floor(Date.now() / 1000);

  const db = loadDB();
  // Eliminar OTPs anteriores del mismo email
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

  const token = createJWT(emailLower, user.role);
  res.json({
    access_token: token,
    token_type:   'bearer',
    role:         user.role,
    expires_in:   TOKEN_EXP * 60
  });
});

// ── Start / Export ─────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`[auth] Puerto ${PORT}`)
  );
} else {
  module.exports = app;
}