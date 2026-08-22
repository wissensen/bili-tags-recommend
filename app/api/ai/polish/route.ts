import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { polishMetadata } from '@/lib/ai';

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as { coverDataUrl?: string; title?: string; summary?: string };
  if (!body.coverDataUrl) {
    return NextResponse.json({ error: { code: 'MISSING_COVER', message: '请先添加封面' } }, { status: 400 });
  }

  try {
    const result = await polishMetadata({ coverDataUrl: body.coverDataUrl, title: body.title, summary: body.summary });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AI_UNAVAILABLE';
    const message = code === 'AI_TIMEOUT' ? 'AI 服务超时，请稍后手动重试' : 'AI 暂不可用，请稍后手动重试';
    return NextResponse.json({ error: { code: 'AI_UNAVAILABLE', message } }, { status: 502 });
  }
}
