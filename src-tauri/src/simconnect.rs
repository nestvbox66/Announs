//! Puente Tauri ↔ MSFS SimConnect (Fase 3, implementación real)
//!
//! `simconnect-sdk` es `!Send`/`!Sync`, por lo que la conexión vive en un
//! hilo dedicado que recibe notificaciones (get_next_dispatch) y emite
//! `TelemetrySnapshot` como evento `telemetry` a 10Hz (throttle de 100ms).
//!
//! Si la feature `simconnect` NO está habilitada, se usa un stub sintético
//! con la misma interfaz (para compilar/desarrollar sin el SDK de MSFS).

use serde::{Deserialize, Serialize};

// ── TelemetrySnapshot (Rust mirror de src/types/telemetry.ts) ───────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetrySnapshot {
    pub altitude: f64,
    pub groundspeed: f64,
    #[serde(rename = "verticalSpeed")]
    pub vertical_speed: f64,
    pub heading: f64,
    pub latitude: f64,
    pub longitude: f64,
    pub indicated_airspeed: Option<f64>,
    pub true_airspeed: Option<f64>,
    pub pitch: Option<f64>,
    pub bank: Option<f64>,
    #[serde(rename = "engineRunning")]
    pub engine_running: Option<bool>,
    #[serde(rename = "numberOfEngines")]
    pub number_of_engines: Option<f64>,
    #[serde(rename = "engCombustion2")]
    pub eng_combustion2: Option<bool>,
    #[serde(rename = "engCombustion3")]
    pub eng_combustion3: Option<bool>,
    #[serde(rename = "engCombustion4")]
    pub eng_combustion4: Option<bool>,
    #[serde(rename = "parkingBrake")]
    pub parking_brake: Option<bool>,
    #[serde(rename = "doorsClosed")]
    pub doors_closed: Option<bool>,
    #[serde(rename = "seatbeltOn")]
    pub seatbelt_on: Option<bool>,
    #[serde(rename = "atcOnParkingSpot")]
    pub atc_on_parking_spot: Option<bool>,
    #[serde(rename = "atcClearedTakeoff")]
    pub atc_cleared_takeoff: Option<bool>,
    #[serde(rename = "onAnyRunway")]
    pub on_any_runway: Option<bool>,
    #[serde(rename = "simOnGround")]
    pub sim_on_ground: Option<bool>,
    #[serde(rename = "planeInParkingState")]
    pub plane_in_parking_state: Option<bool>,
    #[serde(rename = "pushbackActive")]
    pub pushback_active: Option<bool>,
    #[serde(rename = "simPhase")]
    pub sim_phase: Option<u32>,
    #[serde(rename = "zuluTime")]
    pub zulu_time: Option<f64>,
    #[serde(rename = "localTime")]
    pub local_time: Option<f64>,
    #[serde(rename = "remainingTime")]
    pub remaining_time: Option<f64>,
    pub temperature: Option<f64>,
    #[serde(rename = "windSpeed")]
    pub wind_speed: Option<f64>,
    #[serde(rename = "windDirection")]
    pub wind_direction: Option<f64>,
    #[serde(rename = "nextWaypoint")]
    pub next_waypoint: Option<String>,
    #[serde(rename = "radioHeight")]
    pub radio_height: Option<f64>,
    #[serde(rename = "gearDown")]
    pub gear_down: Option<bool>,
}

// ── Implementación real (feature "simconnect") ──────────────────────────

#[cfg(feature = "simconnect")]
mod sim {
    use super::TelemetrySnapshot;
    use simconnect_sdk::{Notification, SimConnect, SimConnectObject};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread::{self, JoinHandle};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};

    // Datos suscritos desde el usuario (coincide con SIMVAR_LIST del frontend).
    // Período "sim_frame" → datos cada frame; el hilo hace throttle a 10Hz.
    #[derive(Debug, Clone, SimConnectObject)]
    #[simconnect(period = "sim-frame")]
    #[allow(dead_code)]
    struct TelemetryData {
        // ── CAMPOS BÁSICOS (siempre activos) ──
        // NOTA altitud: PLANE ALTITUDE = altitud verdadera MSL. El panel del sim
        // muestra INDICATED (baro): diferencias de cientos de pies con QNH ≠ STD
        // o atmósfera no ISA son normales. No cambiar de SimVar (ver RuleEngine
        // getCruiseTransitionDetail); la tolerancia ±500 ft lo absorbe.
        #[simconnect(name = "PLANE ALTITUDE", unit = "feet")]
        altitude: f64,
        #[simconnect(name = "GROUND VELOCITY", unit = "knots")]
        groundspeed: f64,
        #[simconnect(name = "PLANE HEADING DEGREES GYRO", unit = "degrees")]
        heading: f64,
        #[simconnect(name = "PLANE LATITUDE", unit = "degrees")]
        latitude: f64,
        #[simconnect(name = "PLANE LONGITUDE", unit = "degrees")]
        longitude: f64,
        // ── CAMPOS NECESARIOS PARA DECISIONES (agregados tras bisect) ──
        #[simconnect(name = "NUMBER OF ENGINES")]
        number_of_engines: f64,
        #[simconnect(name = "ENG COMBUSTION:1")]
        eng_combustion1: f64,
        #[simconnect(name = "ENG COMBUSTION:2")]
        eng_combustion2: f64,
        #[simconnect(name = "ENG COMBUSTION:3")]
        eng_combustion3: f64,
        #[simconnect(name = "ENG COMBUSTION:4")]
        eng_combustion4: f64,
        #[simconnect(name = "BRAKE PARKING POSITION")]
        parking_brake: f64,
        #[simconnect(name = "CABIN SEATBELTS ALERT SWITCH")]
        seatbelt_switch: f64,
        // NOTA seatbelt (diagnóstico inversión reportada): según el SDK de MSFS
        // (Aircraft System Variables), `CABIN SEATBELTS ALERT SWITCH` es
        // "True if the Seatbelts switch is on" (Bool). Por eso el mapeo es
        // `seatbelt_on = (raw != 0.0)` SIN negar. Si algún avión muestra el
        // valor invertido, es comportamiento específico de ese avión (p. ej.
        // lógicas custom AUTO/OFF por LVAR) y debe confirmarse con el log
        // `seatbelt_raw` de to_snapshot antes de tocar el mapeo.
        #[simconnect(name = "ATC ON PARKING SPOT")]
        atc_on_parking_spot: f64,
        #[simconnect(name = "ATC CLEARED TAKEOFF")]
        atc_cleared_takeoff: f64,
        #[simconnect(name = "ON ANY RUNWAY")]
        on_any_runway: f64,
        #[simconnect(name = "SIM ON GROUND")]
        sim_on_ground: f64,
        #[simconnect(name = "ZULU TIME", unit = "seconds")]
        zulu_time: f64,
        #[simconnect(name = "PLANE IN PARKING STATE")]
        plane_in_parking_state: f64,
        // ── FASE DESCENT: radio altura (válida solo < ~2500 ft AGL) y tren ──
        #[simconnect(name = "RADIO HEIGHT", unit = "feet")]
        radio_height: f64,
        #[simconnect(name = "GEAR HANDLE POSITION")]
        gear_handle_position: f64,
        // ── Descenso / noche / restante (reactivados: sin VERTICAL SPEED el
        // descenso nunca se detecta; sin LOCAL TIME siempre es "de noche") ──
        #[simconnect(name = "VERTICAL SPEED", unit = "feet per minute")]
        vertical_speed: f64,
        #[simconnect(name = "LOCAL TIME", unit = "seconds")]
        local_time: f64,
        // "ESTIMATED CRUISE TIME REMAINING" NO es un SimVar válido (provoca
        // SimConnectException(7) NAME_UNRECOGNIZED y mata TODA la suscripción:
        // objects=0, emits=0). El tiempo restante se calcula con SimBrief, no
        // con SimConnect. NO reactivar sin validar el nombre en el SDK.
        // #[simconnect(name = "ESTIMATED CRUISE TIME REMAINING", unit = "seconds")]
        // remaining_time: f64,

        // ── TODOS LOS DEMÁS COMENTADOS ──
        // #[simconnect(name = "AIRSPEED INDICATED", unit = "knots")]
        // indicated_airspeed: f64,
        // #[simconnect(name = "AIRSPEED TRUE", unit = "knots")]
        // true_airspeed: f64,
        // #[simconnect(name = "PLANE PITCH DEGREES", unit = "degrees")]
        // pitch: f64,
        // #[simconnect(name = "PLANE BANK DEGREES", unit = "degrees")]
        // bank: f64,
        // #[simconnect(name = "GENERAL ENG COMBUSTION:1")]
        // engine_running: f64,
        // #[simconnect(name = "BRAKE PARKING POSITION")]
        // parking_brake: f64,
        // #[simconnect(name = "EXIT OPEN")]
        // exit_open: f64,
        // #[simconnect(name = "CABIN SEATBELTS ALERT SWITCH")]
        // seatbelt_switch: f64,
        // #[simconnect(name = "PUSHBACK STATE")]
        // pushback_active: f64,
        // #[simconnect(name = "SIMULATION FLIGHT PHASE")]
        // sim_phase: f64,
        // #[simconnect(name = "ZULU TIME", unit = "seconds")]
        // zulu_time: f64,
        // #[simconnect(name = "AMBIENT TEMPERATURE", unit = "celsius")]
        // temperature: f64,
        // #[simconnect(name = "AMBIENT WIND VELOCITY", unit = "knots")]
        // wind_speed: f64,
        // #[simconnect(name = "AMBIENT WIND DIRECTION", unit = "degrees")]
        // wind_direction: f64,
        // #[simconnect(name = "GPS WP NEXT ID", unit = "string")]
        // next_waypoint: String,
    }

    impl TelemetryData {
        fn to_snapshot(&self) -> TelemetrySnapshot {
            // Log para verificar que las nuevas variables llegan correctamente (criterio de aceptación)
            // Incluye seatbelt_raw para diagnosticar inversiones reportadas
            // (SDK: 1 = cinturones ON; ver nota en `seatbelt_switch`).
            println!(
                "[simconnect] zulu_time: {}, parking: {}, on_ground: {}, seatbelt_raw: {}, vspeed_fpm: {}, local_time: {}",
                self.zulu_time, self.plane_in_parking_state, self.sim_on_ground, self.seatbelt_switch, self.vertical_speed, self.local_time
            );
            TelemetrySnapshot {
                altitude: self.altitude,
                groundspeed: self.groundspeed,
                vertical_speed: self.vertical_speed,
                heading: self.heading,
                latitude: self.latitude,
                longitude: self.longitude,
                indicated_airspeed: None,
                true_airspeed: None,
                pitch: None,
                bank: None,
                engine_running: Some(self.eng_combustion1 != 0.0),
                number_of_engines: Some(self.number_of_engines),
                eng_combustion2: Some(self.eng_combustion2 != 0.0),
                eng_combustion3: Some(self.eng_combustion3 != 0.0),
                eng_combustion4: Some(self.eng_combustion4 != 0.0),
                parking_brake: Some(self.parking_brake != 0.0),
                doors_closed: None,
                seatbelt_on: Some(self.seatbelt_switch != 0.0),
                atc_on_parking_spot: Some(self.atc_on_parking_spot != 0.0),
                atc_cleared_takeoff: Some(self.atc_cleared_takeoff != 0.0),
                on_any_runway: Some(self.on_any_runway != 0.0),
                sim_on_ground: Some(self.sim_on_ground != 0.0),
                plane_in_parking_state: Some(self.plane_in_parking_state != 0.0),
                pushback_active: None,
                sim_phase: None,
                zulu_time: Some(self.zulu_time),
                local_time: Some(self.local_time),
                // Sin SimVar válido (ver arriba): se mantiene None a propósito.
                remaining_time: None,
                temperature: None,
                wind_speed: None,
                wind_direction: None,
                next_waypoint: None,
                radio_height: Some(self.radio_height),
                gear_down: Some(self.gear_handle_position == 1.0),
            }
        }
    }

    struct SharedState {
        running: Arc<AtomicBool>,
        latest: Arc<Mutex<Option<TelemetrySnapshot>>>,
        handle: Option<JoinHandle<()>>,
    }

    static STATE: Mutex<Option<SharedState>> = Mutex::new(None);

    pub fn connect(app: AppHandle) -> Result<(), String> {
        {
            let guard = STATE.lock().map_err(|e| e.to_string())?;
            if let Some(s) = guard.as_ref() {
                if s.running.load(Ordering::SeqCst) {
                    log::info!("[simconnect] Ya conectado");
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
            sim_loop(app, thread_running, thread_latest, tx);
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

        // Esperar confirmación de conexión (hasta 5s)
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {
                log::info!("✅ SimConnect conectado y suscrito");
                Ok(())
            }
            Ok(Err(e)) => {
                running.store(false, Ordering::SeqCst);
                Err(e)
            }
            Err(_) => {
                running.store(false, Ordering::SeqCst);
                Err("Timeout conectando a SimConnect".into())
            }
        }
    }

    fn sim_loop(
        app: AppHandle,
        running: Arc<AtomicBool>,
        latest: Arc<Mutex<Option<TelemetrySnapshot>>>,
        tx: mpsc::Sender<Result<(), String>>,
    ) {
        let mut client = match SimConnect::new("Announs") {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(format!("Error conectando a SimConnect: {:?}", e)));
                return;
            }
        };

        // Esperar apertura de conexión
        let mut opened = false;
        for _ in 0..200 {
            if !running.load(Ordering::SeqCst) {
                return;
            }
            match client.get_next_dispatch() {
                Ok(Some(Notification::Open)) => {
                    opened = true;
                    break;
                }
                Ok(Some(Notification::Quit)) => {
                    let _ = tx.send(Err("SimConnect cerrado".into()));
                    return;
                }
                Ok(_) => {}
                Err(e) => {
                    let _ = tx.send(Err(format!("Error recibiendo datos: {:?}", e)));
                    return;
                }
            }
            thread::sleep(Duration::from_millis(25));
        }

        if !opened {
            let _ = tx.send(Err("Timeout esperando apertura SimConnect".into()));
            return;
        }

        if let Err(e) = client.register_object::<TelemetryData>() {
            let _ = tx.send(Err(format!("Error suscribiendo SimVars: {:?}", e)));
            return;
        }
        log::info!("[simconnect] SimVars registrados (TelemetryData)");

        let _ = tx.send(Ok(()));

        // Bucle de recepción → emitir telemetría a ~10Hz
        let mut last_emit = Instant::now();
        let mut object_count: u64 = 0;
        let mut emit_count: u64 = 0;
        let mut consec_errors: u64 = 0;
        while running.load(Ordering::SeqCst) {
            match client.get_next_dispatch() {
                Ok(Some(Notification::Object(data))) => {
                    consec_errors = 0;
                    object_count += 1;
                    match TelemetryData::try_from(&data) {
                        Ok(td) => {
                            let seatbelt_raw = td.seatbelt_switch;
                            let snap = td.to_snapshot();
                            if let Ok(mut g) = latest.lock() {
                                *g = Some(snap.clone());
                            }
                            if last_emit.elapsed() >= Duration::from_millis(100) {
                                emit_count += 1;
                                // Log de diagnóstico: confirma que el backend recibe y emite.
                                if emit_count % 10 == 1 {
                                    println!(
                                        "[simconnect] 📡 emit #{emit_count} (objects={object_count}) alt={:.1} gs={:.1} seatbelt_raw={seatbelt_raw} seatbeltOn={:?} parking={:?} atcPark={:?} onGround={:?} zuluTime={:?} planeParking={:?}",
                                        snap.altitude, snap.groundspeed, snap.seatbelt_on, snap.parking_brake, snap.atc_on_parking_spot, snap.sim_on_ground, snap.zulu_time, snap.plane_in_parking_state
                                    );
                                    log::info!(
                                        "[simconnect] 📡 emit #{emit_count} alt={:.1} gs={:.1} seatbelt_raw={seatbelt_raw} seatbeltOn={:?} parking={:?} atcPark={:?} onGround={:?} zuluTime={:?} planeParking={:?}",
                                        snap.altitude,
                                        snap.groundspeed,
                                        snap.seatbelt_on,
                                        snap.parking_brake,
                                        snap.atc_on_parking_spot,
                                        snap.sim_on_ground,
                                        snap.zulu_time,
                                        snap.plane_in_parking_state
                                    );
                                }
                                let _ = app.emit("telemetry", &snap);
                                last_emit = Instant::now();
                            }
                        }
                        Err(e) => {
                            // Hoy esto falla en silencio: sin log, no hay evento, y el
                            // frontend ve "Sin Datos" sin ningún error visible.
                            println!("[simconnect] ❌ try_from TelemetryData falló: {e:?}");
                            log::error!("[simconnect] try_from TelemetryData falló: {:?}", e);
                        }
                    }
                }
                Ok(Some(Notification::Quit)) => break,
                Ok(_) => {}
                Err(e) => {
                    // Un Err (p. ej. SimConnectException por un SimVar inválido)
                    // NO rompe el bucle: se sigue intentando para no detener la
                    // emisión en silencio con status "Conectado". El hilo solo
                    // termina por Quit o por disconnect() (running=false).
                    // Log con throttle para no inundar (cada ~5s).
                    consec_errors += 1;
                    if consec_errors == 1 || consec_errors % 300 == 0 {
                        println!("[simconnect] ❌ error dispatch (x{consec_errors}): {e:?}");
                        log::error!("[simconnect] error dispatch (x{}): {:?}", consec_errors, e);
                    }
                    continue;
                }
            }
            thread::sleep(Duration::from_millis(16));
        }

        println!("[simconnect] Hilo de recepción finalizado (objects={object_count}, emits={emit_count})");
        log::info!("[simconnect] Hilo de recepción finalizado");
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
        log::info!("[simconnect] SimConnect desconectado");
        Ok(())
    }

    pub fn latest() -> Result<TelemetrySnapshot, String> {
        let snapshot;
        {
            let guard = STATE.lock().map_err(|e| e.to_string())?;
            let s = guard
                .as_ref()
                .ok_or_else(|| "SimConnect no conectado".to_string())?;
            let inner = s.latest.lock().map_err(|e| e.to_string())?;
            snapshot = inner.clone();
        }
        snapshot.ok_or_else(|| "SimConnect sin datos aún".to_string())
    }

    pub fn emit(app: &AppHandle) -> Result<TelemetrySnapshot, String> {
        let snap = latest()?;
        let _ = app.emit("telemetry", &snap);
        Ok(snap)
    }
}

// ── Stub (sin feature "simconnect") ─────────────────────────────────────

#[cfg(not(feature = "simconnect"))]
mod sim {
    use super::TelemetrySnapshot;
    use std::sync::{Mutex, OnceLock};

    struct FakeConn {
        tick: u64,
        doors_closed: bool,
    }

    static FAKE: OnceLock<Mutex<Option<FakeConn>>> = OnceLock::new();

    fn fake() -> &'static Mutex<Option<FakeConn>> {
        FAKE.get_or_init(|| Mutex::new(None))
    }

    fn snapshot(conn: &mut FakeConn) -> TelemetrySnapshot {
        conn.tick += 1;
        if conn.tick == 8 {
            conn.doors_closed = true;
        }
        let jitter = ((conn.tick % 7) as f64 - 3.0) * 0.5;
        TelemetrySnapshot {
            altitude: 35000.0 + jitter * 100.0,
            groundspeed: 450.0 + jitter * 5.0,
            vertical_speed: jitter * 50.0,
            heading: (180.0 + jitter * 2.0).rem_euclid(360.0),
            latitude: -34.8222 + jitter * 0.01,
            longitude: -58.5358 + jitter * 0.01,
            indicated_airspeed: Some(280.0 + jitter * 3.0),
            true_airspeed: Some(480.0 + jitter * 5.0),
            pitch: Some(2.5 + jitter * 0.3),
            bank: Some(jitter * 0.5),
            engine_running: Some(true),
            number_of_engines: Some(2.0),
            eng_combustion2: Some(true),
            eng_combustion3: Some(false),
            eng_combustion4: Some(false),
            parking_brake: Some(false),
            doors_closed: Some(conn.doors_closed),
            seatbelt_on: Some(conn.tick % 10 < 5),
            atc_on_parking_spot: Some(conn.tick % 20 < 10),
            atc_cleared_takeoff: Some(false),
            on_any_runway: Some(false),
            sim_on_ground: Some(true),
            plane_in_parking_state: Some(conn.tick % 20 < 10),
            pushback_active: Some(false),
            sim_phase: Some(3),
            zulu_time: Some(43200.0),
            local_time: Some(36000.0),
            remaining_time: Some(1800.0),
            temperature: Some(15.0),
            wind_speed: Some(25.0),
            wind_direction: Some(270.0),
            next_waypoint: Some("GBE".to_string()),
            // DESCENT: en crucero (35000 ft) el radioaltímetro no da lectura válida (>2500 ft AGL)
            radio_height: Some(0.0),
            gear_down: Some(false),
        }
    }

    pub fn connect(_app: tauri::AppHandle) -> Result<(), String> {
        let mut guard = fake().lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            *guard = Some(FakeConn { tick: 0, doors_closed: false });
            log::info!("[simconnect] stub conectado");
        }
        Ok(())
    }

    pub fn disconnect() -> Result<(), String> {
        let mut guard = fake().lock().map_err(|e| e.to_string())?;
        *guard = None;
        log::info!("[simconnect] stub desconectado");
        Ok(())
    }

    pub fn latest() -> Result<TelemetrySnapshot, String> {
        let mut guard = fake().lock().map_err(|e| e.to_string())?;
        let conn = guard.as_mut().ok_or_else(|| "SimConnect no conectado".to_string())?;
        Ok(snapshot(conn))
    }

    pub fn emit(app: &tauri::AppHandle) -> Result<TelemetrySnapshot, String> {
        let snap = latest()?;
        use tauri::Emitter;
        let _ = app.emit("telemetry", &snap);
        Ok(snap)
    }
}

// ── Comandos Tauri ────────────────────────────────────────────────────────

#[tauri::command]
pub fn simconnect_connect(app: tauri::AppHandle) -> Result<String, String> {
    println!("[simconnect] 🔍 simconnect_connect llamado");
    match sim::connect(app) {
        Ok(_) => {
            println!("[simconnect] ✅ Conexión exitosa");
            Ok("connected".to_string())
        }
        Err(e) => {
            println!("[simconnect] ❌ Error de conexión: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn simconnect_disconnect() -> Result<(), String> {
    sim::disconnect()
}

/// Suscripción de SimVars: en la implementación real las suscripciones se
/// registran al conectar (register_object), por lo que este comando es no-op
/// por compatibilidad con el frontend.
#[tauri::command]
pub fn simconnect_subscribe(_vars: Vec<String>) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn simconnect_poll() -> Result<TelemetrySnapshot, String> {
    // println!("[simconnect] 📡 Polling...");
    sim::latest()
}

#[tauri::command]
pub fn simconnect_emit_telemetry(app: tauri::AppHandle) -> Result<TelemetrySnapshot, String> {
    sim::emit(&app)
}
