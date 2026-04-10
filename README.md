# Tu Estilo Barberia

Aplicacion web para gestionar una barberia con landing publica, reserva de turnos, panel operativo y display en vivo.

## Estructura

- `cliente/barberia`: frontend React + Vite
- `cliente`: wrapper con scripts para ejecutar el frontend real desde una carpeta mas clara
- `servidor`: API Express + MySQL

## Requisitos

- Node.js 20 o superior
- MySQL con las tablas de la app creadas

## Configuracion

1. Copia `servidor/.env.example` a `servidor/.env`
2. Copia `cliente/barberia/.env.example` a `cliente/barberia/.env`
3. Ajusta credenciales de base de datos, `JWT_SECRET`, `CORS_ORIGINS` y `VITE_API_URL`
4. Crea la base ejecutando `servidor/db/schema.sql`

## Desarrollo

Backend:

```powershell
cd servidor
npm install
npm run dev
```

Frontend:

```powershell
cd cliente
npm install
npm run dev
```

Tambien puedes entrar directo a `cliente/barberia` si prefieres trabajar sobre la app React sin el wrapper.

## Variables importantes

- `JWT_SECRET`: obligatoria. El backend ahora falla al arrancar si no existe.
- `CORS_ORIGINS`: lista separada por comas para limitar orígenes permitidos.
- `VITE_API_URL`: URL base de la API consumida por el frontend.
- `VITE_DEBUG_API`: habilita logs de requests en consola del navegador.
- `LOGIN_RATE_LIMIT_WINDOW_MS`: ventana del rate limit de login.
- `LOGIN_RATE_LIMIT_MAX_ATTEMPTS`: cantidad máxima de intentos de login por ventana.
- `COOKIE_NAME`: nombre de la cookie de sesión.
- `COOKIE_SECURE`: usar `true` en HTTPS real.
- `COOKIE_SAME_SITE`: normalmente `Lax` para mismo sitio y `None` si frontend/api quedan en sitios distintos.
- `COOKIE_DOMAIN`: opcional para compartir cookie entre subdominios.
- `TRUST_PROXY`: usar `true` detrás de Nginx, Render, Railway, etc.
- `DEFAULT_TENANT_SLUG`: tenant por defecto para requests sin subdominio/header.
- `TENANT_HEADER_NAME`: header opcional para resolver tenant (por defecto `x-tenant-slug`).
- `TENANT_RESERVED_SLUGS`: subdominios reservados que no se interpretan como tenant (`www,api,app`).
- `TENANT_BASE_DOMAINS`: dominios base para resolver tenant por host (ej: `localhost,app.tudominio.com.ar`).
- `ONBOARDING_API_KEY`: clave requerida para crear nuevos tenants vía endpoint de plataforma.
- `PLATFORM_ADMIN_USERNAME`: usuario del panel maestro (`/platform/login`).
- `PLATFORM_ADMIN_PASSWORD`: contraseña del panel maestro.
- `PLATFORM_JWT_EXPIRES_IN`: expiración del token del panel maestro.
- `STORAGE_PROVIDER`: `local` (desarrollo) o `r2` (producción recomendada).
- `R2_ACCOUNT_ID`: account id de Cloudflare.
- `R2_BUCKET`: nombre del bucket R2.
- `R2_ACCESS_KEY_ID`: access key S3 compatible.
- `R2_SECRET_ACCESS_KEY`: secret key S3 compatible.
- `R2_PUBLIC_BASE_URL`: base pública del bucket (ej: `https://media.tudominio.com`).
- `R2_REGION`: normalmente `auto`.
- `R2_KEY_PREFIX`: prefijo opcional para claves (ej: `prod`).
- `DB_PORT`: puerto de MySQL.
- `DB_SSL_CA_BASE64`: CA de Aiven en base64 para activar SSL en `mysql2`.
- `DB_SSL_REJECT_UNAUTHORIZED`: mantener `true` en producción.
- `VITE_TENANT_SLUG`: tenant a enviar desde el frontend en desarrollo local.

## Base de datos

- El schema base está en `servidor/db/schema.sql`
- Migración incremental multi-tenant: `servidor/db/migrations/001_multi_tenant.sql`
- Migración de configuración por tenant: `servidor/db/migrations/002_tenant_config.sql`
- Migración multi-sucursal: `servidor/db/migrations/007_multi_branch.sql`
- Incluye tablas para `barbers`, `services`, `users`, `appointments` y `appointment_holds`
- Después de crear la base, puedes generar usuarios con:

```powershell
cd servidor
node src/scripts/create-user.js tu-estilo-default admin "Administrador" admin none tu-clave-segura
```

## Deploy

1. Configura todas las variables de entorno del backend y frontend.
2. Ejecuta el schema SQL en tu MySQL administrado.
3. Carga barberos y servicios iniciales en la base.
4. Crea al menos un usuario admin con el script incluido.
5. En producción con dominios distintos, habilita `COOKIE_SECURE=true` y revisa `COOKIE_SAME_SITE=None`.
6. Compila el frontend con `npm run build` dentro de `cliente/barberia`.
7. Antes de publicar, corre `npm test` en `servidor` y `npm run lint` en `cliente/barberia`.

## Onboarding SaaS (Punto 2)

Endpoint:

- `POST /platform/tenants/onboard`
- Header requerido: `x-onboarding-key: <ONBOARDING_API_KEY>`

Payload ejemplo:

```json
{
  "tenantSlug": "barberia-centro",
  "tenantName": "Barberia Centro",
  "tenantPlan": "free",
  "timezone": "America/Argentina/Buenos_Aires",
  "adminName": "Administrador Centro",
  "adminUsername": "admin.centro",
  "adminPassword": "cambia-esta-clave-segura",
  "seedBarbers": ["Lucas Perez", "Martin Gomez"],
  "seedServices": [
    { "name": "Corte", "priceArs": 12000, "durationMin": 30 }
  ]
}
```

## Resolucion Por Subdominio (Punto 3)

- Produccion: el backend puede resolver tenant desde `Host` o `X-Forwarded-Host`.
- Si `TENANT_BASE_DOMAINS=app.tudominio.com.ar` y el host es `barberia-centro.app.tudominio.com.ar`, tenant=`barberia-centro`.
- Subdominios reservados (`www`, `api`, `app`) se ignoran.
- Local: soporta `tenant.localhost`, por ejemplo `http://barberia-centro.localhost:5173`.
- Frontend: si `VITE_TENANT_SLUG` está vacío, envía `x-tenant-slug` con el tenant detectado desde `window.location.hostname`.

## Billing SaaS (Cobros y Suspension)

- Monto mensual configurado en código: `ARS 30000`.
- Ventana de pago: del `1` al `5` de cada mes.
- Desde el día `6`, si no hay pago registrado del mes actual, la app devuelve `TENANT_SUSPENDED` y la landing muestra pantalla de suspensión.
- Métodos aceptados: `transferencia`, `mercado_pago`, `efectivo`.

Endpoints de plataforma (requieren `Authorization: Bearer <token plataforma>` o `x-onboarding-key`):

- `GET /platform/tenants` → listado de tenants + estado de pago del mes actual.
- `GET /platform/config` → configuración de plataforma (dominios base, defaults).
- `GET /platform/billing/overview?month=YYYY-MM` → resumen global (esperado/cobrado/pendiente).
- `GET /platform/tenants/:tenantId/overview` → detalle operativo de un tenant (usuarios, horarios, métricas y últimos turnos).
- `GET /platform/tenants/:tenantId/billing` → detalle de cobros de un tenant.
- `POST /platform/tenants/:tenantId/payments` → registrar o corregir pago mensual.
- `DELETE /platform/tenants/:tenantId/payments/:billingMonth` → borrar pago de un mes.
- `PATCH /platform/tenants/:tenantId/status` → activar/inactivar tenant manualmente.
- `PATCH /platform/tenants/:tenantId/users/:userId/status` → activar/inactivar usuario del tenant.
- `POST /platform/tenants/:tenantId/users` → crear usuario (`admin` o `barber`) dentro del tenant.
- `POST /platform/tenants/:tenantId/users/:userId/reset-password` → resetear contraseña de usuario.
- `GET /platform/audit?limit=50` → auditoría reciente de acciones de plataforma.

Panel maestro inicial:

- Ruta frontend: `/platform/login`
- Usuario por defecto: `anthony`
- Contraseña por defecto: `PoleWorkout%1`
- Después del login, módulo inicial en `/platform` con:
  - alta de barberías (tenant + admin inicial + preview de subdominio)
  - resumen global de cobros
  - listado de tenants
  - registrar/quitar pago mensual
  - activar/inactivar tenant
  - detalle por tenant con acciones sobre usuarios y auditoría

## Configuracion Por Tenant (Horarios, Landing y Galeria)

Nuevas tablas por tenant:

- `tenant_settings`: marca y datos de contacto para landing.
- `business_hours`: horario de atención por día (0-6).
- `tenant_gallery`: imágenes de trabajos realizados.

Endpoints:

- Público: `GET /tenant-config/public`
- Sucursales:
  - `GET /branches` (público)
  - `POST /branches`, `PATCH /branches/:id`, `DELETE /branches/:id` (admin)
- Admin tenant:
  - `GET /tenant-config/admin`
  - `PUT /tenant-config/settings`
  - `PUT /tenant-config/business-hours`
  - `POST /tenant-config/gallery`
  - `POST /tenant-config/gallery/upload` (subida a almacenamiento configurado: local o R2)
  - `PUT /tenant-config/gallery/reorder`
  - `PATCH /tenant-config/gallery/:id`
  - `DELETE /tenant-config/gallery/:id`

Además, para autogestión desde panel admin:

- `POST /barbers`, `PATCH /barbers/:id`, `DELETE /barbers/:id` (admin)
- `POST /services`, `PATCH /services/:id`, `DELETE /services/:id` (admin)

Frontend:

- Nueva vista de configuración: `/admin/settings` (solo rol `admin`)
- La galería del admin normaliza imágenes a formato 4:5 (1200x1500 WebP) antes de subir.
- La galería permite drag-and-drop para reordenar y persiste `sort_order`.

## Stack recomendado: Vercel + Render + Aiven

Fecha de referencia: 19 de marzo de 2026.

Según la documentación oficial, Vercel maneja variables por entorno (`Production`, `Preview`, `Development`), Render provee TLS automático y expone el puerto HTTP por `PORT`, y Aiven recomienda usar SSL con el CA de tu servicio.

- Vercel variables:
  - `VITE_API_URL=https://api.tudominio.com`
- Render variables:
  - `PORT=10000` o dejar el valor por defecto de Render
  - `TRUST_PROXY=true`
  - `COOKIE_SECURE=true`
  - `STORAGE_PROVIDER=r2`
  - `R2_ACCOUNT_ID=<account id cloudflare>`
  - `R2_BUCKET=<bucket r2>`
  - `R2_ACCESS_KEY_ID=<access key>`
  - `R2_SECRET_ACCESS_KEY=<secret key>`
  - `R2_PUBLIC_BASE_URL=https://media.tudominio.com`
  - `R2_REGION=auto`
  - `R2_KEY_PREFIX=prod` (opcional)
  - `JWT_SECRET=<secreto largo>`
  - `DB_HOST=<host de Aiven>`
  - `DB_PORT=<puerto de Aiven>`
  - `DB_USER=<usuario de Aiven>`
  - `DB_PASSWORD=<password de Aiven>`
  - `DB_NAME=<base real>`
  - `DB_SSL_CA_BASE64=<CA de Aiven en base64>`

Recomendacion fuerte:

- Usa dominios propios del mismo sitio, por ejemplo:
  - frontend: `app.tudominio.com` en Vercel
  - api: `api.tudominio.com` en Render
- En ese caso normalmente puedes usar:
  - `CORS_ORIGINS=https://app.tudominio.com`
  - `COOKIE_SAME_SITE=Lax`
  - `COOKIE_DOMAIN=.tudominio.com`

Si en cambio dejas `vercel.app` + `onrender.com`, eso pasa a ser cross-site y normalmente necesitarás:

- `COOKIE_SAME_SITE=None`
- `COOKIE_SECURE=true`
- `CORS_ORIGINS=https://tu-app.vercel.app`

Fuentes oficiales:

- Vercel env vars: https://vercel.com/docs/environment-variables
- Vite en Vercel: https://vercel.com/docs/frameworks/frontend/vite
- Render web services: https://render.com/docs/web-services
- Render custom domains: https://render.com/docs/custom-domains
- Render env vars: https://render.com/docs/environment-variables
- Aiven MySQL SSL/conexión: https://aiven.io/docs/products/mysql/howto/connect-from-mysql-workbench

## Mejoras aplicadas

- Validacion temprana de variables de entorno criticas en servidor
- Rutas protegidas por rol en frontend
- Sesion web por cookie `httpOnly` con compatibilidad para `Bearer` en herramientas
- Hardening HTTP con cabeceras de seguridad y rate limiting en login
- Limpieza de placeholders y pistas de credenciales de desarrollo
- Correccion de memoizaciones que podian dejar servicios desactualizados en panel y display
- Scripts mas claros en `cliente/package.json`
- Schema SQL base y tests automáticos para utilidades criticas
