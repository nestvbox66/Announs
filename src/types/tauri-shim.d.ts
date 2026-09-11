declare module "@tauri-apps/api/core" {
  export function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  export function isTauri(): boolean;
}
declare module "@tauri-apps/api/tauri" {
  export function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}
declare module "@tauri-apps/api/event" {
  export function listen<T>(event: string, handler: (event: { payload: T; event: string; id: number }) => void): Promise<() => void>;
}
