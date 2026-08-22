import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { findUsernameById } from '@/lib/repository';

export async function GET(request: Request) {
  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '未登录' } }, { status: 401 });
  }
  const username = await findUsernameById(user.userId);
  return NextResponse.json({ userId: user.userId, username });
}
