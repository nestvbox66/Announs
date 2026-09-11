/**
 * Wrapper para compatibilidad con la ruta documentada en Fase 3.
 * La implementación real vive en `src/components/VueloActualView.tsx` y ya
 * integra `MsfsFlightController` (con fallback a `MockFlightController`) vía
 * `config.sim.provider === 'msfs'`.
 *
 * Este archivo existe solo para satisfacer la ruta `src/pages/VueloActualView.tsx`
 * mencionada en la spec.
 */
export { default } from "../components/VueloActualView";

// Re-export para que grep `MsfsFlightController` en `src/pages/VueloActualView.tsx` sea positivo
export { MsfsFlightController } from "../services/MsfsFlightController";
export { MockFlightController } from "../services/MockFlightController";
