import { NextResponse } from 'next/server';
import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { createUpload } from '@/lib/repository';

export async function POST(request: Request) {
  const body = (await request.json()) as { fileName?: string; size?: number; mimeType?: string };
  if (!body.fileName || !body.size || body.size <= 0 || !body.mimeType) {
    return NextResponse.json({ error: { code: 'INVALID_UPLOAD', message: '文件信息不完整' } }, { status: 400 });
  }

  const visitor = await getVisitor(request);
  const uploadId = await createUpload(visitor.ownerId, { fileName: body.fileName, mimeType: body.mimeType, size: body.size });

  // TODO(storage): uploadUrl/objectKey 目前为 mock，接入 OSS 后返回真实直传地址与对象键。
  return jsonWithVisitor(
    {
      uploadId,
      objectKey: `mock/${uploadId}/${body.fileName}`,
      uploadUrl: `mock://r2/${uploadId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      requiredHeaders: { 'Content-Type': body.mimeType },
    },
    undefined,
    visitor,
  );
}
