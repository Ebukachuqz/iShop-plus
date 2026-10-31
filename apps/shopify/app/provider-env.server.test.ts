import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { loadDevelopmentProviderEnvironment } from "./provider-env.server";

test("development shares only missing provider values; production uses explicit environment", () => {
  const dir = mkdtempSync(join(tmpdir(), "ishop-env-"));
  try {
    const path = join(dir, ".env");
    writeFileSync(path, 'GROQ_API_KEY="local-test"\nOPENROUTER_API_KEY=local-other\nUNRELATED_SECRET=do-not-load\n');
    const env = { NODE_ENV: "development", OPENROUTER_API_KEY: "explicit-test" } as NodeJS.ProcessEnv;
    loadDevelopmentProviderEnvironment(pathToFileURL(path), env);
    expect(env.GROQ_API_KEY).toBe("local-test");
    expect(env.OPENROUTER_API_KEY).toBe("explicit-test");
    expect(env.UNRELATED_SECRET).toBeUndefined();
    const production = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    loadDevelopmentProviderEnvironment(pathToFileURL(path), production);
    expect(production.GROQ_API_KEY).toBeUndefined();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
