/**
 * POST /api/auth/register —— 注册并自动登录
 *
 * 作用：创建新用户（密码经 PBKDF2 加盐哈希存储），注册成功即建立会话、
 *       下发会话 cookie，相当于顺带登录。
 * 时机：用户在登录页切到「注册」并提交。
 * 入参（JSON body）：username（1-32 字符）、password（≥6 位），不满足返回 400；
 *       用户名已存在返回 409。
 * 返回（201）：{ userId, username }，并通过 Set-Cookie 下发会话。
 */
import { NextResponse } from 'next/server';
import { hashPassword, isSecureRequest, sessionCookieHeader } from '@/lib/auth';
import { createSession, createUser } from '@/lib/repository';

export async function POST(request: Request) {
  // 解析并规整凭据
  const body = (await request.json()) as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password;
  // 校验：用户名 1-32 字符、密码至少 6 位
  if (!username || username.length > 32 || !password || password.length < 6) {
    return NextResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '用户名 1-32 字符，密码至少 6 位' } }, { status: 400 });
  }

  // 生成随机盐并派生哈希，绝不存明文
  const { hash, salt } = await hashPassword(password);
  let userId: string;
  try {
    userId = await createUser(username, hash, salt);
  } catch (error) {
    // 用户名唯一约束冲突 → 409
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      return NextResponse.json({ error: { code: 'USERNAME_TAKEN', message: '用户名已存在' } }, { status: 409 });
    }
    throw error;
  }

  // 建会话并下发 cookie（注册即登录）
  const token = await createSession(userId);
  const response = NextResponse.json({ userId, username }, { status: 201 });
  response.headers.append('Set-Cookie', sessionCookieHeader(token, isSecureRequest(request)));
  return response;
}
