import { NextResponse } from 'next/server';
import { SESSION_COOKIE, clearSessionCookieHeader, isSecureRequest } from '@/lib/auth';
import { deleteSession } from '@/lib/repository';

export async function POST(request: Request) {
  const token = request.headers.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (token) await deleteSession(token);
  const response = NextResponse.json({ ok: true });
  response.headers.append('Set-Cookie', clearSessionCookieHeader(isSecureRequest(request)));
  return response;
}
