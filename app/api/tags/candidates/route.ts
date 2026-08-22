/**
 * GET /api/tags/candidates —— 一次性拉取整包推荐候选
 *
 * 作用：投稿链路第 ⑤ 步。把这次会话的全部候选标签一次返回，原子标签
 *       （主/副标签，已按置信度排序、带角标）与组合标签（A✕B，无角标）
 *       分成两个字段。后端只负责「选品」下发，不做编排。
 * 时机：分析成功（第 ④ 步拿到 sessionId）后拉取一次；之后「换一批」由
 *       前端本地翻页（buildRecommendationView），不再请求后端。
 * 入参：query 参数 sessionId，缺失返回 400。
 * 返回：{ atomic, composite, rankingVersion }；会话不存在或已过期返回 404。
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getSessionCandidates } from '@/lib/repository';

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: { code: 'INVALID_SESSION', message: '缺少推荐会话' } }, { status: 400 });
  }
  const candidates = await getSessionCandidates(auth.userId, sessionId);
  if (!candidates) {
    return NextResponse.json({ error: { code: 'INVALID_SESSION', message: '推荐会话不存在或已过期' } }, { status: 404 });
  }
  return NextResponse.json(candidates);
}
