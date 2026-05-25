'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { requireAuth, requireAdmin } = require('./static/js/auth');


const app  = express();
const PORT = process.env.PORT || 8000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@acme.com';
const MAX_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '10');

app.use(cors());
app.use(express.json({ limit: `${MAX_SIZE_MB * 2}mb` }));
app.use(express.urlencoded({ limit: `${MAX_SIZE_MB * 2}mb`, extended: true }));

// ── Configuración de vistas (EJS) ─────────────────────────────────────
app.set('views', path.join(__dirname, 'views')); // carpeta views/
app.set('view engine', 'ejs');                   // motor EJS

// ── Microservicios ───────────────────────────────────────────────────
const authService     = require('./services/auth/server');
const gestionService  = require('./services/gestion/server');
const archivosService = require('./services/archivos/server');

app.use(authService);
app.use(gestionService);
app.use(archivosService);

// `requireAuth` is provided by the auth helper imported above; server-side rendering keeps pages simple.

// ── Frontend estático ────────────────────────────────────────────────
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, 'static');

app.use('/static', express.static(STATIC_DIR));

// Wrapper: if Authorization header is present, enforce `requireAuth`; otherwise allow render
function requireAuthIfHeader(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return next();
  return requireAuth(req, res, next);
}

// ── Rutas de páginas (render EJS) ────────────────────────────────────
app.get('/', (req, res) => {
  res.render('login-email', {
    title: 'Portal de Proveedores',
    adminEmailContact: ADMIN_EMAIL
  });
});

app.get('/login', (req, res) => {
  res.render('login-otp', { title: 'Portal electrónico - Login' });
});

app.get('/proveedores', requireAuth, (req, res) => {
  console.log('/proveedores - Usuario:', req.user);
  console.log('/proveedores - Token:', req.token);
  res.render('admin-proveedores', { title: 'Portal electrónico - Administración' });
});

// Edit view for profile
app.get('/perfil-edit', requireAuth, (req, res) => {
  console.log('/perfil-edit - Usuario:', req.user);
  console.log('/perfil-edit - Token:', req.token);
  res.render('perfil-edit', { title: 'Portal electrónico - Editar perfil' });
});

app.get('/perfil', requireAuth, (req, res) => {
  console.log('/perfil - Usuario:', req.user);
  console.log('/perfil - Token:', req.token);
  res.render('perfil', { title: 'Portal electrónico - Perfil de proveedores' });
});

// Health global
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'portal-unificado' })
);

// Fallback opcional: si entras a una ruta desconocida, te llevo al login
app.get('*', (req, res) => {
  res.render('404', { title: 'Portal electrónico - Upsss!!!!' });
});

// ── Arranque ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[portal] Servidor unificado corriendo en http://0.0.0.0:${PORT}`);
});