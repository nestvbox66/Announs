/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Selector de Packages de audio de embarque (`boarding_audio`) para la
 * música de embarque/desembarque en modo `pack`. Envoltorio fino del selector
 * genérico de la comunidad.
 */

import CommunityPackSelector from "./CommunityPackSelector";
import {
  boardingAudioPackService,
  isGenericBoardingPackage,
  normalizeBoardingAirlineIcao,
} from "../../services/BoardingAudioPackService";
import type { PackageRecord } from "../../services/PackagesService";

interface BoardingAudioPackSelectorProps {
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
  /** Título opcional ("Audio ... - [Nombre]"). */
  title?: string | null;
}

export default function BoardingAudioPackSelector({
  airlineIcao,
  value,
  onChange,
  disabled = false,
  idPrefix = "boarding-pack",
  title = null,
}: BoardingAudioPackSelectorProps) {
  return (
    <CommunityPackSelector
      load={(icao) => boardingAudioPackService.listBoardingAudiosForAirline(icao)}
      tPrefix="boarding_pack"
      isGeneric={isGenericBoardingPackage}
      normalizeIcao={normalizeBoardingAirlineIcao}
      airlineIcao={airlineIcao}
      value={value}
      onChange={onChange}
      disabled={disabled}
      idPrefix={idPrefix}
      title={title}
    />
  );
}
