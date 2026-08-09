import { FlightPhase } from "../engine/FlightEngine";
import { EventCatalog } from "./EventCatalog";
import { BoardingEventCatalog } from "./boarding/BoardingEventCatalog";
import { EventDefinition } from "./types";

const registry = new Map<string, EventDefinition>();

for (const definition of Object.values(EventCatalog)) {
  registry.set(definition.eventKey, definition);
}

for (const [eventKey, definition] of BoardingEventCatalog) {
  registry.set(eventKey, definition);
}

export class EventCatalogService {
  static get(eventKey: string): EventDefinition | undefined {
    const definition = registry.get(eventKey);
    console.log("[CATALOG]");
    console.log("Event resolved");
    console.log(eventKey);
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
