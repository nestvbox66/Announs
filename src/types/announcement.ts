export interface AnnouncementParams {
  eventKey: string;
  flightId: string | null;
  languageId: string;
  eventData?: Record<string, string>;
}

export type AnnouncementEvent =
  | "generating"
  | "announcement"
  | "playing"
  | "error";
