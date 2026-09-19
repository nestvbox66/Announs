export const config = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "",
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "",
  sim: {
    provider: (import.meta.env.VITE_SIM_PROVIDER as "msfs" | "xplane" | "mock" | undefined) ?? "mock",
    autoConnect: (import.meta.env.VITE_SIM_AUTOCONNECT as string | undefined) === "true",
    pollInterval: Number(import.meta.env.VITE_SIM_POLL_INTERVAL as string | undefined) || 100,
  },
  mock: {
    enabled: (import.meta.env.VITE_MOCK_ENABLED as string | undefined) !== "false",
    speedMultiplier: Number(import.meta.env.VITE_MOCK_SPEED as string | undefined) || 1,
    autoTransition: (import.meta.env.VITE_MOCK_AUTO_TRANSITION as string | undefined) !== "false",
    autoStart: (import.meta.env.VITE_MOCK_AUTO_START as string | undefined) === "true",
  },
};
