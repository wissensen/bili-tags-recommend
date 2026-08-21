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
import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { withIdempotency } from '@/lib/idempotency';
import { createAnalysisWithSession, findVerifiedUpload } from '@/lib/repository';

export async function POST(request: Request) {
  // 解析分析参数
  const body = (await request.json()) as { uploadId?: string; title?: string; categoryId?: string };
  // 校验：三个字段缺一不可
  if (!body.uploadId || !body.title || !body.categoryId) {
    return NextResponse.json({ error: { code: 'INVALID_ANALYSIS', message: '分析参数不完整' } }, { status: 400 });
  }

  // 识别访客
  const visitor = await getVisitor(request);
  // 确认该上传已 verified 且属于本访客，才允许分析
  if (!(await findVerifiedUpload(visitor.ownerId, body.uploadId))) {
    return jsonWithVisitor({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或尚未完成' } }, { status: 404 }, visitor);
  }

  const uploadId = body.uploadId;
  const title = body.title.trim();
  const categoryId = body.categoryId;
  // 幂等包裹：同一 Idempotency-Key 只会真正创建一次，重复请求直接返回首次结果
  const { body: response, status } = await withIdempotency(
    visitor.ownerId,
    'analysis',
    request.headers.get('Idempotency-Key'),
    202,
    async () => {
      // 创建分析任务 + 推荐会话（写入候选标签），返回 analysisId
      const { analysisId } = await createAnalysisWithSession(visitor.ownerId, { uploadId, title, categoryId });
      // pollAfterMs 告诉前端多久后来轮询结果
      return { analysisId, status: 'queued', pollAfterMs: 700 };
    },
  );
  // 202 Accepted：任务已受理，等待前端轮询
  return jsonWithVisitor(response, { status }, visitor);
}
