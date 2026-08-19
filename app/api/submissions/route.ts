import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = (await request.json()) as { title?: string; categoryId?: string; tags?: Array<{ text?: string }> };

  if (!body.title || !body.categoryId || !body.tags?.length) {
    return NextResponse.json({ error: { code: 'INVALID_SUBMISSION', message: '请完善稿件信息并至少选择一个标签' } }, { status: 422 });
  }

  // TODO: 执行服务端标签规范化与幂等校验，并在 D1 事务中写入 submissions/submission_tags。
  return NextResponse.json({ submissionId: `submission_${crypto.randomUUID()}`, status: 'submitted' });
}
