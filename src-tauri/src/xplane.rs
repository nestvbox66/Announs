//! Puente Tauri ↔ X-Plane 12 por UDP (RREF, solo lectura).
//!
//! X-Plane expone telemetría en la red local (default `127.0.0.1:49000`).
//! Este módulo actúa como cliente RREF: abre su propio socket UDP, envía
//! suscripciones (`RREF\0 + freq + id + dataref`) y agrega las respuestas
//! (`RREF, + (id, valor)*`) en un `TelemetrySnapshot` compartido
//! (`crate::telemetry`, el mismo que MSFS) que se emite bajo el mismo evento
//! `"telemetry"` a ~10 Hz.
//!
//! Diseño espejo de `simconnect.rs`: `UdpSocket` bloqueante en hilo dedicado
//! (sin `tokio`), estado `SharedState { running, latest, handle }`, handshake
//! `mpsc + recv_timeout(5s)` en `connect()`, y degradación a `None` ante
//! DataRefs desconocidos (un avión puede no exponerlos: nunca es fatal).
//!
//! Alcance v1: solo lectura. Sin DREF (escritura). Tabla de DataRefs en
//! `docs/xplane-phase0-spike.md §3`.

use serde::Deserialize;

use crate::telemetry::TelemetrySnapshot;

// ── Opciones de conexión ────────────────────────────────────────────────

pub const XPLANE_DEFAULT_HOST: &str = "127.0.0.1";
pub const XPLANE_DEFAULT_RX_PORT: u16 = 49000;
pub const XPLANE_DEFAULT_LOCAL_PORT: u16 = 49005;

/// Throttle de emisión, igual que SimConnect (~10 Hz).
pub const EMIT_THROTTLE_MS: u64 = 100;

#[derive(Debug, Clone, Deserialize)]
pub struct XPlaneConnectOptions {
    pub host: Option<String>,
    pub rx_port: Option<u16>,
    pub local_port: Option<u16>,
}

impl Default for XPlaneConnectOptions {
    fn default() -> Self {
        Self {
            host: None,
            rx_port: None,
            local_port: None,
        }
    }
}

impl XPlaneConnectOptions {
    fn host(&self) -> String {
        self.host.clone().unwrap_or_else(|| XPLANE_DEFAULT_HOST.into())
    }
    fn rx_port(&self) -> u16 {
        self.rx_port.unwrap_or(XPLANE_DEFAULT_RX_PORT)
    }
    fn local_port(&self) -> u16 {
        self.local_port.unwrap_or(XPLANE_DEFAULT_LOCAL_PORT)
    }
    fn target(&self) -> String {
        format!("{}:{}", self.host(), self.rx_port())
    }
}

// ── Tabla de suscripciones RREF (ID, DataRef, frecuencia Hz) ────────────
// IDs estables: el hilo agrega valores por ID y `to_snapshot()` los mapea.
// Ver docs/xplane-phase0-spike.md §3 para unidades y degradación.

struct Sub {
    id: i32,
    dataref: &'static str,
    freq: i32,
}

const SUBSCRIPTIONS: &[Sub] = &[
    Sub { id: 1, dataref: "sim/cockpit2/gauges/indicators/altitude_ft_pilot", freq: 10 },
    Sub { id: 2, dataref: "sim/flightmodel/position/groundspeed", freq: 10 },
    Sub { id: 3, dataref: "sim/cockpit2/gauges/indicators/vvi_fpm_pilot", freq: 10 },
    Sub { id: 4, dataref: "sim/flightmodel/position/magpsi", freq: 10 },
    Sub { id: 5, dataref: "sim/flightmodel/position/latitude", freq: 10 },
    Sub { id: 6, dataref: "sim/flightmodel/position/longitude", freq: 10 },
    Sub { id: 7, dataref: "sim/cockpit2/gauges/indicators/airspeed_kts_pilot", freq: 4 },
    Sub { id: 8, dataref: "sim/flightmodel/position/true_airspeed", freq: 4 },
    Sub { id: 9, dataref: "sim/flightmodel/controls/parkbrake", freq: 4 },
    Sub { id: 10, dataref: "sim/flightmodel/engine/ENGN_running[0]", freq: 2 },
    Sub { id: 11, dataref: "sim/flightmodel/engine/ENGN_running[1]", freq: 2 },
    Sub { id: 12, dataref: "sim/flightmodel/engine/ENGN_running[2]", freq: 2 },
    Sub { id: 13, dataref: "sim/flightmodel/engine/ENGN_running[3]", freq: 2 },
    Sub { id: 14, dataref: "sim/aircraft/engine/acf_num_engines", freq: 1 },
    Sub { id: 15, dataref: "sim/flightmodel2/misc/door_open_ratio[0]", freq: 2 },
    Sub { id: 16, dataref: "sim/flightmodel2/misc/door_open_ratio[1]", freq: 2 },
    Sub { id: 17, dataref: "sim/flightmodel2/misc/canopy_open_ratio", freq: 2 },
    Sub { id: 18, dataref: "sim/flightmodel2/gear/on_ground[0]", freq: 4 },
    Sub { id: 19, dataref: "sim/flightmodel2/gear/on_ground[1]", freq: 4 },
    Sub { id: 20, dataref: "sim/flightmodel2/gear/on_ground[2]", freq: 4 },
    Sub { id: 21, dataref: "sim/flightmodel/position/y_agl", freq: 4 },
    Sub { id: 22, dataref: "sim/cockpit2/gauges/indicators/radio_altimeter_height_ft_pilot", freq: 4 },
    Sub { id: 23, dataref: "sim/aircraft/parts/acf_gear_deploy[0]", freq: 2 },
    Sub { id: 24, dataref: "sim/cockpit2/switches/taxi_light_on", freq: 2 },
    Sub { id: 25, dataref: "sim/cockpit2/switches/landing_lights_on", freq: 2 },
    Sub { id: 26, dataref: "sim/cockpit2/switches/strobe_lights_on", freq: 2 },
    Sub { id: 27, dataref: "sim/cockpit2/switches/beacon_on", freq: 2 },
    Sub { id: 28, dataref: "sim/cockpit2/annunciators/fasten_seatbelt", freq: 2 },
    Sub { id: 29, dataref: "sim/time/zulu_time_sec", freq: 1 },
    Sub { id: 30, dataref: "sim/time/local_time_sec", freq: 1 },
    Sub { id: 31, dataref: "sim/weather/temperature_ambient_c", freq: 1 },
    Sub { id: 32, dataref: "sim/weather/wind_speed_kt", freq: 1 },
    Sub { id: 33, dataref: "sim/weather/wind_direction_degt", freq: 1 },
];

// ── Conversiones de unidades X-Plane → contrato ─────────────────────────

const MS_TO_KT: f64 = 1.943844;
const MS_TO_FPM: f64 = 196.850394;
/// Umbral AGL (m) para combinar con el tren en `simOnGround` (ver §4 del doc).
const WOW_AGL_BLEND_M: f64 = 3.0;
const WOW_AGL_FALLBACK_M: f64 = 1.0;

// ── Protocolo RREF ─────────────────────────────────────────────────────

/// Construye un paquete de suscripción: `RREF\0 + i32 freq + i32 id + 400B`.
/// `freq = 0` cancela la suscripción (unsubscribe al desconectar).
pub(crate) fn build_rref_request(id: i32, freq: i32, dataref: &str) -> Vec<u8> {
    let mut buf = vec![0u8; 5 + 4 + 4 + 400];
    buf[0..4].copy_from_slice(b"RREF");
    buf[4] = 0;
    buf[5..9].copy_from_slice(&freq.to_le_bytes());
    buf[9..13].copy_from_slice(&id.to_le_bytes());
    let bytes = dataref.as_bytes();
    let n = bytes.len().min(400);
    buf[13..13 + n].copy_from_slice(&bytes[..n]);
    buf
}

/// Parsea una respuesta: `RREF,` (o `RREF\0`) + registros `i32 id + f32 valor`.
/// Los paquetes malformados devuelven lista vacía (nunca es fatal: UDP).
pub(crate) fn parse_rref_response(packet: &[u8]) -> Vec<(i32, f32)> {
    if packet.len() < 5 || &packet[0..4] != b"RREF" {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut off = 5;
    while off + 8 <= packet.len() {
        let id = i32::from_le_bytes([
            packet[off],
            packet[off + 1],
            packet[off + 2],
            packet[off + 3],
        ]);
        let value = f32::from_le_bytes([
            packet[off + 4],
            packet[off + 5],
            packet[off + 6],
            packet[off + 7],
        ]);
        out.push((id, value));
        off += 8;
    }
    out
}

// ── Agregación cruda → snapshot ──────────────────────────────────────────

#[derive(Debug, Default)]
struct RawValues {
    map: std::collections::HashMap<i32, f32>,
}

impl RawValues {
    fn get(&self, id: i32) -> Option<f32> {
        self.map.get(&id).copied()
    }

    fn to_snapshot(&self) -> TelemetrySnapshot {
        let f = |id: i32, default: f64| self.get(id).map(|v| v as f64).unwrap_or(default);
        let opt = |id: i32| self.get(id).map(|v| v as f64);
        let flag = |id: i32| self.get(id).map(|v| v != 0.0);

        // Motores: combustión por índice + número (directo o conteo).
        let running: Vec<bool> = [10, 11, 12, 13]
            .iter()
            .map(|id| self.get(*id).map(|v| v > 0.5).unwrap_or(false))
            .collect();
        let any_engine_known = [10, 11, 12, 13].iter().any(|id| self.get(*id).is_some());
        let number_of_engines = match opt(14) {
            Some(n) => Some(n),
            None if any_engine_known => {
                Some(running.iter().filter(|b| **b).count() as f64)
            }
            None => None,
        };

        // Puertas: cerradas si TODAS las ratios conocidas están ≈ 0.
        let door_ratios: Vec<f32> = [15, 16, 17].iter().filter_map(|id| self.get(*id)).collect();
        let doors_closed = if door_ratios.is_empty() {
            None
        } else {
            Some(door_ratios.iter().all(|r| *r < 0.05))
        };

        // Tren en tierra: OR de las patas, combinado con AGL (ver doc §4).
        let wow_any: Option<bool> = {
            let known: Vec<bool> =
                [18, 19, 20].iter().filter_map(|id| self.get(*id).map(|v| v > 0.5)).collect();
            if known.is_empty() {
                None
            } else {
                Some(known.iter().any(|b| *b))
            }
        };
        let y_agl_m: Option<f64> = opt(21);
        let sim_on_ground = match (wow_any, y_agl_m) {
            (Some(w), Some(y)) => Some(w && y < WOW_AGL_BLEND_M),
            (Some(w), None) => Some(w),
            (None, Some(y)) => Some(y < WOW_AGL_FALLBACK_M),
            (None, None) => None,
        };

        TelemetrySnapshot {
            altitude: f(1, 0.0),
            groundspeed: self.get(2).map(|v| v as f64 * MS_TO_KT).unwrap_or(0.0),
            vertical_speed: f(3, 0.0),
            heading: f(4, 0.0).rem_euclid(360.0),
            latitude: f(5, 0.0),
            longitude: f(6, 0.0),
            indicated_airspeed: opt(7),
            true_airspeed: self.get(8).map(|v| v as f64 * MS_TO_KT),
            pitch: None,
            bank: None,
            engine_running: if any_engine_known { Some(running[0]) } else { None },
            number_of_engines,
            eng_combustion2: if self.get(11).is_some() { Some(running[1]) } else { None },
            eng_combustion3: if self.get(12).is_some() { Some(running[2]) } else { None },
            eng_combustion4: if self.get(13).is_some() { Some(running[3]) } else { None },
            parking_brake: flag(9),
            doors_closed,
            seatbelt_on: flag(28),
            // Sin equivalente fiable en X-Plane (doc §3): None a propósito para
            // que el detector use su rama legacy (probada por el Mock).
            atc_on_parking_spot: None,
            atc_cleared_takeoff: None,
            on_any_runway: None,
            sim_on_ground,
            plane_in_parking_state: None,
            pushback_active: None,
            sim_phase: None,
            zulu_time: opt(29),
            local_time: opt(30),
            remaining_time: None,
            temperature: opt(31),
            wind_speed: opt(32),
            wind_direction: opt(33),
            next_waypoint: None,
            radio_height: opt(22),
            gear_down: self.get(23).map(|v| v >= 0.5),
            taxi_lights_on: flag(24),
            landing_lights_on: flag(25),
            strobe_lights_on: flag(26),
            beacon_lights_on: flag(27),
            time_of_day: None,
        }
    }
}

// Conversión directa m/s → fpm (para tests y futura VH en m/s).
#[allow(dead_code)]
fn ms_to_fpm(ms: f64) -> f64 {
    ms * MS_TO_FPM
}

// ── Implementación real (feature "xplane-udp") ──────────────────────────

#[cfg(feature = "xplane-udp")]
mod imp {
    use super::*;
    use std::net::UdpSocket;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread::{self, JoinHandle};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};

    struct SharedState {
        running: Arc<AtomicBool>,
        latest: Arc<Mutex<Option<TelemetrySnapshot>>>,
        handle: Option<JoinHandle<()>>,
    }

    static STATE: Mutex<Option<SharedState>> = Mutex::new(None);

    fn send_subscriptions(
        sock: &UdpSocket,
        target: &str,
        freq_override: Option<i32>,
    ) -> Result<(), String> {
        for sub in SUBSCRIPTIONS {
            let freq = freq_override.unwrap_or(sub.freq);
            let packet = build_rref_request(sub.id, freq, sub.dataref);
            sock.send_to(&packet, target)
                .map_err(|e| format!("RREF {} (id={}): {}", sub.dataref, sub.id, e))?;
        }
        Ok(())
    }

    pub fn connect(app: AppHandle, options: XPlaneConnectOptions) -> Result<(), String> {
        {
            let guard = STATE.lock().map_err(|e| e.to_string())?;
            if let Some(s) = guard.as_ref() {
                if s.running.load(Ordering::SeqCst) {
                    log::info!("[xplane] Ya conectado");
                    return Ok(());
                }
            }
        }

        let running = Arc::new(AtomicBool::new(true));
        let latest = Arc::new(Mutex::new(None::<TelemetrySnapshot>));
        let (tx, rx) = mpsc::channel::<Result<(), String>>();

        let thread_running = running.clone();
        let thread_latest = latest.clone();
        let handle = thread::spawn(move || {
            xplane_loop(app, options, thread_running, thread_latest, tx);
        });

        {
            let state_running = running.clone();
            let state_latest = latest.clone();
            let mut guard = STATE.lock().map_err(|e| e.to_string())?;
            if let Some(s) = guard.as_mut() {
                s.running = state_running;
                s.latest = state_latest;
                s.handle = Some(handle);
            } else {
                *guard = Some(SharedState {
                    running: state_running,
                    latest: state_latest,
                    handle: Some(handle),
                });
            }
        }

        // Esperar el primer paquete válido (hasta 5s, como SimConnect).
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {
                log::info!("✅ X-Plane conectado y suscrito (RREF)");
                Ok(())
            }
            Ok(Err(e)) => {
                running.store(false, Ordering::SeqCst);
                Err(e)
            }
            Err(_) => {
                running.store(false, Ordering::SeqCst);
                Err("Timeout conectando a X-Plane (¿corre en 127.0.0.1:49000?)".into())
            }
        }
    }

    fn xplane_loop(
        app: AppHandle,
        options: XPlaneConnectOptions,
        running: Arc<AtomicBool>,
        latest: Arc<Mutex<Option<TelemetrySnapshot>>>,
        tx: mpsc::Sender<Result<(), String>>,
    ) {
        let target = options.target();
        let bind_addr = format!("0.0.0.0:{}", options.local_port());
        let sock = match UdpSocket::bind(&bind_addr) {
            Ok(s) => s,
            Err(e) => {
                let _ = tx.send(Err(format!(
                    "No se pudo abrir UDP local {}: {}",
                    bind_addr, e
                )));
                return;
            }
        };
        if let Err(e) = sock.set_read_timeout(Some(Duration::from_millis(500))) {
            let _ = tx.send(Err(format!("UDP set_read_timeout: {}", e)));
            return;
        }
        // OJO: el socket queda INTENCIONADAMENTE sin `connect()`. X-Plane
        // origina sus respuestas RREF desde su puerto de envío (legacy 49001),
        // distinto del puerto de escucha (legacy 49000) al que enviamos los
        // pedidos. Un socket "conectado" haría que el SO descartara esas
        // respuestas (origen inesperado) y el handshake expirararía aunque
        // X-Plane esté respondiendo. Con `send_to`/`recv_from` se acepta
        // respuesta de cualquier origen local y se registra (ver `peer`).
        if let Err(e) = send_subscriptions(&sock, &target, None) {
            let _ = tx.send(Err(format!("Suscripción RREF: {}", e)));
            return;
        }
        log::info!(
            "[xplane] {} suscripciones RREF enviadas a {}",
            SUBSCRIPTIONS.len(),
            target
        );

        let mut raw = RawValues::default();
        let mut handshake_done = false;
        let mut peer_logged: Option<std::net::SocketAddr> = None;
        let mut last_emit = Instant::now();
        let mut packet_count: u64 = 0;
        let mut emit_count: u64 = 0;
        let mut consec_errors: u64 = 0;
        let mut buf = [0u8; 2048];

        while running.load(Ordering::SeqCst) {
            match sock.recv_from(&mut buf) {
                Ok((n, src)) => {
                    consec_errors = 0;
                    // Origen real de las respuestas (diagnóstico: suele diferir
                    // del puerto de escucha de X-Plane; ver nota sobre `connect`).
                    if peer_logged != Some(src) {
                        peer_logged = Some(src);
                        println!("[xplane] 📥 respuestas desde {src} (pedidos → {target})");
                        log::info!("[xplane] respuestas desde {} (pedidos → {})", src, target);
                    }
                    let records = parse_rref_response(&buf[..n]);
                    if records.is_empty() {
                        continue;
                    }
                    packet_count += 1;
                    for (id, value) in records {
                        raw.map.insert(id, value);
                    }
                    if !handshake_done {
                        handshake_done = true;
                        let _ = tx.send(Ok(()));
                    }
                    let snap = raw.to_snapshot();
                    if let Ok(mut g) = latest.lock() {
                        *g = Some(snap.clone());
                    }
                    if last_emit.elapsed() >= Duration::from_millis(EMIT_THROTTLE_MS) {
                        emit_count += 1;
                        if emit_count % 100 == 1 {
                            println!(
                                "[xplane] 📡 emit #{emit_count} (pkts={packet_count}) alt={:.1} gs={:.1} wow={:?} brake={:?} doors={:?}",
                                snap.altitude,
                                snap.groundspeed,
                                snap.sim_on_ground,
                                snap.parking_brake,
                                snap.doors_closed
                            );
                            log::info!(
                                "[xplane] 📡 emit #{} alt={:.1} gs={:.1}",
                                emit_count,
                                snap.altitude,
                                snap.groundspeed
                            );
                        }
                        let _ = app.emit("telemetry", &snap);
                        last_emit = Instant::now();
                    }
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    // Sin paquetes en 500ms: X-Plane callado o cerrado.
                    // No se rompe el bucle; el watchdog del frontend marca stale.
                    continue;
                }
                Err(e) => {
                    consec_errors += 1;
                    if consec_errors == 1 || consec_errors % 60 == 0 {
                        println!("[xplane] ❌ recv UDP (x{consec_errors}): {e:?}");
                        log::error!("[xplane] recv UDP (x{}): {:?}", consec_errors, e);
                    }
                    continue;
                }
            }
        }

        // Baja ordenada: cancelar suscripciones (best-effort) antes de salir.
        let _ = send_subscriptions(&sock, &target, Some(0));
        println!(
            "[xplane] Hilo de recepción finalizado (pkts={packet_count}, emits={emit_count})"
        );
        log::info!("[xplane] Hilo de recepción finalizado");
    }

    pub fn disconnect() -> Result<(), String> {
        let handle = {
            let mut guard = STATE.lock().map_err(|e| e.to_string())?;
            match guard.as_mut() {
                Some(s) => {
                    s.running.store(false, Ordering::SeqCst);
                    s.handle.take()
                }
                None => None,
            }
        };
        if let Some(h) = handle {
            let _ = h.join();
        }
        log::info!("[xplane] X-Plane desconectado");
        Ok(())
    }

    pub fn latest() -> Result<TelemetrySnapshot, String> {
        let snapshot;
        {
            let guard = STATE.lock().map_err(|e| e.to_string())?;
            let s = guard
                .as_ref()
                .ok_or_else(|| "X-Plane no conectado".to_string())?;
            let inner = s.latest.lock().map_err(|e| e.to_string())?;
            snapshot = inner.clone();
        }
        snapshot.ok_or_else(|| "X-Plane sin datos aún".to_string())
    }

    pub fn emit(app: &AppHandle) -> Result<TelemetrySnapshot, String> {
        let snap = latest()?;
        let _ = app.emit("telemetry", &snap);
        Ok(snap)
    }
}

// ── Stub (sin feature "xplane-udp") ─────────────────────────────────────

#[cfg(not(feature = "xplane-udp"))]
mod imp {
    use super::XPlaneConnectOptions;
    use crate::telemetry::TelemetrySnapshot;

    const DISABLED: &str = "X-Plane desactivado en esta compilación (feature xplane-udp)";

    pub fn connect(_app: tauri::AppHandle, _options: XPlaneConnectOptions) -> Result<(), String> {
        Err(DISABLED.into())
    }

    pub fn disconnect() -> Result<(), String> {
        Err(DISABLED.into())
    }

    pub fn latest() -> Result<TelemetrySnapshot, String> {
        Err(DISABLED.into())
    }

    pub fn emit(_app: &tauri::AppHandle) -> Result<TelemetrySnapshot, String> {
        Err(DISABLED.into())
    }
}

// ── Comandos Tauri ──────────────────────────────────────────────────────

#[tauri::command]
pub fn xplane_connect(
    app: tauri::AppHandle,
    options: Option<XPlaneConnectOptions>,
) -> Result<String, String> {
    println!("[xplane] 🔍 xplane_connect llamado");
    match imp::connect(app, options.unwrap_or_default()) {
        Ok(_) => {
            println!("[xplane] ✅ Conexión exitosa");
            Ok("connected".to_string())
        }
        Err(e) => {
            println!("[xplane] ❌ Error de conexión: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn xplane_disconnect() -> Result<(), String> {
    imp::disconnect()
}

/// Suscripción de DataRefs: en la implementación real las suscripciones se
/// envían al conectar, por lo que este comando es no-op por compatibilidad
/// con el futuro `XPlaneFlightController` (espejo de `simconnect_subscribe`).
#[tauri::command]
pub fn xplane_subscribe(_vars: Vec<String>) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn xplane_poll() -> Result<TelemetrySnapshot, String> {
    imp::latest()
}

#[tauri::command]
pub fn xplane_emit_telemetry(app: tauri::AppHandle) -> Result<TelemetrySnapshot, String> {
    imp::emit(&app)
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_raw() -> RawValues {
        let mut raw = RawValues::default();
        // Crucero: 35000 ft, 450 kt, motores 1-2, puertas cerradas, en aire.
        raw.map.insert(1, 35000.0);
        raw.map.insert(2, 450.0 / MS_TO_KT as f32);
        raw.map.insert(3, 0.0);
        raw.map.insert(4, 180.0);
        raw.map.insert(5, -34.8);
        raw.map.insert(6, -58.5);
        raw.map.insert(7, 280.0);
        raw.map.insert(8, 480.0 / MS_TO_KT as f32);
        raw.map.insert(9, 0.0);
        raw.map.insert(10, 1.0);
        raw.map.insert(11, 1.0);
        raw.map.insert(14, 2.0);
        raw.map.insert(15, 0.0);
        raw.map.insert(16, 0.0);
        raw.map.insert(17, 0.0);
        raw.map.insert(18, 0.0);
        raw.map.insert(19, 0.0);
        raw.map.insert(20, 0.0);
        raw.map.insert(21, 10668.0);
        raw.map.insert(22, 0.0);
        raw.map.insert(23, 0.0);
        raw.map.insert(27, 1.0);
        raw.map.insert(29, 43200.0);
        raw
    }

    #[test]
    fn rref_request_shape() {
        let packet = build_rref_request(7, 4, "sim/test/dataref");
        assert_eq!(packet.len(), 413);
        assert_eq!(&packet[0..4], b"RREF");
        assert_eq!(packet[4], 0);
        assert_eq!(i32::from_le_bytes(packet[5..9].try_into().unwrap()), 4);
        assert_eq!(i32::from_le_bytes(packet[9..13].try_into().unwrap()), 7);
        assert_eq!(&packet[13..13 + 16], b"sim/test/dataref");
        assert!(packet[13 + 16..].iter().all(|b| *b == 0));
    }

    #[test]
    fn rref_unsubscribe_is_freq_zero() {
        let packet = build_rref_request(3, 0, "sim/a");
        assert_eq!(i32::from_le_bytes(packet[5..9].try_into().unwrap()), 0);
    }

    #[test]
    fn rref_response_roundtrip() {
        let mut buf = Vec::from(b"RREF,".as_slice());
        buf.extend_from_slice(&42i32.to_le_bytes());
        buf.extend_from_slice(&123.5f32.to_le_bytes());
        buf.extend_from_slice(&7i32.to_le_bytes());
        buf.extend_from_slice(&(-50.0f32).to_le_bytes());
        let records = parse_rref_response(&buf);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].0, 42);
        assert!((records[0].1 - 123.5).abs() < f32::EPSILON);
        assert_eq!(records[1].0, 7);
    }

    #[test]
    fn rref_response_rejects_garbage() {
        assert!(parse_rref_response(&[]).is_empty());
        assert!(parse_rref_response(b"DATA*....").is_empty());
        assert!(parse_rref_response(b"RREF").is_empty());
    }

    #[test]
    fn snapshot_cruise_mapping() {
        let snap = sample_raw().to_snapshot();
        assert!((snap.altitude - 35000.0).abs() < 1.0);
        assert!((snap.groundspeed - 450.0).abs() < 0.5);
        assert!((snap.true_airspeed.unwrap() - 480.0).abs() < 0.5);
        assert_eq!(snap.heading, 180.0);
        assert_eq!(snap.engine_running, Some(true));
        assert_eq!(snap.number_of_engines, Some(2.0));
        assert_eq!(snap.eng_combustion2, Some(true));
        assert_eq!(snap.doors_closed, Some(true));
        assert_eq!(snap.sim_on_ground, Some(false));
        assert_eq!(snap.parking_brake, Some(false));
        assert_eq!(snap.beacon_lights_on, Some(true));
        assert_eq!(snap.zulu_time, Some(43200.0));
        // Sin equivalente en v1 → None a propósito.
        assert_eq!(snap.atc_on_parking_spot, None);
        assert_eq!(snap.time_of_day, None);
    }

    #[test]
    fn snapshot_gate_mapping() {
        let mut raw = RawValues::default();
        raw.map.insert(1, 150.0);
        raw.map.insert(2, 0.0);
        raw.map.insert(9, 1.0);
        raw.map.insert(10, 0.0);
        raw.map.insert(15, 1.0);
        raw.map.insert(18, 1.0);
        raw.map.insert(19, 1.0);
        raw.map.insert(20, 1.0);
        raw.map.insert(21, 0.5);
        let snap = raw.to_snapshot();
        assert_eq!(snap.sim_on_ground, Some(true));
        assert_eq!(snap.parking_brake, Some(true));
        assert_eq!(snap.doors_closed, Some(false));
        assert_eq!(snap.engine_running, Some(false));
        // Sin num_engines ni más flags: conteo 0, resto None.
        assert_eq!(snap.number_of_engines, Some(0.0));
        assert_eq!(snap.atc_on_parking_spot, None);
    }

    #[test]
    fn snapshot_empty_is_all_unknown() {
        let snap = RawValues::default().to_snapshot();
        assert_eq!(snap.altitude, 0.0);
        assert_eq!(snap.sim_on_ground, None);
        assert_eq!(snap.doors_closed, None);
        assert_eq!(snap.engine_running, None);
    }
}
