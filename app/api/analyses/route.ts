import { NextResponse } from 'next/server';
import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { withIdempotency } from '@/lib/idempotency';
import { createAnalysisWithSession, findVerifiedUpload } from '@/lib/repository';

export async function POST(request: Request) {
  const body = (await request.json()) as { uploadId?: string; title?: string; categoryId?: string };
  if (!body.uploadId || !body.title || !body.categoryId) {
    return NextResponse.json({ error: { code: 'INVALID_ANALYSIS', message: '分析参数不完整' } }, { status: 400 });
  }

  const visitor = await getVisitor(request);
  if (!(await findVerifiedUpload(visitor.ownerId, body.uploadId))) {
    return jsonWithVisitor({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或尚未完成' } }, { status: 404 }, visitor);
  }

  const uploadId = body.uploadId;
  const title = body.title.trim();
  const categoryId = body.categoryId;
  const { body: response, status } = await withIdempotency(
    visitor.ownerId,
    'analysis',
    request.headers.get('Idempotency-Key'),
    202,
    async () => {
      const { analysisId } = await createAnalysisWithSession(visitor.ownerId, { uploadId, title, categoryId });
      return { analysisId, status: 'queued', pollAfterMs: 700 };
    },
  );
  return jsonWithVisitor(response, { status }, visitor);
}
