# UI Spec — Rediseño vista FLY (Sandbox `/fly-v2`)

> Rama: `feature/redesign-fly-screen`
> Sandbox: `src/pages/FlyPageV2.tsx` (clon de `src/components/VueloActualView.tsx`)
> Ruta temporal: `/fly-v2` → `currentView === "vuelo-v2"` en `src/App.tsx`
> Ruta estable: `/fly` → `currentView === "vuelo"` — **NO TOCAR en producción**.
> Stack: React 19 + Tailwind CSS 4 + Vite.

---

## 1. Pega aquí la especificación completa del diseñador UX

<!-- TODO (diseñador): reemplazar este placeholder con la spec final -->
<!-- Sugerido: objetivos, usuarios, wireframes (links Figma), copy exacto ES/EN, estados, accesibilidad, responsive -->

### 1.1 Objetivos del rediseño
- (pendiente — pegar aquí)

### 1.2 Alcance / No-alcance
- ✅ Solo se rediseña `FlyPageV2` (`/fly-v2`).
- ❌ No alterar `VueloActualView` (`/fly` / `vuelo`) ni motores (FlightFSM, PassengerEngine, Scheduler, AnnouncementQueue).

### 1.3 Wireframes / Figma
- Link Figma desktop:
- Link Figma mobile:
- Assets exportados en: `src/assets/fly-v2/`

### 1.4 Copy (ES/EN) + claves i18n
| Clave `t("...")` | ES | EN |
|---|---|---|
| `fly_v2.*` | — | — |

### 1.5 Estados a diseñar
- [ ] Pre-embarque / sin plan SimBrief
- [ ] Embarque / pre-vuelo / rodaje
- [ ] En vuelo (crucero / descenso)
- [ ] Aterrizado + resumen XP/bonus
- [ ] Error / desconexión sim / sin sesión
- [ ] Loading / skeletons

### 1.6 Accesibilidad + Responsive
- Contraste WCAG AA, foco visible, `aria-*` en controles.
- Breakpoints Tailwind: `sm / md / lg / xl` — Sidebar colapsable.
- Teclado: tab order lógico, `Esc` cierra modales/slide-overs.

---

## 2. Mapeo técnico (para el dev)

| Spec UX | Componente actual | Destino V2 |
|---|---|---|
| Cabecera vuelo (código/origen/destino) | `VueloActualView` header | `FlyPageV2` → `components/fly-v2/FlyHeader.tsx` (nuevo) |
| Stepper fases | `components/flight/FlightStepper.tsx` | Reutilizar o clonar a `fly-v2/` |
| Mapa / telemetría | `RouteMapView`, `FlightTrackMap`, `FlightTelemetryChart` | Idem |
| Pasajeros | `PassengerStatusPanel`, `PasajeroSlideOver` | Idem |
| Anuncios | `LastAnnouncementBox`, `ManualStepControls` | Idem |

Reglas del sandbox:
1. Todo componente nuevo del rediseño vive en `src/components/fly-v2/*` o dentro de `FlyPageV2.tsx`.
2. No importar `FlyPageV2` desde la vista estable `vuelo`.
3. Mantener mismas props (`VueloActualViewProps`) para que el swap final sea 1 línea en `App.tsx`.
4. Protección auth: `vuelo-v2` exige `isLoggedIn` igual que `vuelo` (ver `App.tsx` + `Sidebar.tsx`).

---

## 3. Criterios de aceptación del rediseño

- [ ] `/fly-v2` compila con `npm run lint` (`tsc --noEmit`) sin errores.
- [ ] `/fly` (`vuelo`) sigue intacto: mismo layout, mismos motores, mismos tests.
- [ ] `FlyPageV2` pasa check visual desktop 1440px + mobile 390px.
- [ ] i18n ES/EN completo, sin strings hardcodeados.
- [ ] Eliminar ruta temporal o promover V2 a `/fly` solo con aprobación explícita.

---

## 4. Notas de enrutamiento (proyecto sin react-router)

Este repo **no usa `react-router` ni `src/components/Routes.tsx`**: la navegación es por estado
`currentView: "hub" | "vuelo" | "config"` en `src/App.tsx`.

Equivalencias para este sandbox:
- `/fly` original → `currentView === "vuelo"` (protegido por `isLoggedIn`).
- `/fly-v2` sandbox → `currentView === "vuelo-v2"` (misma protección, bloque temporal en `App.tsx`).

Si en el futuro se migra a `react-router`, registrar:
```tsx
<Route path="/fly" element={<ProtectedRoute><VueloActualView … /></ProtectedRoute>} />
<Route path="/fly-v2" element={<ProtectedRoute><FlyPageV2 … /></ProtectedRoute>} />
```
