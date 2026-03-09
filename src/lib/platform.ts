// TAURI_ENV_PLATFORM is injected at build time by Tauri.
// On iOS/Android it is "ios"/"android"; undefined in browser dev.
const platform = (import.meta.env as Record<string, string | undefined>)
  .TAURI_ENV_PLATFORM;

export const isMobilePlatform = platform === "ios" || platform === "android";
