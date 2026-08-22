/**
 * POST /api/auth/logout —— 登出
 *
 * 作用：删除当前会话记录并清除会话 cookie。
 * 时机：用户点顶栏「退出登录」。
 * 入参：无（从 Cookie 读取会话 token）。
 * 返回：{ ok: true }，并通过 Set-Cookie（Max-Age=0）清除会话。
 */
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, clearSessionCookieHeader, isSecureRequest } from '@/lib/auth';
import { deleteSession } from '@/lib/repository';

export async function POST(request: Request) {
  // 从 cookie 取会话 token，存在则从库中删除该会话
  const token = request.headers.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (token) await deleteSession(token);
  // 无论有无 token 都清除客户端 cookie
  const response = NextResponse.json({ ok: true });
  response.headers.append('Set-Cookie', clearSessionCookieHeader(isSecureRequest(request)));
  return response;
}
