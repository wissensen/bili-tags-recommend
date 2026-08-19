import { getDatabase, getVisitor, jsonWithVisitor } from '@/lib/cloudflare';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const visitor = await getVisitor(request);
  const db = await getDatabase();

  if (db) {
    const result = await db.prepare(`
      UPDATE upload_assets SET status = 'verified', verified_at = ?
      WHERE id = ? AND owner_id = ?
    `).bind(new Date().toISOString(), id, visitor.ownerId).run() as { meta?: { changes?: number } };
    if (!result.meta?.changes) {
      return jsonWithVisitor({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或无权访问' } }, { status: 404 }, visitor);
    }
  }

  return jsonWithVisitor({ uploadId: id, status: 'verified' }, undefined, visitor);
}
