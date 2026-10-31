import { randomUUID } from "node:crypto";

import db from "./db.server";
import { normalizeProfileSelection, validateProfileSelection, type ProviderRole } from "./provider-profiles.server";

export const DEFAULT_SELECTION: Record<ProviderRole, string> = {
  asr: "elevenlabs-scribe-v2-realtime",
  llm: "gemini-flash",
  tts: "elevenlabs-tts-female-stream",
};

export class StaleConfigurationError extends Error {}
export class InvalidConfigurationError extends Error {
  constructor(public errors: Partial<Record<ProviderRole, string>>) {
    super("Provider configuration is invalid");
  }
}

export async function getMerchantConfiguration(shop: string) {
  const existing = await db.merchantConfiguration.findUnique({ where: { shop } });
  if (existing) return existing;
  const revision = randomUUID();
  return db.$transaction(async (transaction) => {
    const created = await transaction.merchantConfiguration.create({
      data: {
        shop,
        revision,
        asrProfileId: DEFAULT_SELECTION.asr,
        llmProfileId: DEFAULT_SELECTION.llm,
        ttsProfileId: DEFAULT_SELECTION.tts,
      },
    });
    await transaction.merchantConfigurationRevision.create({
      data: {
        shop: created.shop,
        revision: created.revision,
        asrProfileId: created.asrProfileId,
        llmProfileId: created.llmProfileId,
        ttsProfileId: created.ttsProfileId,
      },
    });
    return created;
  });
}

export async function saveMerchantConfiguration(input: {
  shop: string;
  expectedRevision: string;
  selection: Record<ProviderRole, string>;
}) {
  const selection = normalizeProfileSelection(input.selection);
  const errors = validateProfileSelection(selection);
  if (Object.keys(errors).length) throw new InvalidConfigurationError(errors);
  const revision = randomUUID();
  return db.$transaction(async (transaction) => {
    const changed = await transaction.merchantConfiguration.updateMany({
      where: { shop: input.shop, revision: input.expectedRevision },
      data: {
        revision,
        asrProfileId: selection.asr,
        llmProfileId: selection.llm,
        ttsProfileId: selection.tts,
      },
    });
    if (changed.count !== 1) throw new StaleConfigurationError("Settings changed in another session");
    await transaction.merchantConfigurationRevision.create({
      data: {
        shop: input.shop,
        revision,
        asrProfileId: selection.asr,
        llmProfileId: selection.llm,
        ttsProfileId: selection.tts,
      },
    });
    return transaction.merchantConfiguration.findUniqueOrThrow({ where: { shop: input.shop } });
  });
}

export async function getConfigurationSnapshot(shop: string) {
  const configuration = await getMerchantConfiguration(shop);
  const selection = normalizeProfileSelection({
    // Existing iShop installations may still store a retired voice profile.
    // Every new signed iShop-plus session uses the supported ElevenLabs route.
    asr: DEFAULT_SELECTION.asr,
    llm: configuration.llmProfileId,
    tts: configuration.ttsProfileId === "elevenlabs-tts-female-ws"
      ? configuration.ttsProfileId : DEFAULT_SELECTION.tts,
  });
  const errors = validateProfileSelection(selection);
  // Speech is optional for typed/image shopping. A missing voice credential is
  // reported when speech is requested rather than blocking the entire widget.
  delete errors.asr;
  delete errors.tts;
  // Plus uses its own Gemma model. A previously saved ordinary-chat provider
  // without credentials must not prevent Vision/Missions from opening.
  if (["gemini-flash", "groq-gpt-oss-120b"].includes(selection.llm)) delete errors.llm;
  if (Object.keys(errors).length) throw new InvalidConfigurationError(errors);
  return { revision: configuration.revision, selection };
}
