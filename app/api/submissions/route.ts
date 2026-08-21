import { NextResponse } from 'next/server';
import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { withIdempotency } from '@/lib/idempotency';
import { findOwnedAnalysis, saveSubmission } from '@/lib/repository';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    uploadId?: string;
    analysisId?: string;
    title?: string;
    categoryId?: string;
    coverUrl?: string;
    tags?: Array<{ text?: string; candidateId?: string }>;
  };

  if (!body.title || !body.categoryId || !body.tags?.length) {
    return NextResponse.json({ error: { code: 'INVALID_SUBMISSION', message: '请完善稿件信息并至少选择一个标签' } }, { status: 422 });
  }

  const visitor = await getVisitor(request);
  if (!body.uploadId || !body.analysisId) {
    return jsonWithVisitor({ error: { code: 'INVALID_SUBMISSION', message: '缺少上传或分析信息' } }, { status: 422 }, visitor);
  }
  if (!(await findOwnedAnalysis(visitor.ownerId, { analysisId: body.analysisId, uploadId: body.uploadId }))) {
    return jsonWithVisitor({ error: { code: 'INVALID_SUBMISSION', message: '上传或分析不存在' } }, { status: 404 }, visitor);
  }

  const uploadId = body.uploadId;
  const analysisId = body.analysisId;
  const title = body.title.trim();
  const categoryId = body.categoryId;
  // TODO(storage): coverUrl 目前为前端本地 URL，接入 OSS 后应为对象键。
  const coverObjectKey = body.coverUrl ?? null;
  const tags = (body.tags ?? [])
    .map((t) => ({ text: t.text?.trim() ?? '', candidateId: t.candidateId }))
    .filter((t) => t.text.length > 0);

  const { body: response, status } = await withIdempotency(
    visitor.ownerId,
    'submission',
    request.headers.get('Idempotency-Key'),
    200,
    async () => {
      const submissionId = await saveSubmission(visitor.ownerId, {
        uploadId,
        analysisId,
        title,
        categoryId,
        coverObjectKey,
        tags,
      });
      return { submissionId, status: 'saved' };
    },
  );
  return jsonWithVisitor(response, { status }, visitor);
}
