'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

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

// ── Frontend estático ────────────────────────────────────────────────
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, 'static');

app.use('/static', express.static(STATIC_DIR));

// ── Rutas de páginas (render EJS) ────────────────────────────────────
app.get('/', (req, res) => {
  res.render('login-email', { title: 'Portal de Proveedores' });
});

app.get('/login', (req, res) => {
  res.render('login-otp', { title: 'Portal electrónico - Login' });
});

app.get('/proveedores', (req, res) => {
  res.render('admin-proveedores', { title: 'Portal electrónico - Administración' });
});

app.get('/perfil', (req, res) => {
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