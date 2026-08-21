import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { verifyUpload } from '@/lib/repository';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const visitor = await getVisitor(request);
  const ok = await verifyUpload(visitor.ownerId, id);
  if (!ok) {
    return jsonWithVisitor({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或无权访问' } }, { status: 404 }, visitor);
  }
  return jsonWithVisitor({ uploadId: id, status: 'verified' }, undefined, visitor);
}
