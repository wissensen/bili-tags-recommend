import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { getAnalysis } from '@/lib/repository';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const visitor = await getVisitor(request);
  const analysis = await getAnalysis(visitor.ownerId, id);
  if (!analysis) {
    return jsonWithVisitor({ error: { code: 'ANALYSIS_NOT_FOUND', message: '分析不存在或无权访问' } }, { status: 404 }, visitor);
  }
  return jsonWithVisitor(
    {
      analysisId: analysis.id,
      status: analysis.status,
      sessionId: analysis.sessionId,
      error: analysis.errorCode ? { code: analysis.errorCode, message: analysis.errorMessage } : undefined,
    },
    undefined,
    visitor,
  );
}
