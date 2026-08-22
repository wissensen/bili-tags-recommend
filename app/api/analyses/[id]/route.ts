/**
 * GET /api/analyses/:id —— 查询分析结果（轮询）
 *
 * 作用：投稿链路第 ④ 步。返回分析任务当前状态；成功时附带 sessionId
 *       （推荐会话钥匙，供第 ⑤ 步拉取候选标签）。
 * 时机：发起分析后，前端按 pollAfterMs 间隔轮询，直到 succeeded。
 *       当前 mock 秒回成功，故实际只查一次。
 * 入参：路径参数 :id 即 analysisId。
 * 返回：{ analysisId, status, sessionId, error? }；不存在或无权访问返回 404。
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getAnalysis } from '@/lib/repository';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const analysis = await getAnalysis(auth.userId, id);
  if (!analysis) {
    return NextResponse.json({ error: { code: 'ANALYSIS_NOT_FOUND', message: '分析不存在或无权访问' } }, { status: 404 });
  }
  return NextResponse.json({
    analysisId: analysis.id,
    status: analysis.status,
    sessionId: analysis.sessionId,
    error: analysis.errorCode ? { code: analysis.errorCode, message: analysis.errorMessage } : undefined,
  });
}
