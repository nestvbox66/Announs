# Backoffice — Especificación de Autenticación

Versión: 1.0
Fecha: 2026-08-09
Proyecto origen: Desktop Announs
Proyecto destino: Announs Backoffice
Proveedor: Supabase Auth

> Documento de especificación técnica para que otro OpenCode implemente la autenticación
> del nuevo proyecto `announs-backoffice`, reutilizando el mismo proyecto Supabase del Desktop.
>
> Base exclusivamente en la implementación REAL del Desktop (commit `c7bfc77`,
> tag `desktop-v1.0.0-baseline`).
>
> Notación utilizada en todo el documento:
> - **HECHO** — comportamiento comprobado en el código del Desktop.
> - **NO VERIFICABLE** — información que no puede comprobarse desde el repositorio local
>   (vive en el proyecto Supabase remoto).
> - **RECOMENDACIÓN** — decisión propuesta para el nuevo Backoffice (no es una característica existente).

---

## 1. Supabase

### 1.1 Proyecto y librería — HECHO

- **Proyecto Supabase:** `kljeqrwydbisciajoiff` — URL `https://kljeqrwydbisciajoiff.supabase.co`. Es el **mismo proyecto** que reutilizará el Backoffice.
- **Librería:** `@supabase/supabase-js` `^2.108.0` (declarada en `package.json` del Desktop).
- **Archivo donde se crea el cliente:** `src/lib/supabase.ts`.
- **Variables de entorno requeridas:**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - Se definen en `.env` (NO versionado; `.env.example` contiene solo placeholders).
- **Opciones al crear el cliente:** ninguna. Se usa `createClient(url, anonKey)` sin tercer argumento.

### 1.2 Comportamiento por defecto resultante (supabase-js v2) — HECHO

- `persistSession: true` → la sesión se persiste en **localStorage** (clave prefijada por proyecto, `sb-token`). Sobrevive recargas del navegador.
- `autoRefreshToken: true` → el access token se renueva automáticamente usando el refresh token.
- `detectSessionInUrl: true` → supabase-js detecta `#access_token` en la URL (retorno de OAuth).
- **NO se usa** cliente server-side (`createServerClient`) ni `service_role` en el repo; solo la anon key.

### 1.3 Config remota — NO VERIFICABLE

- Las opciones reales de Auth (providers activos, Site URL, Redirect URLs, expiración de tokens) se configuran en el dashboard de Supabase y no aparecen en el repositorio.

---

## 2. Métodos de autenticación usados por el Desktop

### 2.1 Email + Password — HECHO

- **Función Supabase:** `supabase.auth.signInWithPassword({ email, password })` — `src/components/HubView.tsx:432`.
- **Componente:** `HubView` (vista "hub", panel "Desconectado").
- **Tras el login:** en success se llama `onLogin()` → `App.tsx:238` → `setIsLoggedIn(true)`.
- **Cómo se determina que el usuario está autenticado:** por el estado React `isLoggedIn` (no por la sesión real de Supabase).
- **Callback/redirect:** no aplica (flujo de formulario).

### 2.2 Google OAuth — HECHO

- **Función Supabase:** `supabase.auth.signInWithOAuth({ provider: "google" })` — `HubView.tsx:551`.
- **Componente:** `HubView`.
- **Tras el login:** **NO se llama a `onLogin`** después del redirect. El retorno se resuelve con la detección automática del fragment en la URL (`#access_token`) del SDK.
- **Limitación conocida (HECHO):** como `isLoggedIn` arranca en `false` y no hay `onAuthStateChange`, el estado visual **puede quedar desincronizado** tras un login con Google (el token queda persistido pero la UI no se actualiza). **No se corrige en esta etapa.**

### 2.3 Otros métodos — NO VERIFICABLE / HECHO

- **HECHO:** no se usa `signUp`, `resetPassword`/recuperación de contraseña, `updateUser` ni otros providers.
- No existe registro de usuario dentro del Desktop; los usuarios se crean por fuera (dashboard o trigger externo en el proyecto Supabase).

---

## 3. Estado de sesión

### Diferencia clave (HECHO)

Existen dos conceptos distintos, que NO deben confundirse:

1. **Sesión real administrada por Supabase:** tokens + refresh persistidos en `localStorage`, con auto-refresh por defecto del SDK. Existe si el usuario se autenticó antes.
2. **Estado visual `isLoggedIn` del Desktop:** estado React en `App.tsx:37` (`useState(false)`). Es un gate de UI entre el login y el panel. **No es una sesión.**

### HECHO — Manejo actual

- **Dónde vive:** `App.tsx:37`, pasado como prop a `Sidebar` y `HubView`.
- **Inicialización:** `false` (modo "Desconectado") siempre al arrancar.
- **Detección de sesión existente:** **no existe.** No se consulta `getSession()` al boot. Aunque haya token en localStorage, la UI arranca en login.
- **`onAuthStateChange`:** **NO existe** en el repo (0 ocurrencias).
- **`getSession`:** **NO se usa** en el Desktop.
- **`getUser`:** se usa de forma aislada en las vistas de datos:
  - `HubView.tsx:74`, `AccountView.tsx:87`, `ConfigView.tsx:94`, `VueloActualView.tsx:623` y `:955`.
  - Si falla o devuelve `null`, cada vista simplemente queda sin datos (no cierra sesión ni redirige).
- **Al recargar la aplicación:** vuelve al login ("Desconectado") aunque el token siga persistido; `isLoggedIn` no se restaura.
- **Si expira el token:** el auto-refresh intenta renovarlo; al no haber suscripción de estado, la UI no lo refleja.
- **Si la sesión deja de ser válida:** `getUser()` falla → las vistas quedan vacías; no hay force-logout.

---

## 4. Logout

- **Componente:** `AccountView` (botón "cerrar sesión") → `handleLogout` (`AccountView.tsx:140-146`).
- **Función invocada:** llama a la prop `onLogout`, que en `App.tsx:239` hace `setIsLoggedIn(false)`.
- **`supabase.auth.signOut()`:** **NO se usa** en el Desktop (0 ocurrencias).
- **Sesión persistida:** **no se invalida.** El access/refresh token queda vivo en `localStorage`; solo se oculta la UI.
- **RECOMENDACIÓN para el Backoffice:** el logout debe invocar `await supabase.auth.signOut()`, que revoca la sesión y limpia el storage del navegador.

---

## 5. Modelo de usuario

### 5.1 Relación — HECHO

- `auth.users` (autenticación gestionada por Supabase) se relaciona con `public.users` por el campo **`id`**:
  `public.users.id = auth.uid() = user.id` (de `getUser()`).
- No hay un campo intermedio. La fila en `public.users` se crea/puebla de forma externa (manual o trigger en el proyecto Supabase). **No hay trigger en el repo local.**

### 5.2 Obtención del perfil — HECHO

- Flujo típico del Desktop: `supabase.auth.getUser()` → tomar `user.id` → `supabase.from("users").select("...").eq("id", user.id).maybeSingle()`.
- Usado en `HubView.tsx:77-81`, `AccountView.tsx:97-101`, `VueloActualView.tsx:627-631`.

### 5.3 Campos de `public.users` que el Desktop lee escribe

| Campo | Lectura | Escritura (AccountView) | Notas |
|---|---|---|---|
| `id` | Sí (`getUser().id`, `.eq("id", ...)`) | No | Relación con `auth.users` |
| `username` | Sí | Sí | |
| `avatar` | Sí | Sí | URL pública del bucket `avatars` |
| `email` | Sí (fallback a `user.email` de auth) | No | Expuesto vía Supabase |
| `preferred_language` | Sí | Sí | Idioma preferido |
| `simbrief_pilot_id` | Sí | Sí (parsea a número o null) | |
| `simbrief_units` | Sí | Sí | `"KGS"` / `"LBS"` |
| `subscription_tier` | Sí (solo lectura) | No implementada | default `"base"` |
| `subscription_enddate` | Sí (solo lectura) | No implementada | |
| `user_level` | Sí (solo lectura) | No implementada | default 1 |
| `user_xp` | Sí (solo lectura) | No implementada | default 0 |

> **Nota:** el `email` visible en la UI proviene de `user.email` (auth), no necesariamente de una columna propia en `public.users`.

### 5.4 No verificable

- Si `public.users` tiene columna `email` propia, se poblaría por mecanismo remoto (trigger), no verificable desde aquí.

---

## 6. Autorización

- **HECHO:** El Desktop tiene **solo autenticación**, **no autorización**.
- No usa `app_metadata`, `user_metadata`, claims, roles, perfiles administrativos ni permisos por `auth.user` (excepto `id`).
- `users.subscription_tier` y `user_level` existen como datos, pero el código **no los evalúa** para decidir acceso.
- La visibilidad del panel depende solo del estado visual `isLoggedIn`.
- **RECOMENDACIÓN:** el Backoffice no puede asumir un rol existente. Si necesita un rol "admin", habrá que crearlo de forma explícita (por ejemplo, columna en `public.users` o claims en `app_metadata`) en una etapa futura y consciente, **no** darlo por existente.

---

## 7. RLS y seguridad (auditoría desde el código local)

### 7.1 Tablas consultadas por el Desktop — HECHO

| Tabla | Acciones vistas | ¿Filtra por `user_id`/usuario? |
|---|---|---|
| `users` | select, update | Sí — `.eq("id", user.id)` |
| `setting_general` | select, upsert | Sí — `.eq("user_id", user.id)` / `onConflict: "user_id"` |
| `setting_announcements` | select, upsert | Sí — `.eq("user_id", user.id)` |
| `voices` | select | Sí — `.eq("user_id", userId)` + `voice_enabled=true` |
| `voices_stock` | select | No — catálogo consultado sin filtro por usuario |
| `languages` | select | No — catálogo |
| `flight_setting_announcements` | select, insert | Sí — relativo a un vuelo del usuario |
| `flights` | select, insert | Sí — `user_id` del vuelo |

### 7.2 Storage — HECHO

- Único bucket usado: **`avatars`** — `supabase.storage.from("avatars").upload(path, file, { upsert: true })` y `.getPublicUrl(path)` (`AccountView.tsx:158-169`).
- **Naming:** path = `${userId}-${timestamp}.${ext}` — incluye el id del usuario.

### 7.3 Patrones que sugieren RLS con `auth.uid()` — HECHO (inferencia)

- Los selects/upserts con filtro por `user_id`/`id = usuario autenticado` son coherentes con policies del tipo `auth.uid() = user_id`.
- Los catálogos (`languages`, `voices_stock`) se leen sin filtro por usuario (lectura pública).

### 7.4 Policies RLS reales — **NO VERIFICABLE DESDE EL CÓDIGO LOCAL**

- En el repo **no hay migraciones/policies SQL** (`supabase/migrations/` absent). Las policies viven en el proyecto Supabase remoto.
- Toda afirmación sobre RLS es **solo inferencia** por el patrón de consultas, no una verificación.
- **Importante para el Backoffice:** revisar las policies reales (Dashboard Supabase → Database → Policies) antes de asumir qué puede leer/escribir la anon key.

---

## 8. Contrato de autenticación del Backoffice

> Objetivo: `announs-backoffice`, SPA independiente que reutiliza el mismo proyecto Supabase.

El Backoffice **debe implementar**:

1. **Login Email/Password** → `supabase.auth.signInWithPassword({ email, password })`.
2. **Google OAuth** → `supabase.auth.signInWithOAuth({ provider: "google" })`.
3. **Recuperación de sesión al arranque** → `supabase.auth.getSession()` en el punto de entrada; si hay sesión persistida, restaurarla antes de renderizar contenido.
4. **Persistencia de sesión** → `persistSession: true` en el cliente (default) con storage en `localStorage`.
5. **Detección de cambios de autenticación** → suscribirse a `supabase.auth.onAuthStateChange((event, session) => ...)` para reflejar login/logout/refresh en tiempo real (evitando el estado visual congelado del Desktop).
6. **Logout real** → `await supabase.auth.signOut()` (revoca y limpia el storage).
7. **Protección de rutas/vistas** → guard que redirija a `LoginView` cuando no haya sesión válida (p. ej. `ProtectedRoute`).
8. **Carga del perfil `public.users`** → tras `getSession`/`getUser`, `select` de `public.users` por `id`.
9. **Manejo de errores** → capturar `{ error }` de los métodos de auth, mostrarlos; estados de loading en el login; no dejar la pantalla colgada.
10. **Estado de loading inicial** → mientras se determina la sesión (`isSessionLoading`), mostrar un splash/spinner y no destellar pantallas.

> Contrato mínimo: cuando la UI se muestre, la app ya debe saber si existe sesión o no.

---

## 9. Configuración necesaria

### 9.1 Variables de entorno (nuevo proyecto)

```dotenv
VITE_SUPABASE_URL=https://<mismo-proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<same anon key del Desktop>
```

> **No incluir valores secretos en este documento.** La anon key se toma del `.env` del Desktop o de las credenciales públicas del proyecto Supabase. NO es `service_role` ni se trata como secreto, pero debe guardarse como credencial de acceso.

### 9.2 Supabase Auth (mismo proyecto)

- **Providers requeridos:** `Email` (password) y `Google`.
- **Google:** las credenciales de OAuth (Client ID/Secret) se configuran en el dashboard de Supabase (Authentication → Sign In → Google). El Desktop ya las usa; se reutilizan.
- **Site URL:** debe apuntar al origen de la app (desarrollo: por ejemplo `http://localhost:3000` del Desktop).
- **Redirect URLs:** agregar la `redirect` de la nueva app del Backoffice (por desarrollo, el puerto del Backoffice Vite) **además** de la del Desktop; de lo contrario el OAuth fallará al volver.
- **Dos aplicaciones, mismo proyecto:** comparten `auth.users`, `public.users` y Storage. Las sesiones son **por origen** (localStorage por-origin): si el Backoffice corre en otro origin, tendrá sesiones independientes frente a las del Desktop.

### 9.3 NO VERIFICABLE

- La URL exacta de producción del Desktop y su Redirect URL configurada. Debe consultarse en el dashboard del proyecto.

---

## 10. Arquitectura recomendada

Propuesta minimalista para SPA React/Vite:

```
src/
  lib/supabase.ts            # createClient(url, anonKey) — igual que el Desktop (sin opciones extra innecesarias)
  context/AuthContext.tsx     # AuthProvider que:
                              #   - llama getSession() al montar
                              #   - se suscribe a onAuthStateChange
                              #   - expone { user, session, isSessionLoading, signInWithPassword,
                              #             signInWithGoogle, signOut, profile }
  hooks/useAuth.ts            # useAuth() — consume AuthContext
  services/userService.ts     # carga un `public.users` por id (perfil)
  components/auth/LoginView.tsx
  components/auth/ProtectedRoute.tsx
```

- No sobrearquitecturar: un único contexto global, un `useAuth` y una protección en las rutas o vista raíz.
- Si se usa `react-router`, `ProtectedRoute` envuelve las rutas internas; si no, una condición en el root alcanza.

---

## 11. Reglas que el Backoffice NO debe romper

1. **Nunca usar `service_role` en el frontend.** La anon key debe ser la única credencial del cliente; `service_role` solo en servidor/Edge Functions.
2. **No confiar en un estado visual del frontend como autorización** (por ejemplo `isLoggedIn` del Desktop es solo UI).
3. **No almacenar passwords** en localStorage, logs ni estado de React. Las credenciales solo se envían a Auth de Supabase.
4. **No exponer secretos:** `service_role`, el JWT secreto del proyecto, tokens de refresh y credenciales de Google no deben estar en el repositorio.
5. **La seguridad de los datos depende únicamente de RLS/policies** de Supabase; el frontend filtra la UI pero no define el borde de autorización.
6. **Ocultar una opción de UI no equivale a autorización.** Aun si se oculta un botón, el cliente puede llamar a la API; asegurar con policies el dataset.
7. **No asumir un rol admin existente:** si el Backoffice lo requiere, definir el rol/claims y sus policies en una etapa futura y consciente.

---

## 12. Hechos vs Recomendaciones (resumen)

### HECHO

- Cliente Supabase sin opciones → defaults de `persistSession`, `autoRefreshToken`, `detectSessionInUrl`.
- Solo `signInWithPassword` y `signInWithOAuth({ provider: "google" })`.
- `isLoggedIn` es un estado visual React; no sesión autorizada.
- No hay `onAuthStateChange`, no hay `getSession` al boot, no hay `signOut`.
- Perfil vía `public.users` por `id`, campos username/avatar/preferred_language/simbrief_*/subscription_*/user_level/user_xp.
- No hay roles ni permiso de aplicación; solo auth.
- RLS no está en el repo; solo inferencia por patrones de consulta.

### NO VERIFICABLE

- Policies RLS reales del proyecto Supabase.
- Configuración de Auth en el dashboard (Google activo, expiración).
- Site URL / Redirect URL de producción.
- Trigger remoto de creación de fila `public.users`.

### RECOMENDACIÓN

- Backoffice con `AuthProvider + useAuth + ProtectedRoute + LoginView`.
- `onAuthStateChange` + `getSession` al arrancar + `signOut` al cerrar.
- Cargar perfil de `public.users` tras autenticar.
- Revisar RLS y definir el rol admin de forma explícita en una etapa futura (no como feature existente en este documento).

---

## 13. Verificación de esta etapa

- El documento se basa en la implementación REAL verificada en el Desktop (secciones de código citadas).
- No se modificó ningún archivo funcional del Desktop.
- No se creó código del Backoffice (solo especificación).
- No se tocó `package.json`, Supabase, RLS ni Storage.
- `tsc --noEmit` previo del Desktop permanece OK (no se aplicó cambios de código en esta etapa).