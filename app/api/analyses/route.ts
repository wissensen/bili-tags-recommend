/**
 * POST /api/analyses —— 发起 AI 分析任务
 *
 * 作用：投稿链路第 ③ 步。为指定视频创建一次分析任务并生成推荐会话，
 *       返回 analysisId 与建议轮询间隔 pollAfterMs。真实场景会把视频
 *       交给算法侧；当前 mock 直接标记成功并写入候选（见 repository
 *       的 TODO(algo)）。
 * 时机：用户填完标题、选好分区，点「生成标签」。
 * 入参（JSON body）：uploadId、title、categoryId，缺一返回 400；
 *       上传须存在且已 verified，否则 404。
 * 请求头：Idempotency-Key（防重复提交，经 withIdempotency 处理）。
 * 返回（202）：{ analysisId, status: 'queued', pollAfterMs }。
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withIdempotency } from '@/lib/idempotency';
import { createAnalysisWithSession, findVerifiedUpload } from '@/lib/repository';

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as { uploadId?: string; title?: string; categoryId?: string };
  if (!body.uploadId || !body.title || !body.categoryId) {
    return NextResponse.json({ error: { code: 'INVALID_ANALYSIS', message: '分析参数不完整' } }, { status: 400 });
  }
  if (!(await findVerifiedUpload(auth.userId, body.uploadId))) {
    return NextResponse.json({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或尚未完成' } }, { status: 404 });
  }

  const uploadId = body.uploadId;
  const title = body.title.trim();
  const categoryId = body.categoryId;
  const { body: response, status } = await withIdempotency(
    auth.userId,
    'analysis',
    request.headers.get('Idempotency-Key'),
    202,
    async () => {
      const { analysisId } = await createAnalysisWithSession(auth.userId, { uploadId, title, categoryId });
      return { analysisId, status: 'queued', pollAfterMs: 700 };
    },
  );
  return NextResponse.json(response, { status });
}
