import type { RecommendTag, SelectedTag } from './types';

export function tagIdentity(text: string): string {
  return text.trim().replace(/\s+/g, ' ').normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function ringTake(pool: RecommendTag[], start: number, count: number): RecommendTag[] {
  const out: RecommendTag[] = [];
  const seen = new Set<string>();
  if (pool.length === 0 || count <= 0) return out;
  for (let i = 0; i < pool.length && out.length < count; i += 1) {
    const item = pool[(start + i) % pool.length];
    if (seen.has(item.candidateId)) continue;
    seen.add(item.candidateId);
    out.push(item);
  }
  return out;
}

export function buildRecommendationView(
  atomic: RecommendTag[],
  composite: RecommendTag[],
  opts: { selectedTags: SelectedTag[]; cursor: number; size?: number },
): { tags: RecommendTag[]; nextCursor: number } {
  const size = opts.size ?? 5;
  const cursor = opts.cursor;
  const selected = new Set(opts.selectedTags.map((t) => tagIdentity(t.text)));

  const atomicAvail = atomic.filter((t) => !selected.has(tagIdentity(t.text)));
  const compAvail = composite.filter((t) => !selected.has(tagIdentity(t.text)));

  const want = (cursor % 2) + 1; // 1 或 2
  const compCount = Math.min(want, compAvail.length);
  const atomicCount = size - compCount;

  const hasSelected = opts.selectedTags.length > 0;
  const primaries = atomicAvail.filter((t) => t.displayBadge === 'primary');
  const nonPrimary = atomicAvail.filter((t) => t.displayBadge !== 'primary');

  const atomicResult: RecommendTag[] = [];
  if (!hasSelected && primaries.length > 0) {
    const chosen = primaries[cursor % primaries.length];
    atomicResult.push(chosen);
    atomicResult.push(...ringTake(nonPrimary, cursor % Math.max(1, nonPrimary.length), atomicCount - 1));
  } else {
    const seq = hasSelected ? nonPrimary : [...primaries, ...nonPrimary];
    atomicResult.push(...ringTake(seq, cursor % Math.max(1, seq.length), atomicCount));
  }

  const compResult = ringTake(compAvail, cursor % Math.max(1, compAvail.length), compCount);

  return { tags: [...atomicResult, ...compResult], nextCursor: cursor + 1 };
}
