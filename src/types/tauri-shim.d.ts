declare module "@tauri-apps/api/core" {
  export function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  export function isTauri(): boolean;
}
declare module "@tauri-apps/api/tauri" {
  export function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}
declare module "@tauri-apps/plugin-deep-link" {
  export function onOpenUrl(handler: (urls: string[]) => void | Promise<void>): Promise<() => void>;
  export function getCurrent(): Promise<string[] | null>;
}
declare module "@tauri-apps/plugin-shell" {
  export function open(url: string): Promise<void>;
}
declare module "@tauri-apps/api/event" {
  export function listen<T>(event: string, handler: (event: { payload: T; event: string; id: number }) => void): Promise<() => void>;
}
