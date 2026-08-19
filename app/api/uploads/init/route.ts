import { NextResponse } from 'next/server';
import { getDatabase, getVisitor, jsonWithVisitor } from '@/lib/cloudflare';

export async function POST(request: Request) {
  const body = (await request.json()) as { fileName?: string; size?: number; mimeType?: string };

  if (!body.fileName || !body.size || body.size <= 0 || !body.mimeType) {
    return NextResponse.json({ error: { code: 'INVALID_UPLOAD', message: '文件信息不完整' } }, { status: 400 });
  }

  const uploadId = crypto.randomUUID();
  const visitor = await getVisitor(request);
  const db = await getDatabase();
  const now = new Date().toISOString();

  if (db) {
    await db.prepare(`
      INSERT INTO upload_assets (id, owner_id, file_name, mime_type, byte_size, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'local_only', ?)
    `).bind(uploadId, visitor.ownerId, body.fileName, body.mimeType, body.size, now).run();
  }

  return jsonWithVisitor({
    uploadId,
    objectKey: `mock/${uploadId}/${body.fileName}`,
    uploadUrl: `mock://r2/${uploadId}`,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    requiredHeaders: { 'Content-Type': body.mimeType },
  }, undefined, visitor);
}
