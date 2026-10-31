import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const database = vi.hoisted(() => ({
  merchantConfiguration: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  merchantConfigurationRevision: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("./db.server", () => ({ default: database }));

import {
  DEFAULT_SELECTION,
  getConfigurationSnapshot,
  InvalidConfigurationError,
  saveMerchantConfiguration,
  StaleConfigurationError,
} from "./merchant-config.server";

describe("merchant configuration persistence", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SAHARA_API_KEY = "configured";
    process.env.GROQ_API_KEY = "configured";
    process.env.ISHOP_ENABLE_SAHARA_PIDGIN_TTS = "true";
    process.env.ELEVENLABS_API_KEY = "configured";
    process.env.ISHOP_ENABLE_ELEVENLABS_REALTIME_STT = "true";
    process.env.ISHOP_ENABLE_ELEVENLABS_HTTP_TTS = "true";
    database.$transaction.mockImplementation(async (operation) => operation(database));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("uses Gemini 3.8 Flash profile for new merchant installations", () => {
    expect(DEFAULT_SELECTION).toEqual({
      asr: "elevenlabs-scribe-v2-realtime",
      llm: "gemini-flash",
      tts: "elevenlabs-tts-female-stream",
    });
  });

  test("binds updates to the authenticated shop and expected revision", async () => {
    database.merchantConfiguration.updateMany.mockResolvedValue({ count: 1 });
    database.merchantConfiguration.findUniqueOrThrow.mockResolvedValue({ shop: "shop-a" });
    await saveMerchantConfiguration({
      shop: "shop-a.myshopify.com",
      expectedRevision: "revision-1",
      selection: {
        asr: "elevenlabs-scribe-v2-realtime",
        llm: "groq-gpt-oss-120b",
        tts: "elevenlabs-tts-female-stream",
      },
    });
    expect(database.merchantConfiguration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shop: "shop-a.myshopify.com", revision: "revision-1" },
        data: expect.objectContaining({ ttsProfileId: "elevenlabs-tts-female-stream" }),
      }),
    );
    expect(database.merchantConfigurationRevision.create).toHaveBeenCalledOnce();
  });

  test("rejects a stale update without writing a revision", async () => {
    database.merchantConfiguration.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      saveMerchantConfiguration({
        shop: "shop-a.myshopify.com",
        expectedRevision: "stale",
        selection: {
          asr: "elevenlabs-scribe-v2-realtime",
          llm: "groq-gpt-oss-120b",
          tts: "elevenlabs-tts-female-stream",
        },
      }),
    ).rejects.toBeInstanceOf(StaleConfigurationError);
    expect(database.merchantConfigurationRevision.create).not.toHaveBeenCalled();
  });

  test("rejects unavailable profiles before persistence", async () => {
    await expect(
      saveMerchantConfiguration({
        shop: "shop-a.myshopify.com",
        expectedRevision: "revision-1",
        selection: {
          asr: "groq-whisper-large-v3-batch",
          llm: "gemini-flash",
          tts: "sahara-tts-female-pcm",
        },
      }),
    ).rejects.toBeInstanceOf(InvalidConfigurationError);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  test("fresh grants use ElevenLabs for an existing legacy installation without blocking text", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    database.merchantConfiguration.findUnique.mockResolvedValue({
      revision: "existing-revision", asrProfileId: "sahara-stream-pcm",
      llmProfileId: "groq-gpt-oss-120b", ttsProfileId: "sahara-tts-female-pidgin",
    });
    await expect(getConfigurationSnapshot("shop-a.myshopify.com")).resolves.toEqual({
      revision: "existing-revision", selection: {
        asr: "elevenlabs-scribe-v2-realtime", llm: "groq-gpt-oss-120b",
        tts: "elevenlabs-tts-female-stream",
      },
    });
  });

  test("missing ordinary-chat credentials do not block a recognized Plus session", async () => {
    delete process.env.GROQ_API_KEY;
    database.merchantConfiguration.findUnique.mockResolvedValue({
      revision: "existing-revision", asrProfileId: "sahara-stream-pcm",
      llmProfileId: "groq-gpt-oss-120b", ttsProfileId: "sahara-tts-female-pidgin",
    });
    const snapshot = await getConfigurationSnapshot("shop-a.myshopify.com");
    expect(snapshot.selection.llm).toBe("groq-gpt-oss-120b");
    database.merchantConfiguration.findUnique.mockResolvedValue({
      revision: "bad-revision", asrProfileId: "sahara-stream-pcm",
      llmProfileId: "unrecognized-provider", ttsProfileId: "sahara-tts-female-pidgin",
    });
    await expect(getConfigurationSnapshot("shop-a.myshopify.com"))
      .rejects.toBeInstanceOf(InvalidConfigurationError);
  });
});
