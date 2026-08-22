/**
 * GET /api/auth/me —— 当前登录用户
 *
 * 作用：返回当前会话对应的用户信息，供前端判断登录态、渲染顶栏用户名。
 * 时机：主页挂载时校验登录态；未登录则前端跳转登录页。
 * 入参：无（从会话 cookie 识别）。
 * 返回：{ userId, username }；未登录返回 401。
 */
import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { findUsernameById } from '@/lib/repository';

export async function GET(request: Request) {
  // 从会话 cookie 解析出用户；无有效会话 → 401
  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '未登录' } }, { status: 401 });
  }
  const username = await findUsernameById(user.userId);
  return NextResponse.json({ userId: user.userId, username });
}
