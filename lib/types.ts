export type Badge = 'primary' | 'hot' | 'fans';

export type RecommendTag = {
  candidateId: string;
  text: string;
  kind: 'atomic' | 'composite';
  displayBadge?: Badge;
};

export type SelectedTag = {
  text: string;
  candidateId?: string;
};

export type CandidatesResponse = {
  atomic: RecommendTag[];
  composite: RecommendTag[];
  rankingVersion: string;
};
