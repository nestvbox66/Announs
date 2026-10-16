//! Telemetría canónica del simulador, independiente del proveedor.
//!
//! Rust mirror de `src/types/telemetry.ts`. Compartido por los puentes
//! `simconnect` (MSFS) y `xplane` (X-Plane 12): ambos deben emitir exactamente
//! este tipo bajo el mismo evento `"telemetry"` para que el frontend no
//! necesite adaptadores por simulador.

use serde::{Deserialize, Serialize};

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
    #[serde(rename = "taxiLightsOn")]
    pub taxi_lights_on: Option<bool>,
    #[serde(rename = "landingLightsOn")]
    pub landing_lights_on: Option<bool>,
    #[serde(rename = "strobeLightsOn")]
    pub strobe_lights_on: Option<bool>,
    /// LIGHT BEACON (baliza). Bonus disc_beacon_lights_xp.
    #[serde(rename = "beaconLightsOn")]
    pub beacon_lights_on: Option<bool>,
    /// E:TIME OF DAY nativo (enum; 3 = noche). Bonus nocturno + horas día/noche.
    #[serde(rename = "timeOfDay")]
    pub time_of_day: Option<f64>,
}
