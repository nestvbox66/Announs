import { EventDefinition } from "../events/types";
import { FlightContext } from "../services/FlightContext";
import { EventDispatcher } from "./EventDispatcher";
import { EventHandler } from "./handlers/EventHandler";

export class DefaultEventDispatcher implements EventDispatcher {
  private handlers: EventHandler[];
  private dispatchCallId = 0;

  constructor(handlers: EventHandler[] = []) {
    this.handlers = handlers;
  }

  register(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  async dispatch(event: EventDefinition, context: FlightContext): Promise<void> {
    this.dispatchCallId++;
    const callId = this.dispatchCallId;

    console.log("[DISPATCH TRACE]");
    console.log("event: " + event.eventKey);
    console.log("callId: " + callId);
    console.log("source: dispatcher.dispatch");

    for (const handler of this.handlers) {
      console.log("[DISPATCHER]");
      console.log("Dispatching:");
      console.log(event.eventKey);
      console.log("↓");
      console.log(handler.constructor.name);
      console.log("↓");
      console.log("AnnouncementQueue");
      await handler.handle(event, context);
    }
  }
}
