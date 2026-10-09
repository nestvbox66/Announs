/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Selector de Packages de Seguridad (`safety_video`) para
 * `taxi_crew_safety_brief` en modo `PACK`. Envoltorio fino del selector
 * genérico de la comunidad (misma API histórica).
 */

import CommunityPackSelector from "./CommunityPackSelector";
import {
  isGenericSafetyPackage,
  normalizeAirlineIcao,
  safetyVideoPackService,
} from "../../services/SafetyVideoPackService";
import type { PackageRecord } from "../../services/PackagesService";

interface SafetyVideoPackSelectorProps {
  /** ICAO de la aerolínea del vuelo (null = todos, pantalla de preferencias). */
  airlineIcao: string | null;
  /** Id del package seleccionado (null = ninguno). */
  value: string | null;
  /** Se invoca al (auto)seleccionar un package, o con null si no hay. */
  onChange: (pkg: PackageRecord | null) => void;
  /** Deshabilita el selector (p. ej. vuelo en curso). */
  disabled?: boolean;
  /** Prefijo para los ids del DOM (evita duplicados entre pantallas). */
  idPrefix?: string;
}

export default function SafetyVideoPackSelector({
  airlineIcao,
  value,
  onChange,
  disabled = false,
  idPrefix = "safety-pack",
}: SafetyVideoPackSelectorProps) {
  return (
    <CommunityPackSelector
      load={(icao) => safetyVideoPackService.listSafetyVideosForAirline(icao)}
      tPrefix="safety_pack"
      isGeneric={isGenericSafetyPackage}
      normalizeIcao={normalizeAirlineIcao}
      airlineIcao={airlineIcao}
      value={value}
      onChange={onChange}
      disabled={disabled}
      idPrefix={idPrefix}
    />
  );
}
