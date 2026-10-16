# X-Plane 12 — Fase 0: Spike de validación (RREF, solo lectura)

> Alcance congelado para v1: **selección manual** del proveedor, **solo lectura**
> (RREF), reutilización exacta del evento `"telemetry"` y del tipo
> `TelemetrySnapshot`. Sin DREF (escritura). Sin autodetección.

## 1. Objetivo del spike

Validar, antes de escribir el proveedor definitivo, que:

1. El protocolo RREF (suscripción + respuesta) funciona contra la red local
   (`127.0.0.1:49000`) con los DataRefs de la tabla §3.
2. El formato binario asumido (`RREF\0` + `i32 freq` + `i32 id` + `400B dataref`;
   respuesta `RREF,` + registros `i32 id + f32 valor`, little-endian) es correcto.
3. Los DataRefs elegidos **existen** en el avión objetivo (un DataRef desconocido
   simplemente no responde: degradación a `None`, nunca error fatal).
4. Las conversiones de unidades (`m → ft`, `m/s → kt/fpm`) cuadran con lo que
   muestra la cabina de X-Plane.

## 2. Piezas del spike

| Pieza | Ruta | Descripción |
|---|---|---|
| Simulador sintético de X-Plane | `scripts/xplane_rref_spike.py` | Escucha en `127.0.0.1:49000`, acepta suscripciones RREF, responde valores guionizados (puerta → crucero 35000 ft) **desde un puerto efímero distinto** (como el X-Plane real, que responde desde su puerto de envío y no desde el 49000). Solo stdlib Python |
| Receptor real (Fase 1) | `src-tauri/src/xplane.rs` | Cliente RREF en hilo dedicado, `std::net::UdpSocket` bloqueante. Sin `tokio` |
| Contrato compartido | `src-tauri/src/telemetry.rs` | `TelemetrySnapshot` único para MSFS + X-Plane (mirror de `src/types/telemetry.ts`) |

## 3. Tabla de DataRefs → `TelemetrySnapshot` (congelada v1)

Frecuencias pedidas: posición 10 Hz, resto 1–4 Hz (mismo throttle de emisión
10 Hz que SimConnect).

| ID | DataRef | Frec. | Unidad XP → contrato |
|---|---|---|---|
| 1 | `sim/cockpit2/gauges/indicators/altitude_ft_pilot` | 10 | ft → `altitude` (ft) |
| 2 | `sim/flightmodel/position/groundspeed` | 10 | m/s → kt (`×1.94384`) → `groundspeed` |
| 3 | `sim/cockpit2/gauges/indicators/vvi_fpm_pilot` | 10 | fpm → `verticalSpeed` |
| 4 | `sim/flightmodel/position/magpsi` | 10 | deg → `heading` |
| 5 | `sim/flightmodel/position/latitude` | 10 | deg → `latitude` |
| 6 | `sim/flightmodel/position/longitude` | 10 | deg → `longitude` |
| 7 | `sim/cockpit2/gauges/indicators/airspeed_kts_pilot` | 4 | kt → `indicated_airspeed` |
| 8 | `sim/flightmodel/position/true_airspeed` | 4 | m/s → kt → `true_airspeed` |
| 9 | `sim/flightmodel/controls/parkbrake` | 4 | `!= 0` → `parkingBrake` |
| 10–13 | `sim/flightmodel/engine/ENGN_running[0..3]` | 2 | `> 0.5` → `engineRunning` + `engCombustion2..4` |
| 14 | `sim/aircraft/engine/acf_num_engines` | 1 | f64 → `numberOfEngines` (fallback: conteo de 10–13) |
| 15–16 | `sim/flightmodel2/misc/door_open_ratio[0..1]` | 2 | `max < 0.05` → `doorsClosed` (junto a 17) |
| 17 | `sim/flightmodel2/misc/canopy_open_ratio` | 2 | idem |
| 18–20 | `sim/flightmodel2/gear/on_ground[0..2]` | 4 | OR → `simOnGround` (combinado con 21, ver §4) |
| 21 | `sim/flightmodel/position/y_agl` | 4 | m → (solo lógica WOW, §4) |
| 22 | `sim/cockpit2/gauges/indicators/radio_altimeter_height_ft_pilot` | 4 | ft → `radioHeight` (`0` = fuera de rango, como MSFS) |
| 23 | `sim/aircraft/parts/acf_gear_deploy[0]` | 2 | `>= 0.5` → `gearDown` |
| 24–27 | `sim/cockpit2/switches/{taxi_light_on,landing_lights_on,strobe_lights_on,beacon_on}` | 2 | `!= 0` → luces |
| 28 | `sim/cockpit2/annunciators/fasten_seatbelt` | 2 | `!= 0` → `seatbeltOn` |
| 29–30 | `sim/time/{zulu_time_sec,local_time_sec}` | 1 | s → `zuluTime`/`localTime` |
| 31–33 | `sim/weather/{temperature_ambient_c,wind_speed_kt,wind_direction_degt}` | 1 | directo → clima |

Explícitamente `None` en v1 (sin equivalente fiable): `atcOnParkingSpot`
(el detector usa su rama legacy, ya probada por el Mock), `atcClearedTakeoff`,
`onAnyRunway`, `planeInParkingState`, `pushbackActive`, `simPhase`,
`remainingTime`, `nextWaypoint`, `pitch`, `bank`, `timeOfDay`.

## 4. Reglas de degradación (contrato)

- DataRef desconocido / sin respuesta → campo `None` (`undefined` en TS).
  **Nunca** `false`/`0` por defecto en opcionales: el detector distingue
  "desconocido" de "medido falso" (rama `hasAdvancedGroundData`).
- `simOnGround` = `OR(on_ground[0..2]) AND y_agl < 3 m`; si falta un grupo se usa
  el otro (`WOW` solo, o `y_agl < 1 m`); si faltan ambos → `None`.
- Básicos (`altitude`, `groundspeed`, …) sin datos aún → `0.0`; además
  `xplane_poll` responde `Err("…sin datos aún")` hasta el primer paquete válido,
  igual que `simconnect_poll`.

## 5. Cómo correr el spike

### 5a. Contra el simulador sintético (sin X-Plane instalado)

```powershell
# Terminal 1: falso X-Plane (escucha 127.0.0.1:49000, guion puerta→crucero)
python scripts/xplane_rref_spike.py --serve

# Terminal 2: app con el proveedor X-Plane (default ON vía feature xplane-udp)
npx tauri dev
# En DevTools Console:
#   await __TAURI__.core.invoke('xplane_connect', { options: null })
#   await __TAURI__.core.listen('telemetry', e => console.log(e.payload.altitude))
#   await __TAURI__.core.invoke('xplane_poll')
#   await __TAURI__.core.invoke('xplane_disconnect')
```

El script imprime cada suscripción RREF recibida: sirve para verificar que el
backend pide exactamente la tabla §3 (ID, frecuencia, DataRef).

### 5b. Contra X-Plane 12 real

1. X-Plane → Settings → Network → aceptar conexiones en `49000` (default).
2. Cargar un avión objetivo (repetir en 2–3 aviones: p.ej. Laminar 737, Zibo,
   ToLiss) y anotar qué IDs responden (los que no responden → `None`).
3. Mismo `xplane_connect` que en §5a; comparar `altitude/groundspeed/VS` con la
   cabina; verificar transiciones GATE → BOARDING → PRE_FLIGHT con
   freno/puertas/motores reales.
4. Apagar X-Plane a mitad de sesión: el frontend debe marcar stale (watchdog
   existente) y `xplane_disconnect` debe liberar el puerto sin colgar.

## 6. Criterios de aceptación Fase 0

- [ ] El script recibe las 33 suscripciones con IDs/frecuencias de §3.
- [ ] `xplane_poll` devuelve snapshot con `altitude ≈ 35000`, `groundspeed ≈ 450`
      bajo el simulador sintético.
- [ ] Evento `"telemetry"` visible en DevTools a ~10 Hz con la misma forma que
      el de MSFS (mismas claves camelCase).
- [ ] En avión real: puertas/freno/motores cambian `doorsClosed/parkingBrake/
      engineRunning`; `simOnGround` true en plataforma, false tras despegar.
- [ ] DataRefs inexistentes en un avión degradan a `None` sin romper el hilo.
- [ ] `cargo test -p app_lib xplane` en verde (parseo, conversiones, snapshot).
