import { getDatabase } from './cloudflare';
import { MOCK_ATOMIC_TAGS, MOCK_COMPOSITE_TAGS } from './mock-tags';
import type { RecommendTag } from './types';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function db() {
  const database = await getDatabase();
  if (!database) throw new Error('D1 database is not bound');
  return database;
}

export async function createUpload(
  ownerId: string,
  input: { fileName: string; mimeType: string; size: number },
): Promise<string> {
  const uploadId = crypto.randomUUID();
  // TODO(storage): 目前仅登记元信息，真实场景需接入 OSS/服务器直传后回填 object_key。
  await (await db())
    .prepare(
      `INSERT INTO upload_assets (id, owner_id, file_name, mime_type, byte_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'local_only', ?)`,
    )
    .bind(uploadId, ownerId, input.fileName, input.mimeType, input.size, new Date().toISOString())
    .run();
  return uploadId;
}

export async function verifyUpload(ownerId: string, uploadId: string): Promise<boolean> {
  const result = (await (await db())
    .prepare(`UPDATE upload_assets SET status = 'verified', verified_at = ? WHERE id = ? AND owner_id = ?`)
    .bind(new Date().toISOString(), uploadId, ownerId)
    .run()) as { meta?: { changes?: number } };
  return Boolean(result.meta?.changes);
}

export async function findVerifiedUpload(ownerId: string, uploadId: string): Promise<boolean> {
  const row = await (await db())
    .prepare(`SELECT id FROM upload_assets WHERE id = ? AND owner_id = ? AND status = 'verified'`)
    .bind(uploadId, ownerId)
    .first();
  return Boolean(row);
}

export async function createAnalysisWithSession(
  ownerId: string,
  input: { uploadId: string; title: string; categoryId: string },
): Promise<{ analysisId: string; sessionId: string }> {
  const analysisId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const database = await db();
  // TODO(algo): 目前直接标记 succeeded 并写入 mock 候选；
  // 接入真实算法后改为提交任务并轮询算法返回的候选写入会话。
  await database
    .prepare(
      `INSERT INTO analysis_jobs (id, upload_id, owner_id, title, category_id, status, attempt_count, created_at, updated_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'succeeded', 1, ?, ?, ?, ?)`,
    )
    .bind(analysisId, input.uploadId, ownerId, input.title, input.categoryId, now, now, now, now)
    .run();
  await database
    .prepare(
      `INSERT INTO recommendation_sessions (id, analysis_id, owner_id, ranking_version, candidates_json, composite_json, created_at, expires_at)
       VALUES (?, ?, ?, 'mock-v1', ?, ?, ?, ?)`,
    )
    .bind(
      sessionId,
      analysisId,
      ownerId,
      JSON.stringify(MOCK_ATOMIC_TAGS),
      JSON.stringify(MOCK_COMPOSITE_TAGS),
      now,
      new Date(Date.now() + ONE_DAY_MS).toISOString(),
    )
    .run();
  return { analysisId, sessionId };
}

export async function getAnalysis(
  ownerId: string,
  analysisId: string,
): Promise<{ id: string; status: string; sessionId: string | null; errorCode: string | null; errorMessage: string | null } | null> {
  const row = await (await db())
    .prepare(
      `SELECT id, status, error_code, error_message,
              (SELECT id FROM recommendation_sessions WHERE analysis_id = analysis_jobs.id) AS session_id
       FROM analysis_jobs WHERE id = ? AND owner_id = ?`,
    )
    .bind(analysisId, ownerId)
    .first<{ id: string; status: string; error_code: string | null; error_message: string | null; session_id: string | null }>();
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    sessionId: row.session_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

export async function getSessionCandidates(
  ownerId: string,
  sessionId: string,
): Promise<{ atomic: RecommendTag[]; composite: RecommendTag[]; rankingVersion: string } | null> {
  const row = await (await db())
    .prepare(
      `SELECT candidates_json, composite_json, ranking_version, expires_at
       FROM recommendation_sessions WHERE id = ? AND owner_id = ?`,
    )
    .bind(sessionId, ownerId)
    .first<{ candidates_json: string; composite_json: string | null; ranking_version: string; expires_at: string }>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return {
    atomic: JSON.parse(row.candidates_json) as RecommendTag[],
    composite: row.composite_json ? (JSON.parse(row.composite_json) as RecommendTag[]) : [],
    rankingVersion: row.ranking_version,
  };
}

export async function findOwnedAnalysis(
  ownerId: string,
  input: { analysisId: string; uploadId: string },
): Promise<boolean> {
  const row = await (await db())
    .prepare(
      `SELECT a.id FROM analysis_jobs a
       JOIN upload_assets u ON u.id = a.upload_id
       WHERE a.id = ? AND a.upload_id = ? AND a.owner_id = ? AND u.owner_id = ?`,
    )
    .bind(input.analysisId, input.uploadId, ownerId, ownerId)
    .first();
  return Boolean(row);
}

export async function saveSubmission(
  ownerId: string,
  input: {
    uploadId: string;
    analysisId: string;
    title: string;
    categoryId: string;
    coverObjectKey: string | null;
    summary: string | null;
    tags: Array<{ text: string; candidateId?: string }>;
  },
): Promise<string> {
  const submissionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const database = await db();
  // TODO(storage): cover_object_key 目前来自前端本地 URL，真实场景应为 OSS 回填的对象键。
  await database
    .prepare(
      `INSERT INTO submissions (id, owner_id, upload_id, analysis_id, title, category_id, cover_object_key, summary, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?)`,
    )
    .bind(submissionId, ownerId, input.uploadId, input.analysisId, input.title, input.categoryId, input.coverObjectKey, input.summary, now, now)
    .run();
  await database.batch(
    input.tags.slice(0, 10).map((tag, position) =>
      database
        .prepare(`INSERT INTO submission_tags (submission_id, position, candidate_id, text) VALUES (?, ?, ?, ?)`)
        .bind(submissionId, position, tag.candidateId ?? null, tag.text.trim()),
    ),
  );
  return submissionId;
}

export async function createUser(username: string, hash: string, salt: string): Promise<string> {
  const id = crypto.randomUUID();
  await (await db())
    .prepare(`INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, username, hash, salt, new Date().toISOString())
    .run();
  return id;
}

export async function findUserByName(
  username: string,
): Promise<{ id: string; passwordHash: string; passwordSalt: string } | null> {
  const row = await (await db())
    .prepare(`SELECT id, password_hash, password_salt FROM users WHERE username = ?`)
    .bind(username)
    .first<{ id: string; password_hash: string; password_salt: string }>();
  if (!row) return null;
  return { id: row.id, passwordHash: row.password_hash, passwordSalt: row.password_salt };
}

export async function findUsernameById(userId: string): Promise<string | null> {
  const row = await (await db())
    .prepare(`SELECT username FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ username: string }>();
  return row?.username ?? null;
}

export async function createSession(userId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await (await db())
    .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(id, userId, now, expires)
    .run();
  return id;
}

export async function getUserIdBySession(token: string): Promise<string | null> {
  const row = await (await db())
    .prepare(`SELECT user_id, expires_at FROM sessions WHERE id = ?`)
    .bind(token)
    .first<{ user_id: string; expires_at: string }>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return row.user_id;
}

export async function deleteSession(token: string): Promise<void> {
  await (await db()).prepare(`DELETE FROM sessions WHERE id = ?`).bind(token).run();
}
