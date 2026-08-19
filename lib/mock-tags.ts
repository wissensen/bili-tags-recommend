import type { RecommendTag } from './types';

export const MOCK_TAG_BATCHES: RecommendTag[][] = [
  [
    { candidateId: 'tag-film-edit', text: '影视剪辑', kind: 'atomic', displayBadge: 'primary' },
    { candidateId: 'tag-funny', text: '搞笑', kind: 'atomic', displayBadge: 'hot' },
    { candidateId: 'tag-classic-film', text: '经典电影', kind: 'atomic', displayBadge: 'fans' },
    { candidateId: 'tag-edit', text: '剪辑', kind: 'atomic' },
    { candidateId: 'tag-tv', text: '电视剧', kind: 'atomic' },
  ],
  [
    { candidateId: 'tag-anime', text: '热血动漫', kind: 'atomic', displayBadge: 'primary' },
    { candidateId: 'tag-mashup', text: '混剪', kind: 'atomic', displayBadge: 'hot' },
    { candidateId: 'tag-exciting', text: '高燃', kind: 'atomic', displayBadge: 'fans' },
    { candidateId: 'combo-scene-commentary', text: '名场面✕解说', kind: 'composite' },
    { candidateId: 'tag-famous-scene', text: '名场面', kind: 'atomic' },
  ],
  [
    { candidateId: 'tag-scifi', text: '科幻大片', kind: 'atomic', displayBadge: 'primary' },
    { candidateId: 'tag-comedy', text: '喜剧', kind: 'atomic', displayBadge: 'hot' },
    { candidateId: 'tag-suspense', text: '悬疑', kind: 'atomic', displayBadge: 'fans' },
    { candidateId: 'combo-horror-documentary', text: '恐怖✕纪录片', kind: 'composite' },
    { candidateId: 'tag-documentary', text: '纪录片', kind: 'atomic' },
  ],
  [
    { candidateId: 'tag-domestic-drama', text: '国产剧', kind: 'atomic', displayBadge: 'primary' },
    { candidateId: 'tag-us-drama', text: '美剧', kind: 'atomic', displayBadge: 'hot' },
    { candidateId: 'tag-jp-drama', text: '日剧', kind: 'atomic', displayBadge: 'fans' },
    { candidateId: 'combo-animation-commentary', text: '动画✕解说', kind: 'composite' },
    { candidateId: 'tag-animation', text: '动画', kind: 'atomic' },
  ],
];
