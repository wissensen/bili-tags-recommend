import { getDatabase } from './cloudflare';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function withIdempotency<T>(
  ownerId: string,
  scope: string,
  key: string | null,
  status: number,
  produce: () => Promise<T>,
): Promise<{ body: T; status: number }> {
  const db = await getDatabase();
  if (!key || !db) {
    return { body: await produce(), status };
  }

  const previous = await db
    .prepare(
      `SELECT response_status, response_json FROM idempotency_keys WHERE owner_id = ? AND scope = ? AND idempotency_key = ?`,
    )
    .bind(ownerId, scope, key)
    .first<{ response_status: number | null; response_json: string | null }>();
  if (previous?.response_json) {
    return { body: JSON.parse(previous.response_json) as T, status: previous.response_status ?? status };
  }

  const body = await produce();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR REPLACE INTO idempotency_keys (owner_id, scope, idempotency_key, response_status, response_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(ownerId, scope, key, status, JSON.stringify(body), now, new Date(Date.now() + ONE_DAY_MS).toISOString())
    .run();
  return { body, status };
}
