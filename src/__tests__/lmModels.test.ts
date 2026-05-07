import { afterEach, describe, expect, it } from "vitest";
import { resolveModel } from "../lm/models";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as vscodeMock from "./__mocks__/vscode";

function fake(id: string) {
  return {
    id,
    name: id,
    family: "fam",
    vendor: "copilot",
    sendRequest: async () => ({ stream: (async function* () {})() }),
  };
}

describe("resolveModel", () => {
  afterEach(() => vscodeMock.__setModels([]));

  it("returns null when no models are available", async () => {
    vscodeMock.__setModels([]);
    expect(await resolveModel("any", null)).toBeNull();
  });

  it("matches exact id", async () => {
    const m = fake("claude-3.5-sonnet");
    vscodeMock.__setModels([fake("gpt-4o"), m]);
    const result = await resolveModel("claude-3.5-sonnet", null);
    expect(result?.id).toBe("claude-3.5-sonnet");
  });

  it("falls back to case-insensitive prefix match (model id is prefix of requested)", async () => {
    vscodeMock.__setModels([fake("claude-3-5-sonnet")]);
    const result = await resolveModel("CLAUDE-3-5-SONNET-20241022", null);
    expect(result?.id).toBe("claude-3-5-sonnet");
  });

  it("falls back to case-insensitive prefix match (requested is prefix of model id)", async () => {
    vscodeMock.__setModels([fake("claude-3-5-sonnet-20241022")]);
    const result = await resolveModel("claude-3-5-sonnet", null);
    expect(result?.id).toBe("claude-3-5-sonnet-20241022");
  });

  it("falls back to defaultModel when no match", async () => {
    vscodeMock.__setModels([fake("gpt-4o"), fake("claude-3.5-sonnet")]);
    const result = await resolveModel("totally-unknown-id", "gpt-4o");
    expect(result?.id).toBe("gpt-4o");
  });

  it("returns null when neither match nor defaultModel resolves", async () => {
    vscodeMock.__setModels([fake("gpt-4o")]);
    expect(await resolveModel("nope", "also-nope")).toBeNull();
    expect(await resolveModel("nope", null)).toBeNull();
  });
});
