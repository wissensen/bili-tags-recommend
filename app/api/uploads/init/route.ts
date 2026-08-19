import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = (await request.json()) as { fileName?: string; size?: number; mimeType?: string };

  if (!body.fileName || !body.size || !body.mimeType) {
    return NextResponse.json({ error: { code: 'INVALID_UPLOAD', message: '文件信息不完整' } }, { status: 400 });
  }

  const uploadId = crypto.randomUUID();

  // TODO: 创建 upload_assets 记录，并为 R2 生成短期签名 PUT URL。
  return NextResponse.json({
    uploadId,
    objectKey: `mock/${uploadId}/${body.fileName}`,
    uploadUrl: `mock://r2/${uploadId}`,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    requiredHeaders: { 'Content-Type': body.mimeType },
  });
}
