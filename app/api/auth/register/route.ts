import { NextResponse } from 'next/server';
import { hashPassword, isSecureRequest, sessionCookieHeader } from '@/lib/auth';
import { createSession, createUser } from '@/lib/repository';

export async function POST(request: Request) {
  const body = (await request.json()) as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password;
  if (!username || username.length > 32 || !password || password.length < 6) {
    return NextResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '用户名 1-32 字符，密码至少 6 位' } }, { status: 400 });
  }

  const { hash, salt } = await hashPassword(password);
  let userId: string;
  try {
    userId = await createUser(username, hash, salt);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      return NextResponse.json({ error: { code: 'USERNAME_TAKEN', message: '用户名已存在' } }, { status: 409 });
    }
    throw error;
  }

  const token = await createSession(userId);
  const response = NextResponse.json({ userId, username }, { status: 201 });
  response.headers.append('Set-Cookie', sessionCookieHeader(token, isSecureRequest(request)));
  return response;
}
