/**
 * Siluetas de tipos de aeronave (uso local).
 *
 * Los archivos viven en `src/assets/aircraft-silhouettes/{CATEGORIA}.{ext}` y
 * se resuelven en build-time vía `import.meta.glob`, por lo que funcionan
 * offline y en el bundle de Tauri.
 *
 * Atribución: `B727.svg`, `B737.svg` y `B767.svg` derivan de siluetas de
 * Wikimedia Commons (CC BY-SA 4.0).
 */

const EXTENSIONS = ["jpg", "jpeg", "png", "svg"] as const;

/** Mapa NOMBRE-ARCHIVO (tal cual, sin normalizar) → URL empaquetada. */
const filesByName: Record<string, string> = (() => {
  const modules = import.meta.glob<string>("../assets/aircraft-silhouettes/*.{png,jpg,jpeg,svg}", {
    eager: true,
    query: "?url",
    import: "default",
  });
  const map: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    const file = path.split("/").pop() ?? "";
    if (file) map[file] = url as string;
  }
  return map;
})();

/** Cantidad de archivos disponibles (diagnóstico). */
export const AIRCRAFT_SILHOUETTE_FILE_COUNT = Object.keys(filesByName).length;

function findFile(baseName: string): string | null {
  const clean = (baseName ?? "").trim();
  if (!clean) return null;
  // Coincidencia exacta primero (p. ej. "B737.JPG"), luego por extensión.
  if (filesByName[clean]) return filesByName[clean];
  const upper = clean.toUpperCase();
  for (const ext of EXTENSIONS) {
    const hit = filesByName[`${upper}.${ext}`] ?? filesByName[`${upper}.${ext.toUpperCase()}`];
    if (hit) return hit;
  }
  return null;
}

/**
 * ¿Existe imagen local para esta categoría (sin contar el fallback NULL)?
 */
export function hasAircraftSilhouette(category: string | null | undefined): boolean {
  const clean = (category ?? "").trim();
  if (!clean) return false;
  if (filesByName[clean]) return true;
  const upper = clean.toUpperCase();
  return EXTENSIONS.some(
    (ext) => filesByName[`${upper}.${ext}`] ?? filesByName[`${upper}.${ext.toUpperCase()}`]
  );
}

/**
 * URL local de la silueta según la categoría del avión (`flights.aircraft_type`,
 * p. ej. "B737"). Si la categoría es nula, no existe imagen o falla la
 * búsqueda, recurre automáticamente a la genérica `NULL`.
 */
export function getAircraftSilhouette(category: string | null | undefined): string {
  const direct = category ? findFile(category) : null;
  if (direct) return direct;
  const fallback =
    findFile("NULL") ??
    "data:image/svg+xml," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="80"><rect width="260" height="80" rx="4" fill="#fff"/><text x="130" y="46" font-family="monospace" font-size="28" text-anchor="middle" fill="#94a3b8">✈</text></svg>`
      );
  return fallback;
}
