import { describe, expect, it } from "bun:test";
import { loadServerSettings } from "../config";

describe("server config", () => {
  it("persists agent snapshots by default", () => {
    const settings = loadServerSettings({});

    expect(settings.host).toBe("127.0.0.1");
    expect(settings.persistencePath).toBe(".data/agents.json");
  });

  it("allows persistence to be explicitly disabled", () => {
    const settings = loadServerSettings({ PERSISTENCE_PATH: "" });

    expect(settings.persistencePath).toBe("");
  });

  it("rejects public listening with the development API key", () => {
    expect(() => loadServerSettings({ HOST: "0.0.0.0" })).toThrow(/API_KEY/);
    expect(() =>
      loadServerSettings({ HOST: "0.0.0.0", API_KEY: "dev-api-key" }),
    ).toThrow(/API_KEY/);
  });

  it("allows public listening with an explicit API key", () => {
    const settings = loadServerSettings({
      HOST: "0.0.0.0",
      API_KEY: "replace-me-with-a-real-secret",
    });

    expect(settings.host).toBe("0.0.0.0");
    expect(settings.apiKey).toBe("replace-me-with-a-real-secret");
  });
});
