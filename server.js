'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs/promises');
const session = require('express-session');

const app  = express();
const PORT = process.env.PORT || 8000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@acme.com';
const MAX_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '10');

app.use(cors());
app.use(express.json({ limit: `${MAX_SIZE_MB * 2}mb` }));
app.use(express.urlencoded({ limit: `${MAX_SIZE_MB * 2}mb`, extended: true }));

app.use(session({
  name: process.env.SESSION_COOKIE_NAME || 'portal.sid',
  secret: process.env.SESSION_SECRET || 'cambia-esta-clave-de-sesion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: (parseInt(process.env.TOKEN_EXPIRE_MINUTES || '120')) * 60 * 1000
  }
}));

const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, 'static');
const DATA_DIR = path.join(__dirname, 'data');

app.use('/static', express.static(STATIC_DIR));
app.use('/data', express.static(DATA_DIR));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use((req, res, next) => {
  req.user = req.session?.user || null;
  res.locals.user = req.user || null;
  next();
});

function requireAuthPage(req, res, next) {
  if (!req.user) {
    return res.redirect('/');
  }
  next();
}

function requireAdminPage(req, res, next) {
  if (!req.user) {
    return res.redirect('/');
  }
  if (req.user.role !== 'admin') {
    return res.status(403).render('404', { title: 'Portal electrónico - Acceso denegado' });
  }
  next();
}

const authModule = require('./services/auth/server');
const authService = authModule;
const { authenticate } = authModule;

const gestionService  = require('./services/gestion/server');
const archivosService = require('./services/archivos/server');

app.use(authService);
app.use(gestionService);
app.use(archivosService);

app.get('/', (req, res) => {
  if (req.user?.role === 'admin') {
    return res.redirect('/proveedores');
  }
  if (req.user?.role === 'supplier') {
    return res.redirect('/perfil');
  }

  res.render('login-email', {
    title: 'Portal de Proveedores',
    adminEmailContact: ADMIN_EMAIL
  });
});

app.get('/login', (req, res) => {
  if (req.user?.role === 'admin') {
    return res.redirect('/proveedores');
  }
  if (req.user?.role === 'supplier') {
    return res.redirect('/perfil');
  }

  res.render('login-otp', { title: 'Portal electrónico - Login' });
});

app.get('/proveedores', requireAdminPage, (req, res) => {
  res.render('admin-proveedores', {
    title: 'Portal electrónico - Administración',
    user: req.user
  });
});

app.get('/perfil-edit', requireAuthPage, (req, res) => {
  res.render('perfil-edit', {
    title: 'Portal electrónico - Editar perfil',
    supplierId: null,
    mode: 'edit',
    user: req.user
  });
});

app.get('/perfil', requireAuthPage, (req, res) => {
  res.render('perfil', {
    title: 'Portal electrónico - Perfil de proveedores',
    supplierId: null,
    mode: 'view',
    user: req.user
  });
});

app.get('/perfil/:id', requireAdminPage, (req, res) => {
  res.render('perfil', {
    title: 'Portal electrónico - Perfil de proveedor',
    supplierId: req.params.id,
    user: req.user,
    mode: 'view'
  });
});

app.get('/perfil-edit/:id', requireAdminPage, (req, res) => {
  res.render('perfil-edit', {
    title: 'Portal electrónico - Editar proveedor',
    supplierId: req.params.id,
    user: req.user,
    mode: 'edit'
  });
});

app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'portal-unificado' })
);

const BDE_ENTITIES_PATH = path.join(DATA_DIR, 'bde_entities.json');
let bdeEntityCache = { timestamp: 0, data: null };

async function loadBankEntityData() {
  const now = Date.now();
  if (bdeEntityCache.data && now - bdeEntityCache.timestamp < 24 * 60 * 60 * 1000) {
    return bdeEntityCache.data;
  }

  try {
    const content = await fs.readFile(BDE_ENTITIES_PATH, 'utf-8');
    const rows = JSON.parse(content);
    const mapping = {};
    rows.forEach(row => {
      if (!row || !row.codigo) return;
      mapping[row.codigo] = { name: row.nombre || '', bic: row.bic || '' };
    });
    bdeEntityCache = { timestamp: now, data: mapping };
    return mapping;
  } catch (error) {
    console.error('loadBankEntityData error', error);
    bdeEntityCache = { timestamp: now, data: {} };
    return {};
  }
}

app.get('/bank-entity', async (req, res) => {
  const bankCode = req.query.code;
  if (!bankCode) {
    return res.status(400).json({ detail: 'El código de entidad es requerido.' });
  }

  try {
    const data = await loadBankEntityData();
    const entity = data[bankCode];
    return res.json({
      name: entity ? entity.name : '',
      bic: entity ? entity.bic : ''
    });
  } catch (error) {
    console.error('bank-entity error', error);
    return res.status(500).json({ detail: 'Error cargando datos de entidades bancarias.' });
  }
});

app.get('/branch-address', async (req, res) => {
  const entidad = req.query.entidad;
  const sucursal = req.query.sucursal;
  if (!entidad || !sucursal) {
    return res.status(400).json({ detail: 'Entidad y sucursal son requeridos.' });
  }

  try {
    const baseUrl = 'http://www.sucursalesbancarias.info/';
    const homeRes = await fetch(baseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html'
      }
    });
    const cookies = homeRes.headers.get('set-cookie') || '';
    const homeHtml = await homeRes.text();
    const tokenMatch = homeHtml.match(/id=\"form__token\"[^>]*value=\"([^\"]+)\"/);
    const token = tokenMatch ? tokenMatch[1] : '';

    const body = new URLSearchParams();
    body.append('form[entidad]', entidad);
    body.append('form[sucursal]', sucursal);
    body.append('form[buscar]', 'Buscar');
    if (token) body.append('form[_token]', token);

    const postRes = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies
      },
      body: body.toString()
    });
    const resultHtml = await postRes.text();
    const addressMatch = resultHtml.match(/var\\s+mapa\\s*=\\s*\"([^\"]+)\"/);
    const address = addressMatch ? addressMatch[1].trim() : '';
    return res.json({ address });
  } catch (error) {
    console.error('branch-address error', error);
    return res.status(500).json({ detail: 'Error consultando la dirección de la sucursal.' });
  }
});

const CP_CITY_PATH = path.join(DATA_DIR, 'cp_city.json');
let cpCityCache = { timestamp: 0, data: null };

async function loadPostalCityData() {
  const now = Date.now();
  if (cpCityCache.data && now - cpCityCache.timestamp < 24 * 60 * 60 * 1000) {
    return cpCityCache.data;
  }

  try {
    const content = await fs.readFile(CP_CITY_PATH, 'utf-8');
    const rows = JSON.parse(content);
    const mapping = {};
    rows.forEach(row => {
      if (!row || !row.cp) return;
      mapping[row.cp] = {
        ciudad: row.ciudad || '',
        provincia: row.provincia || ''
      };
    });
    cpCityCache = { timestamp: now, data: mapping };
    return mapping;
  } catch (error) {
    console.error('loadPostalCityData error', error);
    cpCityCache = { timestamp: now, data: {} };
    return {};
  }
}

app.get('/postal-info', async (req, res) => {
  const cp = (req.query.cp || '').trim();
  if (!cp) {
    return res.status(400).json({ detail: 'El código postal es requerido.' });
  }

  try {
    const data = await loadPostalCityData();
    const entry = data[cp];
    if (!entry) {
      return res.json({ ciudad: '', provincia: '' });
    }
    return res.json({
      ciudad: entry.ciudad || '',
      provincia: entry.provincia || ''
    });
  } catch (error) {
    console.error('postal-info error', error);
    return res.status(500).json({ detail: 'Error cargando datos de códigos postales.' });
  }
});

app.get('*', (req, res) => {
  res.render('404', { title: 'Portal electrónico - Upsss!!!!' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[portal] Servidor unificado corriendo en http://0.0.0.0:${PORT}`);
});