import { NextResponse } from 'next/server';
import { getDatabase, getVisitor, jsonWithVisitor } from '@/lib/cloudflare';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    uploadId?: string;
    analysisId?: string;
    title?: string;
    categoryId?: string;
    tags?: Array<{ text?: string; candidateId?: string }>;
  };

  if (!body.title || !body.categoryId || !body.tags?.length) {
    return NextResponse.json({ error: { code: 'INVALID_SUBMISSION', message: '请完善稿件信息并至少选择一个标签' } }, { status: 422 });
  }

  const visitor = await getVisitor(request);
  const db = await getDatabase();
  const submissionId = crypto.randomUUID();

  if (db) {
    if (!body.uploadId || !body.analysisId) {
      return jsonWithVisitor({ error: { code: 'INVALID_SUBMISSION', message: '缺少上传或分析信息' } }, { status: 422 }, visitor);
    }

    const owned = await db.prepare(`
      SELECT a.id FROM analysis_jobs a
      JOIN upload_assets u ON u.id = a.upload_id
      WHERE a.id = ? AND a.upload_id = ? AND a.owner_id = ? AND u.owner_id = ?
    `).bind(body.analysisId, body.uploadId, visitor.ownerId, visitor.ownerId).first();
    if (!owned) return jsonWithVisitor({ error: { code: 'INVALID_SUBMISSION', message: '上传或分析不存在' } }, { status: 404 }, visitor);

    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (idempotencyKey) {
      const previous = await db.prepare(
        `SELECT response_status, response_json FROM idempotency_keys WHERE owner_id = ? AND scope = 'submission' AND idempotency_key = ?`,
      ).bind(visitor.ownerId, idempotencyKey).first<{ response_status: number | null; response_json: string | null }>();
      if (previous?.response_json) return jsonWithVisitor(JSON.parse(previous.response_json), { status: previous.response_status ?? 200 }, visitor);
    }

    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO submissions (id, owner_id, upload_id, analysis_id, title, category_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'saved', ?, ?)
    `).bind(submissionId, visitor.ownerId, body.uploadId, body.analysisId, body.title.trim(), body.categoryId, now, now).run();
    await db.batch((body.tags ?? []).slice(0, 10).map((tag, position) => db.prepare(`
      INSERT INTO submission_tags (submission_id, position, candidate_id, text) VALUES (?, ?, ?, ?)
    `).bind(submissionId, position, tag.candidateId ?? null, tag.text?.trim() ?? '')));

    const response = { submissionId, status: 'saved' };
    if (idempotencyKey) {
      await db.prepare(`
        INSERT OR REPLACE INTO idempotency_keys (owner_id, scope, idempotency_key, response_status, response_json, created_at, expires_at)
        VALUES (?, 'submission', ?, 200, ?, ?, ?)
      `).bind(visitor.ownerId, idempotencyKey, JSON.stringify(response), now, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()).run();
    }
    return jsonWithVisitor(response, undefined, visitor);
  }

  return jsonWithVisitor({ submissionId, status: 'saved' }, undefined, visitor);
}
