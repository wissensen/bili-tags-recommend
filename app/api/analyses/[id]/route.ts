import { getDatabase, getVisitor, jsonWithVisitor } from '@/lib/cloudflare';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const visitor = await getVisitor(request);
  const db = await getDatabase();

  if (db) {
    const result = await db.prepare(
      `SELECT id, status, error_code, error_message, (SELECT id FROM recommendation_sessions WHERE analysis_id = analysis_jobs.id) AS session_id FROM analysis_jobs WHERE id = ? AND owner_id = ?`,
    ).bind(id, visitor.ownerId).first<{ id: string; status: string; error_code: string | null; error_message: string | null; session_id: string | null }>();
    if (!result) return jsonWithVisitor({ error: { code: 'ANALYSIS_NOT_FOUND', message: '分析不存在或无权访问' } }, { status: 404 }, visitor);
    return jsonWithVisitor({ analysisId: result.id, status: result.status, sessionId: result.session_id, error: result.error_code ? { code: result.error_code, message: result.error_message } : undefined }, undefined, visitor);
  }

  return jsonWithVisitor({ analysisId: id, status: 'succeeded', sessionId: `session_${id}` }, undefined, visitor);
}
