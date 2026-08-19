import { NextResponse } from 'next/server';
import { MOCK_TAG_BATCHES } from '@/lib/mock-tags';
import { getDatabase, getVisitor, jsonWithVisitor } from '@/lib/cloudflare';

export async function POST(request: Request) {
  const body = (await request.json()) as { uploadId?: string; title?: string; categoryId?: string };

  if (!body.uploadId || !body.title || !body.categoryId) {
    return NextResponse.json({ error: { code: 'INVALID_ANALYSIS', message: '分析参数不完整' } }, { status: 400 });
  }

  const visitor = await getVisitor(request);
  const db = await getDatabase();
  const analysisId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const candidates = MOCK_TAG_BATCHES.flat();

  if (db) {
    const upload = await db.prepare(
      `SELECT id FROM upload_assets WHERE id = ? AND owner_id = ? AND status = 'verified'`,
    ).bind(body.uploadId, visitor.ownerId).first();
    if (!upload) {
      return jsonWithVisitor({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或尚未完成' } }, { status: 404 }, visitor);
    }

    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (idempotencyKey) {
      const previous = await db.prepare(
        `SELECT response_status, response_json FROM idempotency_keys WHERE owner_id = ? AND scope = 'analysis' AND idempotency_key = ?`,
      ).bind(visitor.ownerId, idempotencyKey).first<{ response_status: number | null; response_json: string | null }>();
      if (previous?.response_json) {
        return jsonWithVisitor(JSON.parse(previous.response_json), { status: previous.response_status ?? 202 }, visitor);
      }
    }

    await db.prepare(`
      INSERT INTO analysis_jobs (id, upload_id, owner_id, title, category_id, status, attempt_count, created_at, updated_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, 'succeeded', 1, ?, ?, ?, ?)
    `).bind(analysisId, body.uploadId, visitor.ownerId, body.title.trim(), body.categoryId, now, now, now, now).run();
    await db.prepare(`
      INSERT INTO recommendation_sessions (id, analysis_id, owner_id, ranking_version, candidates_json, created_at, expires_at)
      VALUES (?, ?, ?, 'mock-v1', ?, ?, ?)
    `).bind(sessionId, analysisId, visitor.ownerId, JSON.stringify(candidates), now, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()).run();

    const response = { analysisId, status: 'queued', pollAfterMs: 700 };
    if (idempotencyKey) {
      await db.prepare(`
        INSERT OR REPLACE INTO idempotency_keys (owner_id, scope, idempotency_key, response_status, response_json, created_at, expires_at)
        VALUES (?, 'analysis', ?, 202, ?, ?, ?)
      `).bind(visitor.ownerId, idempotencyKey, JSON.stringify(response), now, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()).run();
    }
    return jsonWithVisitor(response, { status: 202 }, visitor);
  }

  return jsonWithVisitor({ analysisId, status: 'queued', pollAfterMs: 700 }, { status: 202 }, visitor);
}
