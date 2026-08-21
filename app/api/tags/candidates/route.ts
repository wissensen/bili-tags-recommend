import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { getSessionCandidates } from '@/lib/repository';

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  const visitor = await getVisitor(request);
  if (!sessionId) {
    return jsonWithVisitor({ error: { code: 'INVALID_SESSION', message: '缺少推荐会话' } }, { status: 400 }, visitor);
  }

  const candidates = await getSessionCandidates(visitor.ownerId, sessionId);
  if (!candidates) {
    return jsonWithVisitor({ error: { code: 'INVALID_SESSION', message: '推荐会话不存在或已过期' } }, { status: 404 }, visitor);
  }
  return jsonWithVisitor(candidates, undefined, visitor);
}
