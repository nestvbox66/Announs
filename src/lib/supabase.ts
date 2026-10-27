import { createClient } from "@supabase/supabase-js";
import { isTauri } from "@tauri-apps/api/core";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("URL cargada:", supabaseUrl ? "Sí" : "No")
console.log("Key cargada:", supabaseAnonKey ? "Sí" : "No")

// En escritorio (Tauri) el callback OAuth no aterriza en la URL del WebView,
// sino en el deep link `announs://auth/callback` que se intercambia a mano
// con `exchangeCodeForSession`. Por eso se desactiva `detectSessionInUrl`:
// evita que el cliente intente parsear la URL del WebView y compita con el
// listener `onOpenUrl`. En web se conserva `true` (el flujo clásico lo necesita).
function inDesktop(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: !inDesktop(),
  },
});
