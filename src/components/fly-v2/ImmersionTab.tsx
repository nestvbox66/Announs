/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pestaña Immersion del Flight Setup: música de embarque/desembarque y
 * ritmo de embarque con la funcionalidad real de la vista original, vestida
 * con el lenguaje visual de las tarjetas de evento (marco 1pt, fondo
 * `#001626`, padding 16, tipografías del sistema).
 * Fuente de verdad visual: `docs/ui-spec-fly.md` + `FlightEventCard`.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { C, FONT_BAHN } from "./tokens";
import { supabase } from "../../lib/supabase";
import { BoardingMusicService } from "../../services/BoardingMusicService";
import type { BoardingMusicTrack } from "../../services/BoardingMusicService";
import {
  boardingAudioPackService,
  BOARDING_AUDIO_PACKAGE_STORAGE_KEY,
  BOARDING_AUDIO_SOURCE_STORAGE_KEY,
  toBoardingAudioSource,
} from "../../services/BoardingAudioPackService";
import type { BoardingAudioSource } from "../../services/BoardingAudioPackService";
import type { PackageRecord } from "../../services/PackagesService";
import { RANDOM_MUSIC_ID } from "../../services/MusicController";
import {
  DEFAULT_BOARDING_MUSIC_ID,
  normalizeBoardingMusicTrackId,
} from "../../utils/boardingMusicSelection";
import MusicPreview from "../music/MusicPreview";
import BoardingAudioPackSelector from "../packages/BoardingAudioPackSelector";
import {
  BOARDING_PACE_MAX_PPM,
  BOARDING_PACE_MIN_PPM,
  BOARDING_PACE_STORAGE_KEY,
  BOARDING_PACE_DEFAULT_PPM,
  clampBoardingPace,
  estimateBoardingSeconds,
  formatEtaMinSec,
} from "../../utils/flightUtils";

export interface ImmersionTabProps {
  /** Pasajeros del manifiesto (para el ETA de embarque). */
  passengerCount: number;
  /** ICAO de la aerolínea (filtra los packages de la comunidad). */
  airlineIcao: string | null;
}

const CARD_STYLE: CSSProperties = {
  border: `1px solid ${C.sky}`,
  background: C.navyDeep,
  borderRadius: 0,
  padding: 16,
};

const TITLE_STYLE: CSSProperties = {
  fontFamily: FONT_BAHN,
  fontWeight: 700,
  fontStretch: "semi-condensed",
  fontSize: 16,
  color: C.white,
  lineHeight: 1.25,
  margin: 0,
};

const DESCRIPTION_STYLE: CSSProperties = {
  fontFamily: FONT_BAHN,
  fontWeight: 400,
  fontStretch: "condensed",
  fontSize: 13,
  color: C.ice,
  lineHeight: 1.45,
  marginTop: 8,
  marginBottom: 0,
  flexGrow: 1,
};

const FIELD_LABEL_STYLE: CSSProperties = {
  display: "block",
  fontFamily: FONT_BAHN,
  fontWeight: 400,
  fontStretch: "condensed",
  textTransform: "uppercase",
  fontSize: 12,
  letterSpacing: "0.08em",
  color: C.ice,
  lineHeight: 1.3,
  marginBottom: 4,
};

export interface DuoOption {
  value: string;
  label: string;
  activeFill: string;
  activeBorder: string;
}

/**
 * Conmutador compacto de 2 vías con el lenguaje del sistema (radio 0).
 * Exportado para reutilizar en otras pestañas del setup (Special Cabin).
 */
export function DuoToggle({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly [DuoOption, DuoOption];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex"
      style={{
        height: 24,
        border: `1px solid ${C.divider}`,
        borderRadius: 0,
        overflow: "hidden",
      }}
    >
      {options.map((option, index) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className="flex-1 cursor-pointer"
            style={{
              fontFamily: FONT_BAHN,
              fontWeight: 400,
              fontStretch: "condensed",
              textTransform: "uppercase",
              fontSize: 11,
              letterSpacing: "0.08em",
              lineHeight: 1,
              color: isActive ? C.white : C.ice,
              background: isActive ? option.activeFill : "transparent",
              boxShadow: isActive
                ? `inset 0 0 0 1px ${option.activeBorder}`
                : undefined,
              borderLeft: index > 0 ? `1px solid ${C.divider}` : undefined,
              borderRadius: 0,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Almacenamiento no disponible: la selección sigue en memoria.
  }
}

async function persistGlobal(
  userId: string | null,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!userId) return;
  try {
    await supabase
      .from("setting_general")
      .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
  } catch {
    // Best-effort: localStorage ya conserva el valor.
  }
}

export function ImmersionTab({ passengerCount, airlineIcao }: ImmersionTabProps) {
  const { t } = useTranslation();
  const [userId, setUserId] = useState<string | null>(null);

  // Música de embarque / desembarque.
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [musicTracks, setMusicTracks] = useState<BoardingMusicTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [trackId, setTrackId] = useState(DEFAULT_BOARDING_MUSIC_ID);
  const [audioSource, setAudioSource] =
    useState<BoardingAudioSource>("ia");
  const [audioPackage, setAudioPackage] = useState<PackageRecord | null>(null);
  const [storedPackId] = useState<string | null>(() =>
    readStored(BOARDING_AUDIO_PACKAGE_STORAGE_KEY),
  );

  // Ritmo de embarque: default global del perfil + override por vista
  // (null = usar el global), igual que la vista original.
  const [paceGlobal, setPaceGlobal] = useState(BOARDING_PACE_DEFAULT_PPM);
  const [paceOverride, setPaceOverride] = useState<number | null>(null);
  const effectivePace = paceOverride ?? paceGlobal;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled) setUserId(user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Catálogo de pistas (`boarding_music`, público como `languages`).
      setTracksLoading(true);
      try {
        const result = await BoardingMusicService.listActiveTracks();
        if (!cancelled && result.success && result.data) {
          setMusicTracks(result.data);
          // Migración retrocompatible: un nombre guardado (esquema anterior)
          // se convierte al id de la pista correspondiente.
          setTrackId((prev) => {
            if (!prev) return DEFAULT_BOARDING_MUSIC_ID;
            if (result.data!.some((track) => track.id === prev)) return prev;
            const byName = result.data!.find((track) => track.name === prev);
            if (prev === RANDOM_MUSIC_ID) return prev;
            return byName ? byName.id : DEFAULT_BOARDING_MUSIC_ID;
          });
        }
      } catch {
        // Sin catálogo: el selector queda en "Música al azar".
      } finally {
        if (!cancelled) setTracksLoading(false);
      }
      if (!userId) return;
      // Defaults globales del perfil (`setting_general` + localStorage).
      try {
        const { data } = await supabase
          .from("setting_general")
          .select(
            "play_boarding_music, song_boarding_music, boarding_music_source, boarding_pax_per_minute",
          )
          .eq("user_id", userId)
          .maybeSingle();
        if (cancelled) return;
        const row = (data ?? {}) as Record<string, unknown>;
        if (typeof row.play_boarding_music === "boolean") {
          setMusicEnabled(row.play_boarding_music);
        } else {
          const stored = readStored("cfg_play_boarding_music");
          if (stored != null) setMusicEnabled(stored === "true");
        }
        if (
          typeof row.song_boarding_music === "string" &&
          row.song_boarding_music !== ""
        ) {
          setTrackId(normalizeBoardingMusicTrackId(row.song_boarding_music));
        } else {
          const stored = readStored("cfg_song_boarding_music");
          if (stored != null) setTrackId(normalizeBoardingMusicTrackId(stored));
        }
        if (typeof row.boarding_music_source === "string") {
          setAudioSource(toBoardingAudioSource(row.boarding_music_source));
        } else {
          setAudioSource(
            toBoardingAudioSource(readStored(BOARDING_AUDIO_SOURCE_STORAGE_KEY)),
          );
        }
        if (typeof row.boarding_pax_per_minute === "number") {
          setPaceGlobal(clampBoardingPace(row.boarding_pax_per_minute));
        } else {
          const stored = readStored(BOARDING_PACE_STORAGE_KEY);
          if (stored != null) setPaceGlobal(clampBoardingPace(Number(stored)));
        }
      } catch {
        // Sin perfil: quedan los defaults locales.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleToggleMusic = (enabled: boolean) => {
    setMusicEnabled(enabled);
    writeStored("cfg_play_boarding_music", String(enabled));
    void persistGlobal(userId, { play_boarding_music: enabled });
  };

  const handleTrackChange = (id: string) => {
    setTrackId(id);
    writeStored("cfg_song_boarding_music", id);
    void persistGlobal(userId, { song_boarding_music: id });
  };

  const handleSourceChange = (source: BoardingAudioSource) => {
    setAudioSource(source);
    writeStored(BOARDING_AUDIO_SOURCE_STORAGE_KEY, source);
    void persistGlobal(userId, { boarding_music_source: source });
  };

  const handlePackChange = (pkg: PackageRecord | null) => {
    setAudioPackage(pkg);
    if (pkg) {
      writeStored(BOARDING_AUDIO_PACKAGE_STORAGE_KEY, pkg.id);
      boardingAudioPackService.setActivePackage(pkg);
    } else {
      try {
        localStorage.removeItem(BOARDING_AUDIO_PACKAGE_STORAGE_KEY);
      } catch {
        // ignorar
      }
    }
  };

  const selectedTrack =
    musicTracks.find((track) => track.id === trackId) ?? null;
  const etaSeconds = estimateBoardingSeconds(passengerCount, effectivePace);

  return (
    <>
      {/* Música de embarque y desembarque */}
      <article
        data-testid="immersion-music-card"
        className="flex h-full flex-col"
        style={{ ...CARD_STYLE, gridColumn: "span 2" }}
      >
        <h3 style={TITLE_STYLE}>
          {t("current_flight.not_started.immersion.music.brief")}
        </h3>
        <p style={DESCRIPTION_STYLE}>
          {t("current_flight.not_started.immersion.music.deep")}
        </p>

        <div style={{ marginTop: 12, maxWidth: 220 }}>
          <DuoToggle
            ariaLabel={t("current_flight.not_started.immersion.music.brief")}
            value={musicEnabled ? "yes" : "no"}
            onChange={(v) => handleToggleMusic(v === "yes")}
            options={[
              {
                value: "yes",
                label: t("current_flight.not_started.immersion.yes"),
                activeFill: C.greenBase,
                activeBorder: C.green,
              },
              {
                value: "no",
                label: t("current_flight.not_started.immersion.no"),
                activeFill: C.offActiveFill,
                activeBorder: C.offActiveBorder,
              },
            ]}
          />
        </div>

        {musicEnabled && (
          <>
            <div style={{ marginTop: 12 }}>
              <label
                htmlFor="fly-v2-music-track"
                style={FIELD_LABEL_STYLE}
              >
                {t("current_flight.not_started.immersion.track_label")}
              </label>
              <div className="flex items-center" style={{ gap: 8 }}>
                <select
                  id="fly-v2-music-track"
                  value={trackId}
                  onChange={(event) => handleTrackChange(event.target.value)}
                  disabled={tracksLoading}
                  className="w-full"
                  style={{
                    appearance: "none",
                    height: 36,
                    maxWidth: 280,
                    background: C.selectFill,
                    border: `1px solid ${C.sky}`,
                    borderRadius: 0,
                    color: C.white,
                    fontFamily: FONT_BAHN,
                    fontWeight: 400,
                    fontStretch: "condensed",
                    fontSize: 14,
                    paddingLeft: 12,
                    paddingRight: 12,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value={RANDOM_MUSIC_ID}>{t("music.random")}</option>
                  {tracksLoading ? (
                    <option value="" disabled>
                      {t("music.loading_tracks")}
                    </option>
                  ) : (
                    musicTracks.map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.name}
                      </option>
                    ))
                  )}
                </select>
                <MusicPreview
                  cleanUrl={selectedTrack?.cleanUrl ?? null}
                  previewUrl={selectedTrack?.previewUrl ?? null}
                />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <span style={FIELD_LABEL_STYLE}>
                {t("current_flight.not_started.immersion.source_label")}
              </span>
              <div style={{ maxWidth: 220 }}>
                <DuoToggle
                  ariaLabel={t(
                    "current_flight.not_started.immersion.source_label",
                  )}
                  value={audioSource}
                  onChange={(v) =>
                    handleSourceChange(v as BoardingAudioSource)
                  }
                  options={[
                    {
                      value: "ia",
                      label: t(
                        "current_flight.not_started.events.mode_ia",
                      ),
                      activeFill: C.selectActiveFill,
                      activeBorder: C.skySoft,
                    },
                    {
                      value: "pack",
                      label: t(
                        "current_flight.not_started.events.mode_pack",
                      ),
                      activeFill: C.orangeDark,
                      activeBorder: C.orange,
                    },
                  ]}
                />
              </div>
              {audioSource === "pack" && (
                <div style={{ marginTop: 8 }}>
                  <BoardingAudioPackSelector
                    airlineIcao={airlineIcao}
                    value={audioPackage?.id ?? storedPackId}
                    onChange={handlePackChange}
                    idPrefix="fly-v2-boarding-pack"
                    title={
                      audioPackage
                        ? `${t("boarding_pack.selector_title")} - ${audioPackage.package_name}`
                        : t("boarding_pack.selector_title")
                    }
                  />
                </div>
              )}
            </div>
          </>
        )}
      </article>

      {/* Ritmo de embarque */}
      <article
        data-testid="immersion-pace-card"
        className="flex h-full flex-col"
        style={CARD_STYLE}
      >
        <h3 style={TITLE_STYLE}>
          {t("current_flight.not_started.immersion.pace.brief")}{" "}
          {paceOverride != null && (
            <span
              style={{
                fontFamily: FONT_BAHN,
                fontWeight: 700,
                fontStretch: "condensed",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: C.orange,
                border: `1px solid ${C.orange}`,
                background: C.orangeDark,
                borderRadius: 0,
                padding: "2px 6px",
                marginLeft: 8,
                whiteSpace: "nowrap",
              }}
            >
              {t("current_flight.not_started.immersion.pace_global", {
                count: paceGlobal,
              })}
            </span>
          )}
        </h3>
        <p style={DESCRIPTION_STYLE}>
          {t("current_flight.not_started.immersion.pace_eta", {
            time: formatEtaMinSec(etaSeconds),
            count: passengerCount,
          })}
        </p>

        <div style={{ marginTop: 12 }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <input
              type="range"
              min={BOARDING_PACE_MIN_PPM}
              max={BOARDING_PACE_MAX_PPM}
              step={5}
              value={effectivePace}
              onChange={(event) =>
                setPaceOverride(clampBoardingPace(Number(event.target.value)))
              }
              className="flex-1 cursor-pointer"
              style={{ accentColor: C.sky }}
              aria-label={t("current_flight.not_started.immersion.pace.brief")}
            />
            <span
              style={{
                fontFamily: FONT_BAHN,
                fontWeight: 700,
                fontStretch: "condensed",
                fontSize: 13,
                color: C.green,
                whiteSpace: "nowrap",
              }}
            >
              {t("current_flight.not_started.immersion.pace_value", {
                count: effectivePace,
              })}
            </span>
          </div>
          {paceOverride != null && (
            <button
              type="button"
              onClick={() => setPaceOverride(null)}
              className="cursor-pointer hover:underline"
              style={{
                marginTop: 8,
                background: "transparent",
                border: 0,
                borderRadius: 0,
                padding: 0,
                fontFamily: FONT_BAHN,
                fontWeight: 700,
                fontStretch: "condensed",
                fontSize: 12,
                color: C.sky,
              }}
            >
              {t("current_flight.not_started.immersion.pace_reset")}
            </button>
          )}
        </div>
      </article>
    </>
  );
}
