import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "../locales/es.json";
import en from "../locales/en.json";

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en }
  },
  lng: localStorage.getItem("announs_language") || "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false
  }
});

// En desarrollo, si cambian los archivos de locales, actualizar los bundles
// en caliente: i18next ya inicializado NO re-lee los recursos por HMR, por
// lo que las claves nuevas se verían en crudo (p. ej. "config.xxx"). Se
// reinyectan los bundles actualizados y recién ahí se invalida.
if (import.meta.hot) {
  import.meta.hot.accept(
    ["../locales/es.json", "../locales/en.json"],
    (modules) => {
      try {
        const [esMod, enMod] = modules ?? [];
        const esDict = (esMod as unknown as { default?: unknown })?.default ?? esMod;
        const enDict = (enMod as unknown as { default?: unknown })?.default ?? enMod;
        if (esDict && typeof esDict === "object") {
          i18n.addResourceBundle("es", "translation", esDict as Record<string, unknown>, true, true);
        }
        if (enDict && typeof enDict === "object") {
          i18n.addResourceBundle("en", "translation", enDict as Record<string, unknown>, true, true);
        }
      } catch {
        // Si falla la inyección, la invalidación fuerza recarga completa.
      }
      import.meta.hot?.invalidate();
    }
  );
}

export default i18n;
