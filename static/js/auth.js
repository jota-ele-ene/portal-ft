const jwt  = require('jsonwebtoken');
const fs   = require('fs');
const path = require('path');

const SECRET_KEY = process.env.JWT_SECRET || 'cambia-este-secreto-en-produccion';
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', '..', 'data');
const AUTH_DB_PATH = process.env.AUTH_DB_PATH || path.join(DATA_PATH, 'auth.json');

function loadAuthDB() {
  try {
    if (!fs.existsSync(AUTH_DB_PATH)) return { revoked_tokens: [] };
    const data = JSON.parse(fs.readFileSync(AUTH_DB_PATH, 'utf8'));
    if (!Array.isArray(data.revoked_tokens)) data.revoked_tokens = [];
    return data;
  } catch {
    return { revoked_tokens: [] };
  }
}

function isTokenRevoked(jti) {
  if (!jti) return false;
  const db = loadAuthDB();
  return db.revoked_tokens.some(t => t.jti === jti);
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';

  // Sin token → redirigir a home solo en peticiones HTML
  if (!auth.startsWith('Bearer ')) {
    // Si el cliente pide HTML (navegador) redirigimos
    const acceptsHtml = req.accepts(['html', 'json']) === 'html';
    if (acceptsHtml) {
      const nextUrl = encodeURIComponent(req.originalUrl || '/perfil');
      return res.redirect(`/?next=${nextUrl}`);
    }
    // Si es API (JSON), respondemos 401
    return res.status(401).json({ detail: 'Token no proporcionado.' });
  }

  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, SECRET_KEY);

    if (isTokenRevoked(payload.jti)) {
      const acceptsHtml = req.accepts(['html', 'json']) === 'html';
      if (acceptsHtml) {
        const nextUrl = encodeURIComponent(req.originalUrl || '/perfil');
        return res.redirect(`/?next=${nextUrl}`);
      }
      return res.status(401).json({ detail: 'Token revocado. Inicia sesión de nuevo.' });
    }

    req.user = payload;
    next();
  } catch (e) {
    const acceptsHtml = req.accepts(['html', 'json']) === 'html';
    if (acceptsHtml) {
      const nextUrl = encodeURIComponent(req.originalUrl || '/perfil');
      return res.redirect(`/?next=${nextUrl}`);
    }
    return res.status(401).json({ detail: 'Token inválido o expirado.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ detail: 'Acceso restringido a administradores.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };

