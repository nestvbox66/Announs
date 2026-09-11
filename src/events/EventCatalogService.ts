import { FlightPhase } from "../engine/FlightEngine";
import { EventCatalog } from "./EventCatalog";
import { BoardingEventCatalog } from "./boarding/BoardingEventCatalog";
import { FlightEvents } from "./flightEvents";
import { EventDefinition } from "./types";

const registry = new Map<string, EventDefinition>();

for (const definition of Object.values(EventCatalog)) {
  registry.set(definition.eventKey, definition);
}

for (const [eventKey, definition] of BoardingEventCatalog) {
  registry.set(eventKey, definition);
}

for (const [eventKey, definition] of Object.entries(FlightEvents)) {
  registry.set(eventKey, definition);
}

console.log(
  `[EventCatalogService] Catálogo listo: ${registry.size} eventos registrados (código).`
);

// Logs de depuración del catálogo. Se consulta MUY seguido (por evento, por
// fase, por cada dispatch), así que por defecto está silenciado.
const DEBUG_CATALOG = false;

export class EventCatalogService {
  static get(eventKey: string): EventDefinition | undefined {
    const definition = registry.get(eventKey);
    if (DEBUG_CATALOG) {
      console.log("[CATALOG]");
      console.log("Event resolved");
      console.log(eventKey);
    }
    if (!definition) {
      console.warn(
        `[EventCatalogService] Evento '${eventKey}' no registrado en el catálogo; se omitirá el paso.`
      );
    }
    return definition;
  }

  static getAll(): EventDefinition[] {
    return Array.from(registry.values());
  }

  static getByPhase(phase: FlightPhase): EventDefinition[] {
    return Array.from(registry.values()).filter((ev) => ev.phase === phase);
  }

  static getManualEvents(phase: FlightPhase): EventDefinition[] {
    return Array.from(registry.values()).filter(
      (ev) => ev.phase === phase && ev.triggerType === "manual"
    );
  }
}
