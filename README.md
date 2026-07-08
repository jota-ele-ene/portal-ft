# 🏢 Portal de Proveedores

Portal web de autoservicio para que los proveedores de una pyme puedan **autenticarse con OTP por email**, **rellenar su información fiscal y de contacto** y **adjuntar documentos**, todo gestionado desde un panel de administración.

> ✅ Stack 100% **Node.js** — un único servicio unificado que integra auth, gestión y archivos.

---

## 📦 Arquitectura

El portal es una aplicación **monolítica unificada** con Express + EJS. Los módulos de auth, gestión de proveedores y archivos se montan como routers internos dentro de un único proceso Node.js. La sesión se gestiona mediante cookies HTTP-only en el servidor (no JWT en el cliente).

```
┌─────────────────────────────────────────────────────┐
│  Navegador del proveedor / admin                    │
└────────────────────┬────────────────────────────────┘
                     │ HTTP :8000
                     ▼
┌─────────────────────────────────────────────────────┐
│  server.js  (Express + EJS + express-session)       │
│                                                     │
│   /api/auth/*        → services/auth/server.js      │
│   /api/suppliers/*   → services/gestion/server.js   │
│   /api/documents/*   → services/archivos/server.js  │
│   /bank-entity       → lookup BdE entities          │
│   /postal-info       → lookup CP → ciudad/provincia │
│   /* (GET)           → vistas EJS (views/)          │
└──────────────────────────┬──────────────────────────┘
                           │
               Volumen Docker: portal_data
               /data/auth.json
               /data/suppliers.json
               /data/uploads/<email_proveedor>/
               /data/bde_entities.json
               /data/cp_city.json
               /data/roles_routes.json
```

---

## 🚀 Inicio rápido

### Prerrequisitos

- Docker 24+
- Docker Compose v2

### 1. Clona el repositorio

```bash
git clone https://github.com/jota-ele-ene/portal-ft.git
cd portal-ft
```

### 2. Configura el entorno

```bash
cp .env.example .env
nano .env
```

**Variables clave:**

| Variable | Descripción |
|---|---|
| `JWT_SECRET` | Clave secreta para firmar tokens (mín. 32 caracteres) |
| `SESSION_SECRET` | Clave para firmar la cookie de sesión |
| `ADMIN_EMAIL` | Email del administrador principal |
| `GEST_EMAIL` | Email de destino para notificaciones de actualización |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Credenciales SMTP |
| `PORTAL_URL` | URL pública del portal (usada en los correos) |

> **Desarrollo sin SMTP:** deja `SMTP_USER` vacío. Los códigos OTP aparecerán en los logs del contenedor:
> ```bash
> docker compose logs -f portal
> # [DEV] OTP para proveedor@empresa.com: 483921
> ```

### 3. Levanta el servicio

```bash
docker compose up --build
```

### 4. Abre el portal

| URL | Descripción |
|---|---|
| `http://localhost:8000/` | Portal del proveedor (login con OTP) |
| `http://localhost:8000/proveedores` | Panel de administración |
| `http://localhost:8000/health` | Health check del servicio unificado |

---

## 🔐 Flujo OTP

```
Proveedor          server.js (auth module)     Email
─────────          ───────────────────────     ─────
1. Introduce email
2. POST /api/auth/otp/request ──────────────────────>
                  genera OTP de 6 dígitos
                  guarda en auth.json (TTL 5 min)
                  envía email con nodemailer <────────
3. Recibe código
4. POST /api/auth/otp/verify  ──────────────────────>
                  valida OTP
                  crea sesión de usuario (cookie HTTP-only)
5. Redirige a la vista correspondiente según rol
```

La sesión se almacena en el servidor con `express-session`. La cookie `portal.sid` es `httpOnly` y `sameSite: lax`.

---

## 🔑 Roles y control de acceso

El acceso a las rutas se controla mediante `roles_routes.json` (en `/data/`), que define qué rutas puede visitar cada rol. El fichero se recarga en caliente cada 60 segundos.

| Rol | Acceso |
|---|---|
| `supplier` | `/perfil`, `/perfil-edit` |
| `admin` | `/proveedores`, `/perfil/:id`, `/perfil-edit/:id` |

Los proveedores con estado `invited` son redirigidos automáticamente al formulario de edición al acceder a `/perfil`.

---

## 📂 Estructura de ficheros

```
portal-ft/
│
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── server.js                   ← Entrada principal (Express unificado)
│
├── services/
│   ├── auth/server.js          ← OTP, login, logout
│   ├── gestion/server.js       ← CRUD proveedores + estados
│   └── archivos/server.js      ← Upload/download de documentos (Multer)
│
├── views/                      ← Plantillas EJS
│   ├── layout.ejs
│   ├── login-email.ejs
│   ├── login-otp.ejs
│   ├── perfil.ejs
│   ├── perfil-edit.ejs
│   ├── admin-proveedores.ejs
│   ├── 404.ejs
│   └── partials/
│
├── static/                     ← CSS, JS del cliente
│
├── email-templates/            ← Plantillas HTML de correos
│
├── scripts/                    ← Scripts de utilidad
│
└── data/                       ← Volumen persistente (montado por Docker)
    ├── auth.json
    ├── suppliers.json
    ├── bde_entities.json       ← Entidades bancarias BdE
    ├── cp_city.json            ← Códigos postales → ciudad/provincia
    ├── roles_routes.json       ← Control de acceso por rol
    └── uploads/
        └── <email_proveedor>/
```

---

## 🗄️ Almacenamiento (JSON / ficheros)

Toda la persistencia se resuelve con ficheros JSON en el volumen `portal_data`.

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

**Estados del proveedor:** `invited` → `pendiente` → `revision` → `aprobado` / `rechazado`

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
| `POST` | `/api/auth/otp/verify`  | `{ email, otp }` | Verifica OTP e inicia sesión |
| `POST` | `/api/auth/logout`      | — | Cierra sesión (destruye cookie) |

### Gestión (`/api/suppliers/`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET`   | `/api/suppliers/me`                   | sesión (supplier) | Perfil propio |
| `PUT`   | `/api/suppliers/me`                   | sesión (supplier) | Actualiza perfil |
| `GET`   | `/api/suppliers/admin/list`           | sesión (admin) | Lista todos los proveedores |
| `PATCH` | `/api/suppliers/admin/:id/status`     | sesión (admin) | Cambia estado |

### Archivos (`/api/documents/`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST`   | `/api/documents/upload`                   | sesión | Sube documento |
| `GET`    | `/api/documents/list`                     | sesión | Lista propios |
| `GET`    | `/api/documents/admin/list/:email`        | sesión (admin) | Lista de proveedor |
| `GET`    | `/api/documents/download/:email/:file`    | sesión (admin) | Descarga |
| `DELETE` | `/api/documents/:email/:file`             | sesión (admin) | Elimina |

**Formatos aceptados:** PDF, JPG, PNG, DOC, DOCX · **Tamaño máximo:** `MAX_FILE_SIZE_MB` (defecto: 10 MB)

### Utilidades

| Método | Ruta | Params | Descripción |
|---|---|---|---|
| `GET` | `/bank-entity`   | `?code=XXXX`               | Nombre y BIC de entidad bancaria (BdE) |
| `GET` | `/postal-info`   | `?cp=28001`                | Ciudad y provincia por código postal |
| `GET` | `/branch-address`| `?entidad=X&sucursal=Y`    | Dirección de sucursal bancaria |
| `GET` | `/health`        | —                          | Estado del servicio |

---

## 🛠️ Comandos útiles

```bash
# Ver OTP en desarrollo
docker compose logs -f portal | grep "OTP para"

# Reconstruir tras cambios
docker compose up --build

# Reiniciar sin reconstruir
docker compose restart portal

# Parar (mantiene datos)
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

- [ ] Cambiar `JWT_SECRET` y `SESSION_SECRET` (64+ caracteres aleatorios)
- [ ] Activar HTTPS (Traefik / Caddy / certbot) y poner `cookie.secure: true`
- [ ] Limitar `ADMIN_EMAILS` al mínimo necesario
- [ ] Añadir rate limiting delante de `/api/auth/otp/request`
- [ ] Revisar tamaño máximo de uploads (`MAX_FILE_SIZE_MB`)
- [ ] No exponer el directorio `/data` en producción

---

## 📄 Licencia

MIT — Libre para uso comercial y modificación.
