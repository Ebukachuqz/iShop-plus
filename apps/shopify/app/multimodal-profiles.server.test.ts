import { afterEach, expect, test } from "vitest";
import { combineReasoningProfile, splitReasoningProfile, plusProviderProfiles, validateProfileSelection } from "./provider-profiles.server";
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

test("independent choices roundtrip while legacy IDs retain default", () => {
  expect(splitReasoningProfile("groq-gpt-oss-120b")).toEqual({ chat: "groq-gpt-oss-120b", plus: "default", valid: true });
  expect(splitReasoningProfile(combineReasoningProfile("gemini-flash", "groq"))).toEqual({ chat: "gemini-flash", plus: "groq", valid: true });
  expect(combineReasoningProfile("gemini-flash", "default")).toBe("gemini-flash");
});

test("server validates unknown or unconfigured multimodal selection", () => {
  process.env.GROQ_API_KEY = "configured";
  const selection = { asr: "elevenlabs-scribe-v2-realtime", llm: "groq-gpt-oss-120b|plus=groq", tts: "elevenlabs-tts-female-stream" };
  expect(validateProfileSelection(selection).llm).toBeUndefined();
  expect(validateProfileSelection({ ...selection, llm: "groq-gpt-oss-120b|plus=unknown" }).llm).toContain("recognized");
  expect(validateProfileSelection({ ...selection, llm: "groq-gpt-oss-120b|plus=groq|plus=google" }).llm).toContain("recognized");
  delete process.env.GROQ_API_KEY;
  expect(validateProfileSelection(selection).llm).toContain("credential");
});

test("browser-safe multimodal choices expose no secrets", () => {
  process.env.OPENROUTER_API_KEY = "never-expose-key";
  expect(plusProviderProfiles().find(p => p.id === "openrouter")?.enabled).toBe(true);
  expect(JSON.stringify(plusProviderProfiles())).not.toContain("never-expose-key");
});


test("one Drake model does not require a second ordinary-chat credential", () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.OPENROUTER_API_KEY = "configured";
  expect(validateProfileSelection({asr:"elevenlabs-scribe-v2-realtime",
    llm:"groq-gpt-oss-120b|plus=openrouter",tts:"elevenlabs-tts-female-stream"}).llm).toBeUndefined();
});
