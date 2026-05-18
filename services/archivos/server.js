/**
 * Microservicio de archivos — Puerto 8003
 * 
 * POST /documents/upload        → Sube fichero (JWT required, carpeta /uploads/<supplierEmail>/)
 * GET  /documents/list          → Lista archivos del proveedor autenticado
 * GET  /documents/admin/list/:email → Lista archivos de un proveedor (admin)
 * GET  /documents/download/:email/:filename → Descarga un archivo (admin)
 * DELETE /documents/:email/:filename        → Elimina un archivo (admin)
 * GET  /static/*                → Sirve archivos estáticos del frontend
 */

const express    = require('express');
const multer     = require('multer');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const mime       = require('mime-types');

const app  = express();
const PORT = process.env.PORT || 8003;

const SECRET_KEY  = process.env.JWT_SECRET   || 'cambia-este-secreto-en-produccion';
const UPLOADS_DIR = process.env.UPLOADS_DIR  || '/data/uploads';
const STATIC_DIR  = process.env.STATIC_DIR   || '/app/static';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'admin@tuempresa.com').split(',').map(e => e.trim().toLowerCase());
const MAX_SIZE_MB  = parseInt(process.env.MAX_FILE_SIZE_MB || '10');

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Servir static (frontend)
app.use('/static', express.static(STATIC_DIR));

// ── Auth middleware ────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'Token no proporcionado.' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), SECRET_KEY);
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

// ── Multer config ──────────────────────────────────────────────────────────
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const emailSlug = sanitizeEmail(req.user.sub);
    const dir = path.join(UPLOADS_DIR, emailSlug);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const ts   = Date.now();
    cb(null, `${ts}_${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
    }
  }
});

function sanitizeEmail(email) {
  return (email || 'unknown').replace(/[^a-zA-Z0-9@._\-]/g, '_');
}

// ── Rutas ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'archivos' }));

// Subir archivo
app.post('/documents/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ detail: 'No se recibió ningún fichero.' });

  const emailSlug = sanitizeEmail(req.user.sub);
  res.json({
    message:   'Archivo subido correctamente.',
    filename:  req.file.filename,
    original:  req.file.originalname,
    size:      req.file.size,
    path:      `uploads/${emailSlug}/${req.file.filename}`,
    uploaded_at: new Date().toISOString()
  });
});

// Listar archivos del proveedor autenticado
app.get('/documents/list', authenticate, (req, res) => {
  const emailSlug = sanitizeEmail(req.user.sub);
  const dir = path.join(UPLOADS_DIR, emailSlug);
  if (!fs.existsSync(dir)) return res.json({ files: [] });

  const files = fs.readdirSync(dir).map(f => {
    const stat = fs.statSync(path.join(dir, f));
    return {
      filename: f,
      size:     stat.size,
      uploaded_at: stat.mtime.toISOString(),
      mimetype: mime.lookup(f) || 'application/octet-stream'
    };
  });
  res.json({ files, email: req.user.sub });
});

// Admin: listar archivos de un proveedor
app.get('/documents/admin/list/:email', authenticate, requireAdmin, (req, res) => {
  const emailSlug = sanitizeEmail(req.params.email);
  const dir = path.join(UPLOADS_DIR, emailSlug);
  if (!fs.existsSync(dir)) return res.json({ files: [], email: req.params.email });

  const files = fs.readdirSync(dir).map(f => {
    const stat = fs.statSync(path.join(dir, f));
    return {
      filename: f,
      size:     stat.size,
      uploaded_at: stat.mtime.toISOString(),
      mimetype: mime.lookup(f) || 'application/octet-stream'
    };
  });
  res.json({ files, email: req.params.email });
});

// Admin: descargar archivo
app.get('/documents/download/:email/:filename', authenticate, requireAdmin, (req, res) => {
  const emailSlug = sanitizeEmail(req.params.email);
  const filename  = path.basename(req.params.filename); // prevención path traversal
  const filePath  = path.join(UPLOADS_DIR, emailSlug, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ detail: 'Archivo no encontrado.' });
  res.download(filePath, filename);
});

// Admin: eliminar archivo
app.delete('/documents/:email/:filename', authenticate, requireAdmin, (req, res) => {
  const emailSlug = sanitizeEmail(req.params.email);
  const filename  = path.basename(req.params.filename);
  const filePath  = path.join(UPLOADS_DIR, emailSlug, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ detail: 'Archivo no encontrado.' });
  fs.unlinkSync(filePath);
  res.json({ message: 'Archivo eliminado.' });
});

// ── Error handler multer ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ detail: `Error de carga: ${err.message}` });
  }
  if (err) return res.status(400).json({ detail: err.message });
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[archivos] Servicio corriendo en puerto ${PORT}`);
  console.log(`[archivos] Directorio uploads: ${UPLOADS_DIR}`);
  console.log(`[archivos] Static dir: ${STATIC_DIR}`);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
});
