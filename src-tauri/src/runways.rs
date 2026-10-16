//! Geometría de pistas desde `apt.dat` local (X-Plane 12, solo lectura).
//!
//! Propósito: poblar `onAnyRunway` para X-Plane por paridad con MSFS, sin
//! tocar reglas ni escenarios. La telemetría UDP no dice si el avión está en
//! pista (Laminar: X-Plane no lo rastrea), así que se calcula con geometría:
//! punto-en-rectángulo sobre los extremos físicos de `apt.dat` (el cálculo
//! vive en el frontend, `RunwayGeometry.ts`; acá solo se proveen los datos).
//!
//! Fuentes y prioridad (verificado contra documentación real + instalación
//! Steam de XP12):
//! - Instalación: override manual > `x-plane_install_12.txt` del perfil
//!   (`%LOCALAPPDATA%` en Windows, `~/Library/Preferences` en macOS,
//!   `~/.x-plane` en Linux; una ruta por línea, pueden estar obsoletas → se
//!   validan) > rutas estándar (Steam, `C:\X-Plane 12`, ...).
//! - Dentro de la instalación, en orden:
//!   1. `Custom Scenery/scenery_packs.ini` en orden (arriba = mayor
//!      prioridad; `SCENERY_PACK_DISABLED` se salta; packs presentes no
//!      listados van al frente, como hace X-Plane), cada pack en
//!      `<pack>/Earth nav data/apt.dat`.
//!   2. `Custom Scenery/Global Airports/Earth nav data/apt.dat` (ubicación
//!      XP11; se agrega si el .ini no lo trae).
//!   3. `Global Scenery/Global Airports/Earth nav data/apt.dat` (ubicación
//!      XP12, confirmada en instalación Steam: ahí viven los Gateway).
//!   4. `Resources/default scenery/default apt dat/Earth nav data/apt.dat`.
//!   Gana el primer archivo (en prioridad) que contenga el ICAO: los customs
//!   pisan al gateway y este al default, como en X-Plane.
//! - Formato fila 100 (spec apt.dat 1200, developer.x-plane.com):
//!   `100 ancho superficie ...` y por extremo `designador lat lon
//!   umbral_desplazado ...`; rumbos en norte verdadero (no se usan: el
//!   chequeo es punto-en-rectángulo, sin rumbos). Identificador de
//!   aeropuerto: fila `1302 icao_code`, con fallback al ident de la cabecera
//!   (`1 ... IDENT`, campo 5).
//!
//! Parseo en streaming (el apt.dat global es grande): se lee línea por línea
//! y solo se conservan las pistas del ICAO pedido.

use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

// ── Tipos de respuesta ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct RunwayEndData {
    pub designator: String,
    pub lat: f64,
    pub lon: f64,
    pub displaced_threshold_m: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunwayData {
    pub width_m: f64,
    pub surface: i64,
    pub ends: Vec<RunwayEndData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RampData {
    pub lat: f64,
    pub lon: f64,
    /// Tipo apt.dat: gate|hangar|misc|tie-down (o "unknown").
    pub kind: String,
    /// Nombre del stand (p. ej. "A7"), puede ser vacío.
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunwayAirportData {
    pub icao: String,
    /// Pistas encontradas (vacío + found=false si el ICAO no está).
    pub runways: Vec<RunwayData>,
    /// Puestos de estacionamiento (fila 1300: gate/hangar/misc/tie-down).
    pub ramps: Vec<RampData>,
    /// Archivo apt.dat del que salieron (para invalidación de caché).
    pub source_file: String,
    /// mtime del archivo fuente en segundos epoch (para invalidación).
    pub source_mtime: u64,
    /// true si el ICAO se encontró en el archivo fuente.
    pub found: bool,
}

// ── Descubrimiento de la instalación ──────────────────────────────────

/// Candidatos estándar por SO (mejor esfuerzo; lo autoritativo es el .txt).
#[cfg(target_os = "windows")]
fn standard_roots() -> Vec<PathBuf> {
    vec![
        PathBuf::from("C:\\X-Plane 12"),
        PathBuf::from("C:\\X-Plane 12\\"),
    ]
}

#[cfg(target_os = "macos")]
fn standard_roots() -> Vec<PathBuf> {
    vec![]
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn standard_roots() -> Vec<PathBuf> {
    vec![]
}

/// Archivo del perfil con rutas de instalación conocidas.
#[cfg(target_os = "windows")]
fn install_list_file() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA")
        .ok()
        .map(|base| PathBuf::from(base).join("x-plane_install_12.txt"))
}

#[cfg(target_os = "macos")]
fn install_list_file() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|base| {
            PathBuf::from(base)
                .join("Library")
                .join("Preferences")
                .join("x-plane_install_12.txt")
        })
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn install_list_file() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|base| PathBuf::from(base).join(".x-plane").join("x-plane_install_12.txt"))
}

fn looks_like_xplane_root(dir: &Path) -> bool {
    dir.is_dir() && dir.join("Resources").is_dir()
}

/// Raíces candidatas en orden: override > install-list (validadas) > estándar.
fn candidate_roots(override_root: Option<String>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(o) = override_root {
        let p = PathBuf::from(o.trim());
        if !p.as_os_str().is_empty() {
            roots.push(p);
        }
    }
    if let Some(list) = install_list_file() {
        if let Ok(file) = File::open(&list) {
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                let p = PathBuf::from(line.trim());
                if !p.as_os_str().is_empty() && looks_like_xplane_root(&p) && !roots.contains(&p) {
                    roots.push(p);
                }
            }
        }
    }
    for std in standard_roots() {
        if looks_like_xplane_root(&std) && !roots.contains(&std) {
            roots.push(std);
        }
    }
    // Steam (Windows): librerías habituales como último recurso.
    #[cfg(target_os = "windows")]
    {
        for lib in [
            "C:\\Program Files (x86)\\Steam\\steamapps\\common\\X-Plane 12",
            "C:\\Program Files\\Steam\\steamapps\\common\\X-Plane 12",
        ] {
            let p = PathBuf::from(lib);
            if looks_like_xplane_root(&p) && !roots.contains(&p) {
                roots.push(p);
            }
        }
    }
    roots
}

// ── scenery_packs.ini ─────────────────────────────────────────────────

/// Entradas en orden de prioridad (arriba = mayor). Omite deshabilitados.
/// Los packs presentes no listados van AL FRENTE (X-Plane los auto-agrega
/// arriba al arrancar); así nuestra lectura refleja el runtime real.
fn scenery_priority(root: &Path) -> Vec<PathBuf> {
    let custom = root.join("Custom Scenery");
    let ini = custom.join("scenery_packs.ini");
    // `order`: habilitados en orden. `seen`: todo lo mencionado (incluye
    // deshabilitados) para que el escaneo de no-listados no los re-agregue.
    let mut order: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let norm = |s: &str| s.trim_end_matches('/').to_string();
    if let Ok(file) = File::open(&ini) {
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            let t = line.trim();
            if t.is_empty() {
                continue;
            }
            // Formato con path externo: `[external_path:X]SCENERY_PACK ...`
            let t = match t.find(']') {
                Some(i) if t.starts_with('[') => t[i + 1..].trim(),
                _ => t,
            };
            if let Some(rest) = t.strip_prefix("SCENERY_PACK_DISABLED") {
                // La ruta contiene espacios ("Custom Scenery/..."): tomar el
                // resto íntegro, no por tokens.
                let rel = rest.trim();
                if !rel.is_empty() {
                    let n = norm(rel);
                    if !seen.contains(&n) {
                        seen.push(n);
                    }
                }
                continue;
            }
            if let Some(rel) = t.strip_prefix("SCENERY_PACK") {
                let rel = rel.trim();
                if !rel.is_empty() {
                    let n = norm(rel);
                    if !seen.contains(&n) {
                        seen.push(n.clone());
                    }
                    if !order.contains(&n) {
                        order.push(n);
                    }
                }
            }
        }
    }
    // Packs presentes no listados → al frente (alfabético, como X-Plane).
    let mut unlisted: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&custom) {
        for e in entries.flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            let name = match p.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let rel = format!("Custom Scenery/{}", name);
            if !seen.iter().any(|l| l == &rel) && !unlisted.contains(&rel) {
                unlisted.push(rel);
            }
        }
    }
    unlisted.sort();
    unlisted
        .into_iter()
        .chain(order.into_iter())
        .map(|rel| {
            // Las entradas son relativas a la raíz ("Custom Scenery/...").
            // Normalizar separadores para Windows.
            let norm = rel.replace('/', &std::path::MAIN_SEPARATOR.to_string());
            root.join(norm)
        })
        .collect()
}

fn apt_dat_candidates(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut push_if_new = |p: PathBuf| {
        if p.is_file() && !out.contains(&p) {
            out.push(p);
        }
    };
    for pack in scenery_priority(root) {
        push_if_new(pack.join("Earth nav data").join("apt.dat"));
    }
    // Red de seguridad explícita: los aeropuertos Gateway (p. ej. KATL) viven
    // en el pack "Global Airports", NO en el apt.dat global. Si el .ini no lo
    // lista y el escaneo de no-listados falló, sin esto esos ICAO son
    // irresolubles aunque existan en disco. Ubicaciones conocidas (XP11 bajo
    // Custom Scenery, XP12 bajo Global Scenery); van antes del global para
    // respetar la prioridad: customs > gateway > default.
    push_if_new(gateway_apt_dat(root));
    push_if_new(gateway_apt_dat_global_scenery(root));
    push_if_new(global_apt_dat(root));
    out
}

/// Ruta canónica del apt.dat global (reutilizada en diagnóstico).
fn global_apt_dat(root: &Path) -> PathBuf {
    root.join("Resources")
        .join("default scenery")
        .join("default apt dat")
        .join("Earth nav data")
        .join("apt.dat")
}

fn gateway_apt_dat(root: &Path) -> PathBuf {
    root.join("Custom Scenery")
        .join("Global Airports")
        .join("Earth nav data")
        .join("apt.dat")
}

/// Ubicación XP12 (Steam) del pack Gateway.
fn gateway_apt_dat_global_scenery(root: &Path) -> PathBuf {
    root.join("Global Scenery")
        .join("Global Airports")
        .join("Earth nav data")
        .join("apt.dat")
}

/// Foto de qué hay en disco para una raíz (solo diagnóstico, sin coste).
/// Responde "¿falta el pack o falla mi búsqueda?" sin adivinar.
fn root_diag(root: &Path) -> String {
    let custom = root.join("Custom Scenery");
    let ini = custom.join("scenery_packs.ini");
    let packs_listed = std::fs::read_to_string(&ini)
        .map(|c| {
            c.lines()
                .filter(|l| {
                    let t = l.trim();
                    t.starts_with("SCENERY_PACK ") || t.starts_with("SCENERY_PACK_DISABLED")
                })
                .count()
        })
        .unwrap_or(0);
    let packs_present = std::fs::read_dir(&custom)
        .map(|rd| rd.filter(|e| e.as_ref().map(|x| x.path().is_dir()).unwrap_or(false)).count())
        .unwrap_or(0);
    format!(
        "root={} customScenery={} iniEntradas={} packsPresentes={} gatewayApt={} globalApt={}",
        root.display(),
        custom.is_dir(),
        packs_listed,
        packs_present,
        gateway_apt_dat(root).is_file() || gateway_apt_dat_global_scenery(root).is_file(),
        global_apt_dat(root).is_file(),
    )
}

// ── Parseo fila 100 (tolerante entre versiones de spec) ───────────────

fn is_designator(tok: &str) -> bool {
    let t = tok.trim();
    if t.len() < 1 || t.len() > 3 {
        return false;
    }
    let (digits, suffix) = match t.len() {
        3 => (&t[..2], &t[2..]),
        2 => {
            if t.chars().all(|c| c.is_ascii_digit()) {
                (&t[..], "")
            } else {
                (&t[..1], &t[1..])
            }
        }
        _ => (&t[..], ""),
    };
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    // Un "0" suelto nunca es designador (las pistas son 01-36); sin este
    // gate, los campos numéricos de la cabecera (p. ej. edge-lighting "0")
    // se parseaban como extremos falsos.
    match digits.parse::<u32>() {
        Ok(n) if (1..=36).contains(&n) => {}
        _ => return false,
    }
    matches!(suffix, "" | "L" | "R" | "C" | "W" | "S" | "T")
}

fn parse_lat(tok: &str) -> Option<f64> {
    tok.parse::<f64>().ok().filter(|v| (-90.0..=90.0).contains(v))
}

fn parse_lon(tok: &str) -> Option<f64> {
    tok.parse::<f64>().ok().filter(|v| (-180.0..=180.0).contains(v))
}

/// Parsea una fila `100`. Devuelve (ancho, superficie, extremos).
///
/// Estrategia: primero parseo estructurado en offsets fijos del spec
/// (1200/1130/1100 comparten layout: 8 campos de cabecera + 2 extremos de 9
/// campos). Si no encaja (formatos viejos 1050/1000 u otros), fallback de
/// escaneo tolerante que localiza grupos `designador lat lon` (designadores
/// de 2-3 caracteres; un dígito suelto en una fila 100 casi siempre es un
/// flag, no una pista sin cero inicial).
fn parse_runway_row(tokens: &[&str]) -> Option<(f64, i64, Vec<RunwayEndData>)> {
    if tokens.is_empty() || tokens[0] != "100" {
        return None;
    }
    if let Some(parsed) = parse_runway_row_structured(tokens) {
        return Some(parsed);
    }
    parse_runway_row_scan(tokens)
}

/// Offsets fijos del spec: [100, ancho, sup, sh, sm, cl, edge, auto,
/// des1, lat1, lon1, displ1, ovr1, mark1, appr1, tdz1, reil1,
//  des2, lat2, lon2, ...] → extremos en 8 y 17.
fn parse_runway_row_structured(tokens: &[&str]) -> Option<(f64, i64, Vec<RunwayEndData>)> {
    if tokens.len() < 26 {
        return None;
    }
    let width_m: f64 = tokens.get(1)?.parse().ok().filter(|v: &f64| *v >= 1.0)?;
    let surface: i64 = tokens.get(2)?.parse().unwrap_or(0);
    let mut ends = Vec::new();
    for base in [8usize, 17usize] {
        let (d, la, lo, di) = match (tokens.get(base), tokens.get(base + 1), tokens.get(base + 2), tokens.get(base + 3)) {
            (Some(dd), Some(a), Some(b), Some(c)) => (*dd, *a, *b, *c),
            _ => return None,
        };
        if !(d.len() >= 2 && is_designator(d)) {
            return None;
        }
        let (lat, lon) = match (parse_lat(la), parse_lon(lo)) {
            (Some(a), Some(b)) => (a, b),
            _ => return None,
        };
        ends.push(RunwayEndData {
            designator: d.to_uppercase(),
            lat,
            lon,
            displaced_threshold_m: di.parse::<f64>().unwrap_or(0.0).max(0.0),
        });
    }
    Some((width_m, surface, ends))
}

fn parse_runway_row_scan(tokens: &[&str]) -> Option<(f64, i64, Vec<RunwayEndData>)> {
    if tokens.len() < 12 || tokens[0] != "100" {
        return None;
    }
    let width_m: f64 = tokens.get(1)?.parse().ok().filter(|v: &f64| *v >= 1.0)?;
    let surface: i64 = tokens.get(2)?.parse().unwrap_or(0);
    let mut ends = Vec::new();
    let mut i = 3;
    while i < tokens.len() && ends.len() < 2 {
        // Solo designadores de 2-3 caracteres (ver doc de la función).
        if tokens[i].trim().len() >= 2 && is_designator(tokens[i]) {
            let (lat, lon) = match (tokens.get(i + 1), tokens.get(i + 2)) {
                (Some(a), Some(b)) => match (parse_lat(a), parse_lon(b)) {
                    (Some(la), Some(lo)) => (la, lo),
                    _ => {
                        i += 1;
                        continue;
                    }
                },
                _ => {
                    i += 1;
                    continue;
                }
            };
            let displaced = tokens
                .get(i + 3)
                .and_then(|t| t.parse::<f64>().ok())
                .unwrap_or(0.0)
                .max(0.0);
            ends.push(RunwayEndData {
                designator: tokens[i].to_uppercase(),
                lat,
                lon,
                displaced_threshold_m: displaced,
            });
            i += 4;
        } else {
            i += 1;
        }
    }
    if ends.len() == 2 {
        Some((width_m, surface, ends))
    } else {
        None
    }
}

/// Extrae pistas y rampas del ICAO de un apt.dat en streaming.
fn parse_airport_ground(path: &Path, icao: &str) -> Result<(Vec<RunwayData>, Vec<RampData>), String> {
    let target = icao.trim().to_uppercase();
    let file = File::open(path).map_err(|e| format!("abrir {}: {}", path.display(), e))?;
    let mut runways = Vec::new();
    let mut ramps = Vec::new();
    let mut in_target = false;
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|e| format!("leer {}: {}", path.display(), e))?;
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let tokens: Vec<&str> = t.split_whitespace().collect();
        if tokens.is_empty() {
            continue;
        }
        match tokens[0] {
            "1" | "16" | "17" => {
                // Nueva cabecera: ¿es nuestro aeropuerto? Vale el ident de
                // cabecera (campo 5); un `1302 icao_code` posterior manda.
                in_target = false;
                if tokens.get(4).map(|s| s.to_uppercase()).as_deref() == Some(target.as_str()) {
                    in_target = true;
                }
            }
            "1302" => {
                // `1302 icao_code XXXX` manda sobre el ident de cabecera.
                if tokens.get(1) == Some(&"icao_code") {
                    if let Some(code) = tokens.get(2) {
                        in_target = code.to_uppercase() == target;
                    }
                }
            }
            "100" if in_target => {
                if let Some((width_m, surface, ends)) = parse_runway_row(&tokens) {
                    runways.push(RunwayData { width_m, surface, ends });
                }
            }
            "1300" if in_target => {
                if let Some(ramp) = parse_ramp_row(&tokens) {
                    ramps.push(ramp);
                }
            }
            "99" => break,
            _ => {}
        }
    }
    Ok((runways, ramps))
}

/// Parsea una fila `1300` (puesto de estacionamiento):
/// `1300 lat lon rumbo tipo [ops] [nombre...]`, tipo en
/// gate|hangar|misc|tie-down (otro → "unknown", igual se conserva).
fn parse_ramp_row(tokens: &[&str]) -> Option<RampData> {
    if tokens.len() < 5 || tokens[0] != "1300" {
        return None;
    }
    let lat = parse_lat(tokens[1])?;
    let lon = parse_lon(tokens[2])?;
    let raw_kind = tokens[4].to_lowercase();
    let known = ["gate", "hangar", "misc", "tie-down"];
    let (kind, name_from) = if known.contains(&raw_kind.as_str()) {
        (raw_kind, 5usize)
    } else {
        ("unknown".to_string(), 4usize)
    };
    let name = tokens.get(name_from..).unwrap_or(&[]).join(" ");
    Some(RampData { lat, lon, kind, name })
}

fn file_mtime_secs(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ── Comando Tauri ─────────────────────────────────────────────────────

/// Pistas del ICAO desde el apt.dat local con mayor prioridad.
/// `xplane_root`: override manual; si es None se descubre la instalación.
#[tauri::command]
pub fn get_runways(icao: String, xplane_root: Option<String>) -> Result<RunwayAirportData, String> {
    let target = icao.trim().to_uppercase();
    if target.is_empty() {
        return Err("ICAO vacío".into());
    }
    let roots = candidate_roots(xplane_root);
    if roots.is_empty() {
        return Err("no se localizó instalación de X-Plane (override manual o x-plane_install_12.txt)".into());
    }
    let mut searched: Vec<String> = Vec::new();
    for root in &roots {
        for apt in apt_dat_candidates(root) {
            searched.push(apt.display().to_string());
            match parse_airport_ground(&apt, &target) {
                Ok((runways, ramps)) if !runways.is_empty() || !ramps.is_empty() => {
                    return Ok(RunwayAirportData {
                        icao: target,
                        runways,
                        ramps,
                        source_file: apt.display().to_string(),
                        source_mtime: file_mtime_secs(&apt),
                        found: true,
                    });
                }
                Ok(_) => continue,
                Err(e) => {
                    // Archivo ilegible: se sigue con el siguiente candidato.
                    let _ = e;
                    continue;
                }
            }
        }
    }
    Err(format!(
        "ICAO {} no encontrado (buscado en {} archivo(s): {}) | disco: {}",
        target,
        searched.len(),
        if searched.is_empty() {
            "(ninguno: revisá el path de X-Plane y que exista Custom Scenery/Global Airports o el apt.dat global)".to_string()
        } else {
            searched.join(" | ")
        },
        roots.iter().map(|r| root_diag(r)).collect::<Vec<_>>().join(" ;; ")
    ))
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(name: &str, content: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("announs_runway_test_{}", name));
        let mut f = File::create(&p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        p
    }

    const APT: &str = "I\n1000 Version\n1  500 0 0 SABE Aeroparque Jorge Newbery\n100 45.00 2 0 0.25 1 2 1 13  -34.55900000 -58.41100000 0.00 0.00 2 0 0 1 31  -34.56900000 -58.42200000 120.00 0.00 2 0 0 1\n1302 icao_code SABE\n1  100 0 0 SAEZ Ezeiza\n100 60.00 1 0 0.25 0 2 1 11  -34.81200000 -58.53900000 0.00 0.00 1 0 0 0 29  -34.82200000 -58.55000000 0.00 0.00 1 0 0 0\n99\n";

    #[test]
    fn parses_runway_with_1302_match() {
        let p = write_temp("basic.dat", APT);
        let (rw, ramps) = parse_airport_ground(&p, "sabe").unwrap();
        assert_eq!(rw.len(), 1);
        assert!((rw[0].width_m - 45.0).abs() < 1e-9);
        assert_eq!(rw[0].ends.len(), 2);
        assert_eq!(rw[0].ends[0].designator, "13");
        assert!((rw[0].ends[0].lat + 34.559).abs() < 1e-9);
        assert_eq!(rw[0].ends[1].displaced_threshold_m, 120.0);
        assert!(ramps.is_empty());
        std::fs::remove_file(p).ok();
    }

    #[test]
    fn header_ident_fallback_without_1302() {
        let p = write_temp(
            "hdr.dat",
            "1  10 0 0 TEST Test Airport\n100 30.00 1 0 0.25 0 0 0 09 10.00000000 20.00000000 0.00 0.00 0 0 0 0 27 10.01000000 20.00000000 0.00 0.00 0 0 0 0\n99\n",
        );
        let (rw, _) = parse_airport_ground(&p, "TEST").unwrap();
        assert_eq!(rw.len(), 1);
        assert_eq!(rw[0].ends[1].designator, "27");
        std::fs::remove_file(p).ok();
    }

    #[test]
    fn unknown_icao_returns_empty() {
        let p = write_temp("empty.dat", APT);
        let (rw, ramps) = parse_airport_ground(&p, "XXXX").unwrap();
        assert!(rw.is_empty());
        assert!(ramps.is_empty());
        std::fs::remove_file(p).ok();
    }

    #[test]
    fn malformed_runway_row_ignored() {
        let p = write_temp(
            "bad.dat",
            "1  10 0 0 TEST Test\n100 45.00 2 0\n100 not a runway row at all\n99\n",
        );
        let (rw, _) = parse_airport_ground(&p, "TEST").unwrap();
        assert!(rw.is_empty());
        std::fs::remove_file(p).ok();
    }

    #[test]
    fn parses_ramps_row_1300() {
        let p = write_temp(
            "ramps.dat",
            "1  10 0 0 RAMP Test Field\n1300  10.00100000 20.00200000  88.78 gate jets|turboprops A7\n1300  10.00300000 20.00400000  270.00 tie-down pios C3\n1300  bad row\n99\n",
        );
        let (rw, ramps) = parse_airport_ground(&p, "RAMP").unwrap();
        assert!(rw.is_empty());
        assert_eq!(ramps.len(), 2);
        assert_eq!(ramps[0].kind, "gate");
        assert_eq!(ramps[0].name, "jets|turboprops A7");
        assert!((ramps[0].lat - 10.001).abs() < 1e-9);
        assert_eq!(ramps[1].kind, "tie-down");
        assert_eq!(ramps[1].name, "pios C3");
        std::fs::remove_file(p).ok();
    }

    #[test]
    fn ramps_scoped_to_icao_block() {
        // La rampa de otro bloque no debe colarse.
        let p = write_temp(
            "scope.dat",
            "1  10 0 0 AAAA First\n1300  1.00000000 2.00000000  0.00 gate G1\n1  10 0 0 BBBB Second\n1300  3.00000000 4.00000000  0.00 gate G2\n99\n",
        );
        let (_, ramps) = parse_airport_ground(&p, "BBBB").unwrap();
        assert_eq!(ramps.len(), 1);
        assert_eq!(ramps[0].name, "G2");
        std::fs::remove_file(p).ok();
    }

    #[test]
    fn designator_validation() {
        assert!(is_designator("09"));
        assert!(is_designator("9"));
        assert!(is_designator("27L"));
        assert!(is_designator("13"));
        assert!(!is_designator("0"));
        assert!(!is_designator("AB"));
        assert!(!is_designator("99"));
        assert!(!is_designator("1234"));
        assert!(!is_designator("apt.dat"));
    }

    #[test]
    fn priority_first_pack_wins() {
        // Simula Custom Scenery con .ini: pack custom arriba, global después.
        let base = std::env::temp_dir().join("announs_runway_prio");
        let _ = std::fs::remove_dir_all(&base);
        let custom_apt = base.join("Custom Scenery").join("MyAirp").join("Earth nav data").join("apt.dat");
        let global_apt = base
            .join("Resources")
            .join("default scenery")
            .join("default apt dat")
            .join("Earth nav data")
            .join("apt.dat");
        std::fs::create_dir_all(custom_apt.parent().unwrap()).unwrap();
        std::fs::create_dir_all(global_apt.parent().unwrap()).unwrap();
        std::fs::write(
            &custom_apt,
            "1  10 0 0 PRIO Prio\n100 50.00 1 0 0.25 0 0 0 09 1.00000000 2.00000000 0.00 0.00 0 0 0 0 27 1.01000000 2.00000000 0.00 0.00 0 0 0 0\n99\n",
        )
        .unwrap();
        std::fs::write(
            &global_apt,
            "1  10 0 0 PRIO Prio\n100 30.00 1 0 0.25 0 0 0 09 1.00000000 2.00000000 0.00 0.00 0 0 0 0 27 1.01000000 2.00000000 0.00 0.00 0 0 0 0\n99\n",
        )
        .unwrap();
        std::fs::write(
            base.join("Custom Scenery").join("scenery_packs.ini"),
            "SCENERY_PACK Custom Scenery/MyAirp/\n",
        )
        .unwrap();
        let cands = apt_dat_candidates(&base);
        assert_eq!(cands.len(), 2, "custom + global");
        assert!(cands[0].starts_with(&base.join("Custom Scenery")));
        let rw = parse_airport_ground(&cands[0], "PRIO").unwrap().0;
        assert!((rw[0].width_m - 50.0).abs() < 1e-9, "gana el pack custom");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn disabled_pack_skipped() {
        let base = std::env::temp_dir().join("announs_runway_dis");
        let _ = std::fs::remove_dir_all(&base);
        let dis_apt = base.join("Custom Scenery").join("OldAirp").join("Earth nav data").join("apt.dat");
        let global_apt = base
            .join("Resources")
            .join("default scenery")
            .join("default apt dat")
            .join("Earth nav data")
            .join("apt.dat");
        std::fs::create_dir_all(dis_apt.parent().unwrap()).unwrap();
        std::fs::create_dir_all(global_apt.parent().unwrap()).unwrap();
        std::fs::write(
            &dis_apt,
            "1  10 0 0 DISA Disa\n100 50.00 1 0 0.25 0 0 0 09 1.00000000 2.00000000 0.00 0.00 0 0 0 0 27 1.01000000 2.00000000 0.00 0.00 0 0 0 0\n99\n",
        )
        .unwrap();
        std::fs::write(
            &global_apt,
            "1  10 0 0 DISA Disa\n100 30.00 1 0 0.25 0 0 0 09 1.00000000 2.00000000 0.00 0.00 0 0 0 0 27 1.01000000 2.00000000 0.00 0.00 0 0 0 0\n99\n",
        )
        .unwrap();
        std::fs::write(
            base.join("Custom Scenery").join("scenery_packs.ini"),
            "SCENERY_PACK_DISABLED Custom Scenery/OldAirp/\n",
        )
        .unwrap();
        let cands = apt_dat_candidates(&base);
        // El deshabilitado no lista: solo el global.
        assert_eq!(cands.len(), 1);
        assert!(cands[0].starts_with(&base.join("Resources")));
        let _ = std::fs::remove_dir_all(&base);
    }

    fn write_apt(path: &std::path::Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    /// Instalación sintética: .ini solo con un custom, Global Airports fuera
    /// del .ini (caso real que dejaba a KATL irresoluble). `tag` distingue
    /// el directorio temporal (los tests corren en paralelo).
    fn gateway_fixture(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("announs_runway_gateway_{}", tag));
        let _ = std::fs::remove_dir_all(&base);
        let custom = base.join("Custom Scenery");
        write_apt(
            &custom.join("SomePack").join("Earth nav data").join("apt.dat"),
            "1  10 0 0 OTHR Other\n100 30.00 1 0 0.25 0 0 0 09 1.00000000 2.00000000 0.00 0.00 0 0 0 0 27 1.01000000 2.00000000 0.00 0.00 0 0 0 0\n99\n",
        );
        write_apt(
            &custom.join("Global Airports").join("Earth nav data").join("apt.dat"),
            "1  10 0 0 GTWY Gateway Field\n100 45.00 1 0 0.25 0 0 0 09 5.00000000 6.00000000 0.00 0.00 0 0 0 0 27 5.01000000 6.00000000 0.00 0.00 0 0 0 0\n99\n",
        );
        write_apt(
            &base.join("Resources").join("default scenery").join("default apt dat").join("Earth nav data").join("apt.dat"),
            "1  10 0 0 OTHR Other\n100 30.00 1 0 0.25 0 0 0 09 1.00000000 2.00000000 0.00 0.00 0 0 0 0 27 1.01000000 2.00000000 0.00 0.00 0 0 0 0\n99\n",
        );
        std::fs::write(
            custom.join("scenery_packs.ini"),
            "SCENERY_PACK Custom Scenery/SomePack/\n",
        )
        .unwrap();
        base
    }

    #[test]
    fn gateway_fallback_resolves_unlisted_global_airports() {
        let base = gateway_fixture("fallback");
        let cands = apt_dat_candidates(&base);
        // SomePack (listado) + Global Airports (rescatado fuera del .ini,
        // al frente como hace X-Plane) + global.
        assert_eq!(cands.len(), 3);
        assert!(cands[0].to_string_lossy().contains("Global Airports"));
        let res = get_runways(
            "GTWY".to_string(),
            Some(base.to_string_lossy().to_string()),
        )
        .expect("GTWY debe resolverse vía Global Airports");
        assert!(res.found);
        assert_eq!(res.runways.len(), 1);
        assert!(res.source_file.contains("Global Airports"), "{}", res.source_file);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn gateway_not_duplicated_when_listed() {
        let base = gateway_fixture("noduplicate");
        std::fs::write(
            base.join("Custom Scenery").join("scenery_packs.ini"),
            "SCENERY_PACK Custom Scenery/Global Airports/\nSCENERY_PACK Custom Scenery/SomePack/\n",
        )
        .unwrap();
        let cands = apt_dat_candidates(&base);
        let gateway_hits = cands
            .iter()
            .filter(|p| p.to_string_lossy().contains("Global Airports"))
            .count();
        assert_eq!(gateway_hits, 1, "sin duplicados: {:?}", cands);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn error_lists_all_searched_files() {
        let base = gateway_fixture("errlist");
        let err = get_runways(
            "ZZZZ".to_string(),
            Some(base.to_string_lossy().to_string()),
        )
        .expect_err("ZZZZ no existe");
        assert!(err.contains("SomePack"), "{}", err);
        assert!(err.contains("Global Airports"), "{}", err);
        assert!(err.contains("default apt dat"), "{}", err);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn root_diag_reports_disk_state() {
        let base = gateway_fixture("diag");
        let d = root_diag(&base);
        assert!(d.contains("customScenery=true"), "{}", d);
        assert!(d.contains("iniEntradas=1"), "{}", d);
        assert!(d.contains("gatewayApt=true"), "{}", d);
        assert!(d.contains("globalApt=true"), "{}", d);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn error_includes_disk_diag() {
        let base = gateway_fixture("errdiag");
        let err = get_runways(
            "ZZZZ".to_string(),
            Some(base.to_string_lossy().to_string()),
        )
        .expect_err("ZZZZ no existe");
        assert!(err.contains("disco:"), "{}", err);
        assert!(err.contains("gatewayApt=true"), "{}", err);
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Layout XP12 Steam: el pack Gateway vive en Global Scenery (no bajo
    /// Custom Scenery). El aeropuerto solo existe ahí.
    fn xp12_fixture(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("announs_runway_xp12_{}", tag));
        let _ = std::fs::remove_dir_all(&base);
        let custom = base.join("Custom Scenery");
        write_apt(
            &custom.join("SomePack").join("Earth nav data").join("apt.dat"),
            "1  10 0 0 OTHR Other\n100 30.00 1 0 0.25 0 0 0 09 1.00000000 2.00000000 0.00 0.00 0 0 0 0 27 1.01000000 2.00000000 0.00 0.00 0 0 0 0\n99\n",
        );
        write_apt(
            &base.join("Global Scenery").join("Global Airports").join("Earth nav data").join("apt.dat"),
            "1  10 0 0 XP12 Gateway Field\n100 45.00 1 0 0.25 0 0 0 09 5.00000000 6.00000000 0.00 0.00 0 0 0 0 27 5.01000000 6.00000000 0.00 0.00 0 0 0 0\n1300  5.00100000 6.00100000  90.00 gate G5\n99\n",
        );
        std::fs::write(
            custom.join("scenery_packs.ini"),
            "SCENERY_PACK Custom Scenery/SomePack/\n",
        )
        .unwrap();
        base
    }

    #[test]
    fn xp12_global_scenery_gateway_resolves() {
        let base = xp12_fixture("resolve");
        let cands = apt_dat_candidates(&base);
        // SomePack (listado) + Global Scenery/Gateway (rescatado) — sin default.
        assert_eq!(cands.len(), 2);
        assert!(cands[1].to_string_lossy().contains("Global Scenery"));
        let res = get_runways(
            "XP12".to_string(),
            Some(base.to_string_lossy().to_string()),
        )
        .expect("XP12 debe resolverse vía Global Scenery");
        assert!(res.found);
        assert_eq!(res.runways.len(), 1);
        assert_eq!(res.ramps.len(), 1);
        assert_eq!(res.ramps[0].name, "G5");
        assert!(res.source_file.contains("Global Scenery"), "{}", res.source_file);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn xp12_custom_ini_pack_beats_gateway() {
        // Mismo ICAO en un custom listado y en el gateway: gana el custom.
        let base = xp12_fixture("priority");
        let custom = base.join("Custom Scenery");
        write_apt(
            &custom.join("TopPack").join("Earth nav data").join("apt.dat"),
            "1  10 0 0 XP12 Gateway Field\n100 60.00 1 0 0.25 0 0 0 09 5.00000000 6.00000000 0.00 0.00 0 0 0 0 27 5.01000000 6.00000000 0.00 0.00 0 0 0 0\n99\n",
        );
        std::fs::write(
            custom.join("scenery_packs.ini"),
            "SCENERY_PACK Custom Scenery/TopPack/\nSCENERY_PACK Custom Scenery/SomePack/\n",
        )
        .unwrap();
        let res = get_runways(
            "XP12".to_string(),
            Some(base.to_string_lossy().to_string()),
        )
        .expect("XP12 debe resolverse");
        assert!((res.runways[0].width_m - 60.0).abs() < 1e-9, "gana el custom del .ini");
        assert!(!res.source_file.contains("Global Scenery"), "{}", res.source_file);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn get_runways_prefers_gateway_over_global() {
        // GTWY existe en ambos: gana Global Airports (mayor prioridad que el
        // global), coherente con X-Plane.
        let base = gateway_fixture("gwglobal");
        write_apt(
            &base.join("Resources").join("default scenery").join("default apt dat").join("Earth nav data").join("apt.dat"),
            "1  10 0 0 GTWY Gateway Field\n100 20.00 1 0 0.25 0 0 0 09 5.00000000 6.00000000 0.00 0.00 0 0 0 0 27 5.01000000 6.00000000 0.00 0.00 0 0 0 0\n99\n",
        );
        let res = get_runways(
            "GTWY".to_string(),
            Some(base.to_string_lossy().to_string()),
        )
        .expect("GTWY debe resolverse");
        assert!(res.source_file.contains("Global Airports"), "{}", res.source_file);
        assert!((res.runways[0].width_m - 45.0).abs() < 1e-9, "ancho del gateway, no del global");
        let _ = std::fs::remove_dir_all(&base);
    }
}
