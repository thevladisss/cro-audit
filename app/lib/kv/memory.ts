import type { KvDriver } from "./kv";

type Entry = { value: string; expiresAt: number };

/**
 * The driver used in `next dev` and under vitest, where no Upstash env exists.
 *
 * It is a `Map`, so it is per-process: two serverless instances do not see each
 * other's runs and a redeploy forgets everything. That is correct for dev and
 * wrong in production, which is what `kv.ts` picking the real driver is for.
 *
 * Values are round-tripped through JSON rather than stored by reference — Redis
 * stores bytes, so a caller must not be able to mutate a stored run by holding
 * on to the object it wrote. The in-memory driver lying about that is how a bug
 * ships green.
 *
 * `next dev` recompiles a module on edit, so the `Map` hangs off `globalThis`:
 * a fresh store on every keystroke would drop the run mid-request.
 */
const globalForRuns = globalThis as typeof globalThis & {
  __croRunStore?: Map<string, Entry>;
};

const store = (globalForRuns.__croRunStore ??= new Map<string, Entry>());

export function createMemoryDriver(): KvDriver {
  return {
    async get<T>(key: string): Promise<T | null> {
      const entry = store.get(key);

      if (!entry) return null;

      // Lazy expiry: nothing sweeps, so the check happens on read.
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }

      return JSON.parse(entry.value) as T;
    },

    // `ex` rather than a friendlier name: this implements `KvDriver`, whose
    // shape is Redis's because the production driver is Redis.
    async set(key: string, value: unknown, { ex }: { ex: number }) {
      store.set(key, {
        value: JSON.stringify(value),
        expiresAt: Date.now() + ex * 1000,
      });
    },
  };
}
