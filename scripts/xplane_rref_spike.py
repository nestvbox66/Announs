#!/usr/bin/env python3
"""X-Plane 12 sintético para el spike de validación Fase 0 (solo stdlib).

Escucha RREF en 127.0.0.1:49000 como un X-Plane real:
  - Recibe suscripciones `RREF\\0 + i32 freq + i32 id + 400B dataref`.
  - Responde `RREF, + (i32 id + f32 valor)*` a la frecuencia pedida.
  - Guioniza un vuelo puerta -> crucero para validar el receptor Rust
    (`src-tauri/src/xplane.rs`) sin tener X-Plane instalado.

Uso:
    python scripts/xplane_rref_spike.py --serve [--port 49000]

Ver docs/xplane-phase0-spike.md §5a.
"""

from __future__ import annotations

import argparse
import socket
import struct
import threading
import time

HOST = "127.0.0.1"
PORT = 49000

MS_TO_KT = 1.943844


def scenario_value(dataref: str, t: float) -> float:
    """Valor crudo en unidades X-Plane para un dataref en el instante t (s)."""
    airborne = t >= 25.0
    preflight = 15.0 <= t < 25.0

    if dataref == "sim/cockpit2/gauges/indicators/altitude_ft_pilot":
        return 35000.0 if airborne else 150.0
    if dataref == "sim/flightmodel/position/groundspeed":
        return (450.0 / MS_TO_KT) if airborne else 0.0
    if dataref == "sim/cockpit2/gauges/indicators/vvi_fpm_pilot":
        return 0.0
    if dataref == "sim/flightmodel/position/magpsi":
        return 180.0
    if dataref == "sim/flightmodel/position/latitude":
        return -34.8222
    if dataref == "sim/flightmodel/position/longitude":
        return -58.5358
    if dataref == "sim/cockpit2/gauges/indicators/airspeed_kts_pilot":
        return 280.0 if airborne else 0.0
    if dataref == "sim/flightmodel/position/true_airspeed":
        return (480.0 / MS_TO_KT) if airborne else 0.0
    if dataref == "sim/flightmodel/controls/parkbrake":
        return 0.0 if airborne else (0.0 if preflight else 1.0)
    if dataref.startswith("sim/flightmodel/engine/ENGN_running"):
        return 1.0 if (airborne or preflight) else 0.0
    if dataref == "sim/aircraft/engine/acf_num_engines":
        return 2.0
    if dataref.startswith("sim/flightmodel2/misc/door_open_ratio"):
        return 0.0 if (airborne or preflight) else 1.0
    if dataref == "sim/flightmodel2/misc/canopy_open_ratio":
        return 0.0
    if dataref.startswith("sim/flightmodel2/gear/on_ground"):
        return 0.0 if airborne else 1.0
    if dataref == "sim/flightmodel/position/y_agl":
        return 10668.0 if airborne else 0.5
    if dataref == "sim/cockpit2/gauges/indicators/radio_altimeter_height_ft_pilot":
        return 0.0 if airborne else 0.0
    if dataref.startswith("sim/aircraft/parts/acf_gear_deploy"):
        return 0.0 if airborne else 1.0
    if dataref == "sim/cockpit2/switches/taxi_light_on":
        return 0.0 if airborne else 1.0
    if dataref == "sim/cockpit2/switches/landing_lights_on":
        return 1.0 if airborne else 0.0
    if dataref == "sim/cockpit2/switches/strobe_lights_on":
        return 1.0
    if dataref == "sim/cockpit2/switches/beacon_on":
        return 1.0
    if dataref == "sim/cockpit2/annunciators/fasten_seatbelt":
        return 1.0 if (airborne or preflight) else 0.0
    if dataref == "sim/time/zulu_time_sec":
        return 43200.0 + t
    if dataref == "sim/time/local_time_sec":
        return 36000.0 + t
    if dataref == "sim/weather/temperature_ambient_c":
        return 15.0
    if dataref == "sim/weather/wind_speed_kt":
        return 10.0
    if dataref == "sim/weather/wind_direction_degt":
        return 270.0
    # DataRef desconocido: X-Plane real simplemente no responde; aquí 0.0.
    return 0.0


def parse_rref_request(packet: bytes):
    """Devuelve (freq, id, dataref) o None si malformado."""
    if len(packet) < 413 or packet[0:4] != b"RREF" or packet[4] != 0:
        return None
    freq = struct.unpack_from("<i", packet, 5)[0]
    ref_id = struct.unpack_from("<i", packet, 9)[0]
    raw = packet[13:413]
    dataref = raw.split(b"\x00", 1)[0].decode("utf-8", errors="replace")
    return freq, ref_id, dataref


def build_rref_response(records: list[tuple[int, float]]) -> bytes:
    buf = bytearray(b"RREF,")
    for ref_id, value in records:
        buf += struct.pack("<i", ref_id)
        buf += struct.pack("<f", value)
    return bytes(buf)


def serve(port: int) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((HOST, port))
    sock.settimeout(0.2)
    # Como el X-Plane real (que escucha en 49000 pero responde desde su puerto
    # de envío legacy 49001), las respuestas salen por un socket DISTINTO al
    # de escucha. Esto es intencional: valida que el receptor acepte respuestas
    # de cualquier origen (regresión del bug del socket "conectado").
    tx_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    tx_sock.bind((HOST, 0))
    print(
        f"[spike] falso X-Plane escuchando en {HOST}:{port}, "
        f"respondiendo desde {tx_sock.getsockname()}",
        flush=True,
    )

    subs: dict[int, tuple[str, int, tuple[str, int]]] = {}
    lock = threading.Lock()
    stop = threading.Event()
    t0 = time.monotonic()

    def sender() -> None:
        last_sent: dict[int, float] = {}
        while not stop.is_set():
            now = time.monotonic()
            t = now - t0
            with lock:
                items = list(subs.items())
            due: list[tuple[int, float]] = []
            addrs: set[tuple[str, int]] = set()
            for ref_id, (dataref, freq, addr) in items:
                if freq <= 0:
                    continue
                period = 1.0 / freq
                if now - last_sent.get(ref_id, 0.0) >= period:
                    due.append((ref_id, scenario_value(dataref, t)))
                    addrs.add(addr)
                    last_sent[ref_id] = now
            if due:
                packet = build_rref_response(due)
                for addr in addrs:
                    try:
                        tx_sock.sendto(packet, addr)
                    except OSError:
                        pass
            time.sleep(0.02)

    thread = threading.Thread(target=sender, daemon=True)
    thread.start()
    try:
        while True:
            try:
                packet, addr = sock.recvfrom(1024)
            except socket.timeout:
                continue
            parsed = parse_rref_request(packet)
            if parsed is None:
                continue
            freq, ref_id, dataref = parsed
            with lock:
                if freq <= 0:
                    subs.pop(ref_id, None)
                    print(f"[spike] unsubscribe id={ref_id}", flush=True)
                else:
                    subs[ref_id] = (dataref, freq, addr)
                    print(
                        f"[spike] subscribe id={ref_id} freq={freq} "
                        f"dataref={dataref} from={addr}",
                        flush=True,
                    )
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        thread.join(timeout=1.0)
        sock.close()
        tx_sock.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", action="store_true", help="inicia el falso X-Plane")
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    if not args.serve:
        parser.print_help()
        return
    serve(args.port)


if __name__ == "__main__":
    main()
