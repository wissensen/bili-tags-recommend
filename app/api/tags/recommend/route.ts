import { NextResponse } from 'next/server';
import { MOCK_TAG_BATCHES } from '@/lib/mock-tags';
import type { RecommendTag, SelectedTag } from '@/lib/types';
import { getDatabase, getVisitor, jsonWithVisitor } from '@/lib/cloudflare';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    cursor?: string;
    selectedTags?: SelectedTag[];
  };

  if (!body.sessionId) {
    return NextResponse.json({ error: { code: 'INVALID_SESSION', message: '缺少推荐会话' } }, { status: 400 });
  }

  const visitor = await getVisitor(request);
  const db = await getDatabase();
  const selected = new Set((body.selectedTags ?? []).map((tag) => tag.text.trim().toLocaleLowerCase()));
  const hasPrimary = selected.size > 0;
  let orderedPool: RecommendTag[];
  let rankingVersion = 'mock-v1';

  if (db) {
    const session = await db.prepare(
      `SELECT candidates_json, ranking_version, expires_at FROM recommendation_sessions WHERE id = ? AND owner_id = ?`,
    ).bind(body.sessionId, visitor.ownerId).first<{ candidates_json: string; ranking_version: string; expires_at: string }>();
    if (!session || Date.parse(session.expires_at) <= Date.now()) {
      return jsonWithVisitor({ error: { code: 'INVALID_SESSION', message: '推荐会话不存在或已过期' } }, { status: 404 }, visitor);
    }
    orderedPool = JSON.parse(session.candidates_json) as RecommendTag[];
    rankingVersion = session.ranking_version;
  } else {
    const batchIndex = Number.parseInt(body.cursor ?? '0', 10) % MOCK_TAG_BATCHES.length;
    orderedPool = [
      ...MOCK_TAG_BATCHES[batchIndex],
      ...MOCK_TAG_BATCHES.flat().filter((tag) => !MOCK_TAG_BATCHES[batchIndex].some((item) => item.candidateId === tag.candidateId)),
    ];
  }

  const tags: RecommendTag[] = [];
  for (const candidate of orderedPool) {
    if (selected.has(candidate.text.toLocaleLowerCase())) continue;
    if (tags.some((tag) => tag.candidateId === candidate.candidateId || tag.text === candidate.text)) continue;
    if (hasPrimary && candidate.displayBadge === 'primary') continue;
    tags.push(candidate);
    if (tags.length === 5) break;
  }

  tags.sort((a, b) => {
    if (!hasPrimary) return 0;
    const priority = { hot: 0, fans: 1, primary: 2 } as const;
    return (a.displayBadge ? priority[a.displayBadge] : 3) - (b.displayBadge ? priority[b.displayBadge] : 3);
  });

  const nextIndex = (Number.parseInt(body.cursor ?? '0', 10) + 1) % Math.max(1, Math.ceil(orderedPool.length / 5));

  return jsonWithVisitor({
    tags,
    nextCursor: String(nextIndex),
    isExhausted: false,
    cycle: nextIndex === 0 ? 1 : 0,
    rankingVersion,
  }, undefined, visitor);
}
