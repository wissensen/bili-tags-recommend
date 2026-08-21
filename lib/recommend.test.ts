import { describe, expect, test } from 'vitest';
import { buildRecommendationView, tagIdentity } from '@/lib/recommend';
import type { RecommendTag } from '@/lib/types';

const atomic: RecommendTag[] = [
  { candidateId: 'p1', text: '影视剪辑', kind: 'atomic', displayBadge: 'primary' },
  { candidateId: 'p2', text: '热血动漫', kind: 'atomic', displayBadge: 'primary' },
  { candidateId: 'h1', text: '搞笑', kind: 'atomic', displayBadge: 'hot' },
  { candidateId: 'f1', text: '经典电影', kind: 'atomic', displayBadge: 'fans' },
  { candidateId: 'n1', text: '剪辑', kind: 'atomic' },
  { candidateId: 'n2', text: '电视剧', kind: 'atomic' },
  { candidateId: 'n3', text: '纪录片', kind: 'atomic' },
  { candidateId: 'n4', text: '动画', kind: 'atomic' },
];
const composite: RecommendTag[] = [
  { candidateId: 'c1', text: '恐怖✕纪录片', kind: 'composite' },
  { candidateId: 'c2', text: '科幻✕悬疑', kind: 'composite' },
  { candidateId: 'c3', text: '名场面✕解说', kind: 'composite' },
];

test('tagIdentity 归一化大小写与空白', () => {
  expect(tagIdentity('  ABc ')).toBe(tagIdentity('abc'));
});

test('零已选：第1位是 primary，共5个，组合在末尾', () => {
  const { tags } = buildRecommendationView(atomic, composite, { selectedTags: [], cursor: 0 });
  expect(tags).toHaveLength(5);
  expect(tags[0].displayBadge).toBe('primary');
  expect(tags[tags.length - 1].kind).toBe('composite');
});

test('零已选换一批：第1位轮换成另一个 primary', () => {
  const a = buildRecommendationView(atomic, composite, { selectedTags: [], cursor: 0 });
  const b = buildRecommendationView(atomic, composite, { selectedTags: [], cursor: 1 });
  expect(a.tags[0].candidateId).not.toBe(b.tags[0].candidateId);
  expect(a.tags[0].displayBadge).toBe('primary');
  expect(b.tags[0].displayBadge).toBe('primary');
});

test('已选≥1：结果不含任何 primary，共5个，组合在末尾', () => {
  const { tags } = buildRecommendationView(atomic, composite, {
    selectedTags: [{ text: '影视剪辑' }],
    cursor: 0,
  });
  expect(tags).toHaveLength(5);
  expect(tags.some((t) => t.displayBadge === 'primary')).toBe(false);
  expect(tags[tags.length - 1].kind).toBe('composite');
});

test('去重：已选标签不再出现，本屏无重复', () => {
  const { tags } = buildRecommendationView(atomic, composite, {
    selectedTags: [{ text: '搞笑' }],
    cursor: 0,
  });
  expect(tags.some((t) => tagIdentity(t.text) === tagIdentity('搞笑'))).toBe(false);
  const ids = tags.map((t) => t.candidateId);
  expect(new Set(ids).size).toBe(ids.length);
});

test('组合置底且数量1~2', () => {
  const { tags } = buildRecommendationView(atomic, composite, { selectedTags: [], cursor: 0 });
  const comps = tags.filter((t) => t.kind === 'composite');
  expect(comps.length).toBeGreaterThanOrEqual(1);
  expect(comps.length).toBeLessThanOrEqual(2);
  // 组合都在末尾
  const firstComp = tags.findIndex((t) => t.kind === 'composite');
  expect(tags.slice(firstComp).every((t) => t.kind === 'composite')).toBe(true);
});

test('组合池为空：用 atomic 补足，仍5个', () => {
  const { tags } = buildRecommendationView(atomic, [], { selectedTags: [], cursor: 0 });
  expect(tags).toHaveLength(5);
  expect(tags.every((t) => t.kind === 'atomic')).toBe(true);
});

test('翻页循环：cursor 超过池长度仍返回5个', () => {
  const { tags } = buildRecommendationView(atomic, composite, { selectedTags: [], cursor: 99 });
  expect(tags).toHaveLength(5);
});
