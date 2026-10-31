import { readFileSync } from "node:fs";

const providerKeys = new Set([
  "ISHOP_PLUS_GEMMA_PROVIDER", "GROQ_API_KEY", "GEMINI_API_KEY", "NVIDIA_API_KEY", "OPENROUTER_API_KEY",
  "ELEVENLABS_API_KEY", "ISHOP_ENABLE_ELEVENLABS_REALTIME_STT",
  "ISHOP_ENABLE_ELEVENLABS_HTTP_TTS", "ISHOP_ENABLE_ELEVENLABS_WS_TTS",
]);

// The local runtime already reads the root .env. Share provider availability
// with the development admin screen without copying keys into another file.
export function loadDevelopmentProviderEnvironment(
  file = new URL("../../../.env", import.meta.url),
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.NODE_ENV !== "development") return;
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_]+)=(.*)$/);
    if (!match || !providerKeys.has(match[1]) || env[match[1]] !== undefined) continue;
    const value = match[2].trim();
    env[match[1]] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
}
