import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = (await request.json()) as { uploadId?: string; title?: string; categoryId?: string };

  if (!body.uploadId || !body.title || !body.categoryId) {
    return NextResponse.json({ error: { code: 'INVALID_ANALYSIS', message: '分析参数不完整' } }, { status: 400 });
  }

  // TODO: 写入 analysis_jobs 并投递 Cloudflare Queue；此处仅返回 mock 任务。
  return NextResponse.json(
    { analysisId: `analysis_${crypto.randomUUID()}`, status: 'queued', pollAfterMs: 700 },
    { status: 202 },
  );
}
