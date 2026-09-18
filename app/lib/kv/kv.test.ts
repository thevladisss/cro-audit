import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `kv.ts` is one decision and one translation: which driver gets the command,
 * and `{ ttl }` seconds out as Redis's `{ ex }`. So both drivers are stubs.
 * What a `Map` does with a command is `memory.test.ts`'s subject, and what
 * Upstash does with one is Upstash's — neither is this file's.
 */
const upstash = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const memory = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const createMemoryDriver = vi.hoisted(() => vi.fn());

vi.mock("@vercel/kv", () => ({ kv: upstash }));
vi.mock("./memory", () => ({ createMemoryDriver }));

/** Seconds, the unit `kv.set` takes. */
const HOUR = 60 * 60;

const UPSTASH_ENV = {
  url: "https://example.upstash.io",
  token: "a-token",
};

/**
 * A module that has not picked a driver yet. The pick is made on first command
 * and kept for the life of the module, so the env has to be in place before the
 * import rather than before the call.
 */
async function loadKv(env: { url?: string; token?: string } = {}) {
  vi.stubEnv("KV_REST_API_URL", env.url);
  vi.stubEnv("KV_REST_API_TOKEN", env.token);
  vi.resetModules();

  return (await import("./kv")).kv;
}

describe("kv.ts", () => {
  createMemoryDriver.mockReturnValue(memory);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("with no Upstash env", () => {
    it("reads through the in-memory driver, returning what it gives", async () => {
      memory.get.mockResolvedValue({ runId: "a" });
      const kv = await loadKv();

      await expect(kv.get("run:a")).resolves.toEqual({ runId: "a" });
      expect(memory.get).toHaveBeenCalledWith("run:a");
      expect(upstash.get).not.toHaveBeenCalled();
    });

    it("sends a write to the in-memory driver, ttl spelled `ex`", async () => {
      const kv = await loadKv();

      await kv.set("run:a", { runId: "a" }, { ttl: HOUR });

      expect(memory.set).toHaveBeenCalledWith(
        "run:a",
        { runId: "a" },
        { ex: HOUR },
      );
      expect(upstash.set).not.toHaveBeenCalled();
    });

    it("treats half an env as none, not as Upstash", async () => {
      // A url with no token is a misconfiguration, and `vercelKv` would throw
      // on its first command. Dev's `Map` is the safer read of the two.
      const kv = await loadKv({ url: UPSTASH_ENV.url });

      await kv.get("run:a");

      expect(memory.get).toHaveBeenCalledWith("run:a");
      expect(upstash.get).not.toHaveBeenCalled();
    });
  });

  describe("with the Upstash env set", () => {
    it("sends a read to @vercel/kv and returns what it gives", async () => {
      upstash.get.mockResolvedValue({ runId: "b" });
      const kv = await loadKv(UPSTASH_ENV);

      await expect(kv.get("run:b")).resolves.toEqual({ runId: "b" });
      expect(upstash.get).toHaveBeenCalledWith("run:b");
    });

    it("sends a write to @vercel/kv, ttl spelled `ex`", async () => {
      const kv = await loadKv(UPSTASH_ENV);

      await kv.set("run:b", { runId: "b" }, { ttl: HOUR });

      expect(upstash.set).toHaveBeenCalledWith(
        "run:b",
        { runId: "b" },
        { ex: HOUR },
      );
    });

    it("never builds the in-memory driver", async () => {
      const kv = await loadKv(UPSTASH_ENV);

      await kv.get("run:b");

      expect(createMemoryDriver).not.toHaveBeenCalled();
      expect(memory.get).not.toHaveBeenCalled();
    });
  });

  describe("driver resolution", () => {
    it("picks once and reuses the pick", async () => {
      const kv = await loadKv();

      await kv.get("run:a");
      await kv.set("run:a", { runId: "a" }, { ttl: HOUR });
      await kv.get("run:a");

      expect(createMemoryDriver).toHaveBeenCalledTimes(1);
    });
  });
});
