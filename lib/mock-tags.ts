import type { RecommendTag } from './types';

// TODO(algo): 以下为 mock 候选，模拟算法下发的两份结果；
// 接入真实算法后由算法返回替换（保持 atomic/composite 两份结构）。

// 主/副标签候选，按置信度降序；含多个 primary 供换一批轮换。
export const MOCK_ATOMIC_TAGS: RecommendTag[] = [
  { candidateId: 'tag-film-edit', text: '影视剪辑', kind: 'atomic', displayBadge: 'primary' },
  { candidateId: 'tag-anime', text: '热血动漫', kind: 'atomic', displayBadge: 'primary' },
  { candidateId: 'tag-scifi', text: '科幻大片', kind: 'atomic', displayBadge: 'primary' },
  { candidateId: 'tag-domestic-drama', text: '国产剧', kind: 'atomic', displayBadge: 'primary' },
  { candidateId: 'tag-funny', text: '搞笑', kind: 'atomic', displayBadge: 'hot' },
  { candidateId: 'tag-mashup', text: '混剪', kind: 'atomic', displayBadge: 'hot' },
  { candidateId: 'tag-comedy', text: '喜剧', kind: 'atomic', displayBadge: 'hot' },
  { candidateId: 'tag-classic-film', text: '经典电影', kind: 'atomic', displayBadge: 'fans' },
  { candidateId: 'tag-exciting', text: '高燃', kind: 'atomic', displayBadge: 'fans' },
  { candidateId: 'tag-suspense', text: '悬疑', kind: 'atomic', displayBadge: 'fans' },
  { candidateId: 'tag-edit', text: '剪辑', kind: 'atomic' },
  { candidateId: 'tag-tv', text: '电视剧', kind: 'atomic' },
  { candidateId: 'tag-famous-scene', text: '名场面', kind: 'atomic' },
  { candidateId: 'tag-documentary', text: '纪录片', kind: 'atomic' },
  { candidateId: 'tag-animation', text: '动画', kind: 'atomic' },
  { candidateId: 'tag-us-drama', text: '美剧', kind: 'atomic' },
  { candidateId: 'tag-jp-drama', text: '日剧', kind: 'atomic' },
];

// 组合标签候选，由算法拼好，无角标。
export const MOCK_COMPOSITE_TAGS: RecommendTag[] = [
  { candidateId: 'combo-horror-documentary', text: '恐怖✕纪录片', kind: 'composite' },
  { candidateId: 'combo-scifi-suspense', text: '科幻大片✕悬疑', kind: 'composite' },
  { candidateId: 'combo-scene-commentary', text: '名场面✕解说', kind: 'composite' },
  { candidateId: 'combo-animation-commentary', text: '动画✕解说', kind: 'composite' },
  { candidateId: 'combo-classic-mashup', text: '经典电影✕混剪', kind: 'composite' },
];
