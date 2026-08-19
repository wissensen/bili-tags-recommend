import { NextResponse } from 'next/server';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  // TODO: 对 R2 对象执行 HEAD、文件头检测和大小校验，再更新 upload_assets 状态。
  return NextResponse.json({ uploadId: id, status: 'verified' });
}
