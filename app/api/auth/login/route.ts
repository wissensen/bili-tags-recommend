import { NextResponse } from 'next/server';
import { isSecureRequest, sessionCookieHeader, verifyPassword } from '@/lib/auth';
import { createSession, findUserByName } from '@/lib/repository';

export async function POST(request: Request) {
  const body = (await request.json()) as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password;
  if (!username || !password) {
    return NextResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '请输入用户名和密码' } }, { status: 400 });
  }

  const user = await findUserByName(username);
  if (!user || !(await verifyPassword(password, user.passwordHash, user.passwordSalt))) {
    return NextResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } }, { status: 401 });
  }

  const token = await createSession(user.id);
  const response = NextResponse.json({ userId: user.id, username }, { status: 200 });
  response.headers.append('Set-Cookie', sessionCookieHeader(token, isSecureRequest(request)));
  return response;
}
