import { FlightPhase } from "../engine/FlightEngine";
import { EventDefinition } from "./types";

export const EventCatalog = {
  gate_crew_start_soon: {
    eventKey: "gate_crew_start_soon",
    phase: FlightPhase.BOARDING,
    triggerType: "manual",
    enabledSwitch: "gate_crew_start_soon",
    priority: 10,
    blocking: false,
    // Tripulación en puerta (voz crew). Sin rol, la Edge Function resolvía
    // locutor por defecto y caía en la voz española (Mía) aun con EN/Amy.
    speakerRole: "crew",
    description: "Aviso de embarque próximo a comenzar"
  },
  gate_crew_started: {
    eventKey: "gate_crew_started",
    phase: FlightPhase.BOARDING,
    triggerType: "manual",
    enabledSwitch: "gate_crew_started",
    priority: 20,
    blocking: false,
    // Tripulación en puerta (voz crew). Ver nota en gate_crew_start_soon.
    speakerRole: "crew",
    description: "Inicio oficial del embarque"
  }
} satisfies Record<string, EventDefinition>;
