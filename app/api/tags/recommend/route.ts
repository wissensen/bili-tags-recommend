import { NextResponse } from 'next/server';
import { MOCK_TAG_BATCHES } from '@/lib/mock-tags';
import type { RecommendTag, SelectedTag } from '@/lib/types';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    cursor?: string;
    selectedTags?: SelectedTag[];
  };

  if (!body.sessionId) {
    return NextResponse.json({ error: { code: 'INVALID_SESSION', message: '缺少推荐会话' } }, { status: 400 });
  }

  const selected = new Set((body.selectedTags ?? []).map((tag) => tag.text.trim().toLocaleLowerCase()));
  const hasPrimary = selected.size > 0;
  const batchIndex = Number.parseInt(body.cursor ?? '0', 10) % MOCK_TAG_BATCHES.length;
  const orderedPool = [
    ...MOCK_TAG_BATCHES[batchIndex],
    ...MOCK_TAG_BATCHES.flat().filter((tag) => !MOCK_TAG_BATCHES[batchIndex].some((item) => item.candidateId === tag.candidateId)),
  ];

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

  const nextIndex = (batchIndex + 1) % MOCK_TAG_BATCHES.length;

  // TODO: 从 recommendation_sessions 的稳定候选快照按不透明 cursor 分页。
  return NextResponse.json({
    tags,
    nextCursor: String(nextIndex),
    isExhausted: false,
    cycle: nextIndex === 0 ? 1 : 0,
    rankingVersion: 'mock-v1',
  });
}
