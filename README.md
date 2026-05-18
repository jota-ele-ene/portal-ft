# 🏢 Portal de Proveedores

Portal web de autoservicio para que los proveedores de una pyme puedan **autenticarse con OTP por email**, **rellenar su información fiscal y de contacto** y **adjuntar documentos**, todo gestionado por un panel de administración.

> ✅ Stack 100% **Node.js** — todos los microservicios usan `node:20-slim`.

---

## 📦 Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  Navegador del proveedor / admin                                │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP :80
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  nginx  (gateway + frontend estático)                          │
│   /api/auth/*       → auth:8001                                │
│   /api/suppliers/*  → gestion:8002                             │
│   /api/documents/*  → archivos:8003                            │
│   /*                → /frontend (HTML/CSS/JS)                  │
└──────┬──────────────────┬──────────────────┬───────────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐
│ auth         │  │ gestion      │  │ archivos                 │
│ Node.js:8001 │  │ Node.js:8002 │  │ Node.js:8003             │
│ express +    │  │ express +    │  │ express + multer          │
│ nodemailer   │  │ JSON store   │  │ sistema de ficheros       │
│ /data/       │  │ /data/       │  │ /data/uploads/<email>/   │
│ auth.json    │  │ suppliers.   │  │                          │
│              │  │ json         │  │                          │
└──────────────┘  └──────────────┘  └──────────────────────────┘
                         │
               Volumen Docker: portal_data
               /data/auth.json
               /data/suppliers.json
               /data/uploads/<email_proveedor>/
```

---

## 🚀 Inicio rápido

### Prerrequisitos

- Docker 24+
- Docker Compose v2

### 1. Descomprime el proyecto

```bash
unzip portal-proveedores.zip
cd portal-proveedores-template
```

### 2. Configura el entorno

```bash
cp .env.example .env
nano .env
```

**Variables clave:**

| Variable | Descripción |
|---|---|
| `JWT_SECRET` | Clave secreta JWT (mín. 32 caracteres aleatorios) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Credenciales SMTP |
| `ADMIN_EMAILS` | Correos con acceso al panel de administración |

> **Desarrollo sin SMTP:** deja `SMTP_USER` vacío. Los códigos OTP aparecerán en los logs del contenedor:
> ```bash
> docker compose logs -f auth
> # [DEV] OTP para proveedor@empresa.com: 483921
> ```

### 3. Levanta todos los servicios

```bash
docker compose up --build
```

### 4. Abre el portal

| URL | Descripción |
|---|---|
| `http://localhost/` | Portal del proveedor |
| `http://localhost/admin.html` | Panel de administración |
| `http://localhost/health/auth` | Health check auth |
| `http://localhost/health/gestion` | Health check gestión |
| `http://localhost/health/archivos` | Health check archivos |

---

## 🔐 Flujo OTP

```
Proveedor          auth (Node.js)         Email
─────────          ──────────────         ─────
1. Introduce email
2. POST /api/auth/otp/request ──────────────────>
                  genera OTP de 6 dígitos
                  guarda en auth.json (TTL 5 min)
                  envía email con nodemailer <────
3. Recibe código
4. POST /api/auth/otp/verify  ──────────────────>
                  valida OTP
                  devuelve JWT (Bearer)
5. JWT en memoria (no localStorage)
6. Peticiones con: Authorization: Bearer <token>
```

---

## 📂 Estructura de ficheros

```
portal-proveedores-template/
│
├── docker-compose.yml
├── .env.example
├── README.md
│
├── frontend/
│   ├── index.html              ← Portal proveedor (login → OTP → formulario)
│   ├── admin.html              ← Panel de administración
│   └── static/
│       ├── css/app.css
│       └── js/
│           ├── login.js
│           ├── supplier-form.js
│           └── admin.js
│
├── services/
│   ├── auth/                   ← Node.js + Express + Nodemailer
│   │   ├── server.js
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── .dockerignore
│   │
│   ├── gestion/                ← Node.js + Express + JSON store
│   │   ├── server.js
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── .dockerignore
│   │
│   └── archivos/               ← Node.js + Express + Multer
│       ├── server.js
│       ├── package.json
│       ├── Dockerfile
│       └── .dockerignore
│
├── nginx/
│   └── nginx.conf
│
└── data/
    └── uploads/                ← Documentos subidos por proveedor
```

---

## 🗄️ Base de datos (JSON / TinyDB-style)

Cada servicio escribe en un fichero JSON en el volumen compartido `portal_data`:

### `auth.json`
```json
{
  "otp_codes": [
    { "email": "proveedor@empresa.com", "otp": "483921",
      "created_at": 1716048000, "expires_at": 1716048300, "used": false }
  ],
  "users": [
    { "id": "uuid", "email": "proveedor@empresa.com",
      "role": "supplier", "created_at": "2026-01-01T10:00:00.000Z" }
  ]
}
```

### `suppliers.json`
```json
{
  "suppliers": [
    {
      "id": "uuid",
      "email": "proveedor@empresa.com",
      "razon_social": "Empresa Ejemplo S.L.",
      "nif": "B12345678",
      "iban": "ES00 0000 0000 0000 0000 0000",
      "status": "revision",
      "created_at": "2026-01-01T10:00:00.000Z",
      "updated_at": "2026-01-15T14:30:00.000Z"
    }
  ]
}
```

### Jerarquía de uploads

```
/data/uploads/
└── proveedor_empresa_com/
    ├── 1716048000_CIF.pdf
    ├── 1716048100_certificado_AEAT.pdf
    └── 1716048200_SS.jpg
```

---

## 📋 API Reference

### Auth (`/api/auth/`)

| Método | Ruta | Body | Descripción |
|---|---|---|---|
| `POST` | `/api/auth/otp/request` | `{ email }` | Solicita OTP |
| `POST` | `/api/auth/otp/verify`  | `{ email, otp }` | Verifica y devuelve JWT |

### Gestión (`/api/suppliers/`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET`   | `/api/suppliers/me` | JWT | Perfil del proveedor |
| `PUT`   | `/api/suppliers/me` | JWT | Actualiza perfil |
| `GET`   | `/api/suppliers/admin/list` | JWT (admin) | Lista todos |
| `PATCH` | `/api/suppliers/admin/:id/status` | JWT (admin) | Cambia estado |

**Estados:** `pendiente` → `revision` → `aprobado` / `rechazado`

### Archivos (`/api/documents/`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST`   | `/api/documents/upload` | JWT | Sube documento |
| `GET`    | `/api/documents/list` | JWT | Lista propios |
| `GET`    | `/api/documents/admin/list/:email` | JWT (admin) | Lista de proveedor |
| `GET`    | `/api/documents/download/:email/:file` | JWT (admin) | Descarga |
| `DELETE` | `/api/documents/:email/:file` | JWT (admin) | Elimina |

**Formatos:** PDF, JPG, PNG, DOC, DOCX · **Máx.:** 10 MB

---

## 🛠️ Comandos útiles

```bash
# Ver OTP en desarrollo
docker compose logs -f auth | grep "OTP para"

# Reconstruir un servicio tras cambios
docker compose up --build auth

# Reiniciar sin reconstruir
docker compose restart gestion

# Parar todo (mantiene datos)
docker compose down

# Parar y borrar datos
docker compose down -v
```

---

## 📧 SMTP para desarrollo con MailHog

Añade en `docker-compose.yml`:

```yaml
  mailhog:
    image: mailhog/mailhog:latest
    ports:
      - "1025:1025"
      - "8025:8025"
    networks:
      - portal-net
```

Y en `.env`:
```
SMTP_HOST=mailhog
SMTP_PORT=1025
SMTP_USER=test
SMTP_PASS=test
```

Bandeja de entrada de pruebas: `http://localhost:8025`

---

## 🔒 Seguridad en producción

- [ ] Cambiar `JWT_SECRET` (64+ caracteres aleatorios)
- [ ] Activar HTTPS (Traefik / Caddy / certbot)
- [ ] Limitar `ADMIN_EMAILS` al mínimo necesario
- [ ] Añadir rate limiting en nginx para `/api/auth/otp/request`
- [ ] Revisar tamaño máximo de uploads (`MAX_FILE_SIZE_MB`)

---

## 📄 Licencia

MIT — Libre para uso comercial y modificación.
