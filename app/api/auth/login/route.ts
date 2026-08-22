/**
 * POST /api/auth/login —— 登录
 *
 * 作用：校验用户名与密码，成功则建立会话并下发会话 cookie。
 * 时机：用户在登录页提交登录表单。
 * 入参（JSON body）：username、password，缺失返回 400。
 * 返回（200）：{ userId, username }，并通过 Set-Cookie 下发会话；
 *       用户不存在或密码错误统一返回 401「用户名或密码错误」（不暴露账号是否存在）。
 */
import { NextResponse } from 'next/server';
import { isSecureRequest, sessionCookieHeader, verifyPassword } from '@/lib/auth';
import { createSession, findUserByName } from '@/lib/repository';

export async function POST(request: Request) {
  // 解析凭据
  const body = (await request.json()) as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password;
  if (!username || !password) {
    return NextResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '请输入用户名和密码' } }, { status: 400 });
  }

  // 查用户 + 校验密码；两种失败用同一提示，避免泄露用户名是否存在
  const user = await findUserByName(username);
  if (!user || !(await verifyPassword(password, user.passwordHash, user.passwordSalt))) {
    return NextResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } }, { status: 401 });
  }

  // 建会话并下发 cookie
  const token = await createSession(user.id);
  const response = NextResponse.json({ userId: user.id, username }, { status: 200 });
  response.headers.append('Set-Cookie', sessionCookieHeader(token, isSecureRequest(request)));
  return response;
}
