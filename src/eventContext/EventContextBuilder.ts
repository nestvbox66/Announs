import { FlightContext } from "../services/FlightContext";
import { EventContext } from "./types";
import { buildGateContext } from "./builders/gate";

type BuilderFn = (eventKey: string, fc: FlightContext) => EventContext;

const builders = new Map<string, BuilderFn>();

// Map known event keys to their builders
const knownEvents: [string[], BuilderFn][] = [
  [["gate_crew_start_soon", "gate_crew_started"], buildGateContext],
];

for (const [keys, fn] of knownEvents) {
  for (const key of keys) {
    builders.set(key, fn);
  }
}

const fallback: BuilderFn = (eventKey, _fc) => ({
  eventKey,
  eventData: {},
});

export class EventContextBuilder {
  static build(eventKey: string, fc: FlightContext): EventContext {
    const builder = builders.get(eventKey) ?? fallback;
    const context = builder(eventKey, fc);

    console.log("[EVENT CONTEXT]");
    console.log("Event: " + context.eventKey);
    console.log("Generated Context:");
    console.log(JSON.stringify(context.eventData, null, 2));

    return context;
  }
}
