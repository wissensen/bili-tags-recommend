import { NextResponse } from 'next/server';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  // TODO: 从 D1 读取真实分析状态和 recommendation session。
  return NextResponse.json({
    analysisId: id,
    status: 'succeeded',
    sessionId: `session_${id}`,
  });
}
