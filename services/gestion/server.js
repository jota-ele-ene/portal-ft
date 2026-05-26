'use strict';

/**
 * Microservicio Gestión — Puerto 8002
 *
 * GET    /suppliers/me                    → perfil del proveedor autenticado
 * PUT    /suppliers/me                    → actualiza perfil
 * GET    /suppliers/admin/list            → lista todos (solo admin)
 * GET    /suppliers/admin/:id             → detalle de un proveedor (solo admin)
 * PUT    /suppliers/admin/:id             → edita un proveedor (solo admin)
 * PATCH  /suppliers/admin/:id/status      → cambia estado (solo admin)
 * GET    /health
 */

const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 8002;

app.use(cors());
app.use(express.json());

const SECRET_KEY   = process.env.JWT_SECRET       || 'cambia-este-secreto-en-produccion';
const DATA_PATH    = process.env.DATA_PATH || path.join(__dirname, '..', '..', 'data');
const AUTH_DB_PATH = path.join(DATA_PATH, 'auth.json');
const DB_PATH      = process.env.GESTION_DB_PATH || path.join(DATA_PATH, 'suppliers.json');

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


function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'Token no proporcionado.' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), SECRET_KEY);
    if (isTokenRevoked(payload.jti)) {
      return res.status(401).json({ detail: 'Token inválido o expirado.' });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ detail: 'Token inválido o expirado.' });
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
  let s = db.suppliers.find(x => x.email === email);
  if (!s) {
    s = {
      id:         crypto.randomUUID(),
      email,
      status:     'pendiente',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    db.suppliers.push(s);
  }
  return s;
}

function hasMinimum(s) {
  return s.razon_social && s.nif && s.persona_contacto && s.iban;
}

function loadAuthDB() {
  try {
    if (!fs.existsSync(AUTH_DB_PATH)) return { revoked_tokens: [] };
    return JSON.parse(fs.readFileSync(AUTH_DB_PATH, 'utf8'));
  } catch {
    return { revoked_tokens: [] };
  }
}

function isTokenRevoked(jti) {
  if (!jti) return false;
  const db = loadAuthDB();
  return Array.isArray(db.revoked_tokens) && db.revoked_tokens.some(item => item.jti === jti);
}

const ALLOWED_FIELDS = [
  'razon_social','nombre_comercial','nif','actividad','direccion',
  'codigo_postal','ciudad','persona_contacto','email_contacto',
  'telefono','iban','banco'
];

// responsible_email solo editable por admin
const ADMIN_FIELDS = ['responsible_email'];

const VALID_STATUSES = new Set(['pendiente','revision','aprobado','rechazado']);

// ── Rutas ──────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gestion' }));

app.get('/suppliers/me', authenticate, (req, res) => {
  const db = loadDB();
  const s  = getOrCreate(db, req.user.sub);
  saveDB(db);
  res.json(s);
});

app.put('/suppliers/me', authenticate, (req, res) => {
  const db    = loadDB();
  const email = req.user.sub;
  let s       = db.suppliers.find(x => x.email === email);

  const updates = {};
  ALLOWED_FIELDS.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

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

  if (s) {
    Object.assign(s, updates);
  } else {
    s = { id: crypto.randomUUID(), email, status: 'pendiente', created_at: new Date().toISOString(), ...updates };
    db.suppliers.push(s);
  }

  if (hasMinimum(s) && s.status === 'pendiente') s.status = 'revision';
  saveDB(db);
  res.json(s);
});

app.get('/suppliers/admin/list', authenticate, requireAdmin, (req, res) => {
  const db = loadDB();
  res.json({ suppliers: db.suppliers, total: db.suppliers.length });
});

// GET /suppliers/admin/:id — detalle de un proveedor concreto (solo admin)
app.get('/suppliers/admin/:id', authenticate, requireAdmin, (req, res) => {
  const db = loadDB();
  const s  = db.suppliers.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ detail: 'Proveedor no encontrado.' });
  res.json(s);
});

// PUT /suppliers/admin/:id — edita el perfil de un proveedor concreto (solo admin)
app.put('/suppliers/admin/:id', authenticate, requireAdmin, (req, res) => {
  const db = loadDB();
  const s  = db.suppliers.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ detail: 'Proveedor no encontrado.' });

  const updates = {};
  [...ALLOWED_FIELDS, ...ADMIN_FIELDS].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

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
  res.json(s);
});

app.patch('/suppliers/admin/:id/status', authenticate, requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ detail: `Estado inválido. Válidos: ${[...VALID_STATUSES].join(', ')}` });
  }
  const db = loadDB();
  const s  = db.suppliers.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ detail: 'Proveedor no encontrado.' });
  s.status     = status;
  s.updated_at = new Date().toISOString();
  saveDB(db);
  res.json(s);
});

// ── Start ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  app.listen(PORT, '0.0.0.0', () => console.log(`[gestion] Puerto ${PORT}`));
} else {
  module.exports = app;
}
