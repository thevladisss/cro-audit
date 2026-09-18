import { kv as vercelKv } from "@vercel/kv";

import { createMemoryDriver } from "./memory";


export type KvDriver = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options: { ex: number }): Promise<unknown>;
};

/** Seconds, in the vocabulary of the caller rather than of Redis. */
type WriteOptions = { ttl: number };

let driver: KvDriver | null = null;

/**
 * Real Redis when the env says so, the `Map` otherwise. Resolved once.
 *
 * `vercelKv` is a lazy proxy that throws on its first command when the env is
 * absent, so the import above is safe and the env check is the thing that
 * matters — it is what keeps the run tests runnable with no env at all, the
 * same property `lib/rules` and `lib/analyze` already have.
 */
function getKvDriver(): KvDriver {
  if (!driver) {
    driver =
      process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
        ? vercelKv
        : createMemoryDriver();
  }

  return driver;
}

/**
 * The one export. Methods resolve the driver on call rather than at import, so
 * a module that imports `kv` at the top of the file does not pin the choice
 * before the env is loaded.
 */
export const kv = {
  get: <T>(key: string): Promise<T | null> => getKvDriver().get<T>(key),

  async set(key: string, value: unknown, { ttl }: WriteOptions): Promise<void> {
    await getKvDriver().set(key, value, { ex: ttl });
  },
};
