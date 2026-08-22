/**
 * POST /api/submissions —— 提交稿件（落库）
 *
 * 作用：投稿链路第 ⑥ 步。把稿件（视频 + 标题 + 分区 + 封面 + 标签）写入
 *       数据库，标签按顺序存（第 0 个即主标签）。
 * 时机：用户在推荐页选好标签，点「确认并发布」。
 * 入参（JSON body）：uploadId、analysisId、title、categoryId、coverUrl、
 *       tags[]。缺 title/categoryId/tags 返回 422；缺 uploadId/analysisId
 *       返回 422；上传或分析不属于当前访客返回 404。
 * 请求头：Idempotency-Key（防重复发布，经 withIdempotency 处理）。
 * 返回：{ submissionId, status: 'saved' }。
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withIdempotency } from '@/lib/idempotency';
import { findOwnedAnalysis, saveSubmission } from '@/lib/repository';

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as {
    uploadId?: string;
    analysisId?: string;
    title?: string;
    categoryId?: string;
    coverUrl?: string;
    summary?: string;
    tags?: Array<{ text?: string; candidateId?: string }>;
  };

  if (!body.title || !body.categoryId || !body.tags?.length) {
    return NextResponse.json({ error: { code: 'INVALID_SUBMISSION', message: '请完善稿件信息并至少选择一个标签' } }, { status: 422 });
  }
  if (!body.uploadId || !body.analysisId) {
    return NextResponse.json({ error: { code: 'INVALID_SUBMISSION', message: '缺少上传或分析信息' } }, { status: 422 });
  }
  if (!(await findOwnedAnalysis(auth.userId, { analysisId: body.analysisId, uploadId: body.uploadId }))) {
    return NextResponse.json({ error: { code: 'INVALID_SUBMISSION', message: '上传或分析不存在' } }, { status: 404 });
  }

  const uploadId = body.uploadId;
  const analysisId = body.analysisId;
  const title = body.title.trim();
  const categoryId = body.categoryId;
  // TODO(storage): coverUrl 目前为前端本地 URL，接入 OSS 后应为对象键。
  const coverObjectKey = body.coverUrl ?? null;
  const summary = body.summary?.trim().slice(0, 300) ?? null;
  const tags = (body.tags ?? [])
    .map((t) => ({ text: t.text?.trim() ?? '', candidateId: t.candidateId }))
    .filter((t) => t.text.length > 0);

  const { body: response, status } = await withIdempotency(
    auth.userId,
    'submission',
    request.headers.get('Idempotency-Key'),
    200,
    async () => {
      const submissionId = await saveSubmission(auth.userId, {
        uploadId, analysisId, title, categoryId, coverObjectKey, summary, tags,
      });
      return { submissionId, status: 'saved' };
    },
  );
  return NextResponse.json(response, { status });
}
