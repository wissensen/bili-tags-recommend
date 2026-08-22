import { getCloudflareContext } from '@opennextjs/cloudflare';

type RuntimeEnv = {
  DB?: D1DatabaseLike;
};

export type D1DatabaseLike = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    run(): Promise<unknown>;
  };
  batch(statements: unknown[]): Promise<unknown>;
};

export async function getRuntimeEnv(): Promise<RuntimeEnv> {
  // OpenNext installs this marker for Worker requests and for `next dev`
  // after `initOpenNextCloudflareForDev()`. Plain `next start` does not.
  if (!(globalThis as Record<PropertyKey, unknown>)[Symbol.for('__cloudflare-context__')]) {
    return {};
  }
  try {
    const context = await getCloudflareContext({ async: true });
    return context.env as RuntimeEnv;
  } catch {
    return {};
  }
}

export async function getDatabase() {
  const env = await getRuntimeEnv();
  return env.DB ?? null;
}

