/**
 * FlightPhotoService — "Foto de la Sesión" del reporte de vuelo.
 *
 * Flujo real (antes era un mock con `URL.createObjectURL` local):
 *  1) El usuario elige un `.jpg` / `.jpeg` / `.png` local.
 *  2) Se sube al bucket `flight-photos` en la ruta
 *     `{userId}/{flightId}_session_photo.jpg` (única por usuario y vuelo,
 *     con `upsert` para reemplazar reintentos).
 *  3) Se obtiene la URL pública y se persiste en `flights.photo_url`.
 *  4) `FlightDetailView` renderiza esa URL (ver `photoUrl` en
 *     `FlightHistoryService.loadFlightDetail`).
 */
import { supabase } from "../lib/supabase";
import { ServiceResult, ok, fail } from "./ServiceResult";

export const SESSION_PHOTO_BUCKET = "flight-photos";
/** Tope de 10 MB para no saturar Storage con fotos sin comprimir. */
export const SESSION_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);
const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

/** Ruta estructurada y única por usuario y vuelo. */
export function buildSessionPhotoPath(userId: string, flightId: string): string {
  return `${userId}/${flightId}_session_photo.jpg`;
}

function getExtension(fileName: string): string {
  const parts = (fileName || "").split(".");
  return parts.length > 1 ? (parts.pop() ?? "").toLowerCase() : "";
}

export class FlightPhotoService {
  /**
   * Valida el archivo local antes de subirlo (extensión, MIME y tamaño).
   * Devuelve `null` si es válido o el mensaje de error en español.
   */
  static validateSessionPhoto(file: File): string | null {
    const ext = getExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.has(ext)) {
      return "Formato no válido: elegí una imagen .jpg, .jpeg o .png.";
    }
    if (file.type && !ACCEPTED_MIME_TYPES.has(file.type.toLowerCase())) {
      return "Formato no válido: elegí una imagen .jpg, .jpeg o .png.";
    }
    if (file.size <= 0) {
      return "El archivo está vacío.";
    }
    if (file.size > SESSION_PHOTO_MAX_BYTES) {
      return "La imagen supera los 10 MB.";
    }
    return null;
  }

  /**
   * Sube la foto de la sesión y persiste su URL pública en
   * `flights.photo_url`. Resuelve con la URL pública.
   */
  static async uploadSessionPhoto(flightId: string, file: File): Promise<ServiceResult<string>> {
    try {
      if (!flightId) return fail("flight_id es obligatorio.");
      const validationError = FlightPhotoService.validateSessionPhoto(file);
      if (validationError) return fail(validationError);

      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        return fail("Sesión no válida: iniciá sesión para subir la foto.");
      }

      const path = buildSessionPhotoPath(user.id, flightId);
      const { error: uploadError } = await supabase.storage
        .from(SESSION_PHOTO_BUCKET)
        .upload(path, file, {
          upsert: true,
          contentType: file.type || "image/jpeg",
        });
      if (uploadError) return fail(uploadError.message);

      const { data: urlData } = supabase.storage
        .from(SESSION_PHOTO_BUCKET)
        .getPublicUrl(path);
      const publicUrl = urlData?.publicUrl ?? "";
      if (!publicUrl) return fail("No se pudo obtener la URL pública de la foto.");

      const { error: updateError } = await supabase
        .from("flights")
        .update({ photo_url: publicUrl })
        .eq("id", flightId)
        .eq("user_id", user.id);
      if (updateError) return fail(updateError.message);

      return ok(publicUrl);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
}
