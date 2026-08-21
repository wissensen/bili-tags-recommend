# 组合标签推荐与前端编排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把推荐标签改为「后端一次下发候选、前端本地编排翻页/过滤/拖拽/复用」，补齐组合标签与主标签轮换规则，并重构现有接口逻辑。

**Architecture:** 后端负责「选品」（一次性返回排好序的原子池 + 组合池），前端负责「编排」（本地纯函数算出每屏 5 个）。删除逐次请求的 `tags/recommend`，新增一次性拉取的 `tags/candidates`。裸 SQL 收拢到 `lib/repository.ts`，路由瘦身为「解析→调用→返回」。

**Tech Stack:** Next.js 16 (App Router) · Cloudflare Workers + D1 (SQLite) · TypeScript · Vitest（新增，仅测纯函数）

## Global Constraints

- 运行环境始终有 D1；删除所有 `if(db)/else` 双分支，DB 为唯一路径。
- mock 只保留在「扮演算法/存储」处，统一注释 `// TODO(algo): …` 或 `// TODO(storage): …`。
- 接口契约与字段尽量不变；不新增「简介」字段。
- 组合标签：不带角标、永远置于列表末尾、不占主标签位、每屏 1~2 个。
- 主标签：池中含多个 `primary`；零已选时第 1 位放一个 primary，换一批按 cursor 轮换不同 primary；已选 ≥1 时结果不含任何 primary；删光回到零已选则 primary 重现。
- 大文件存 object_key（不存完整 URL）；本次唯一落库改动是把封面 key 写入 `submissions.cover_object_key`。
- 路径别名 `@/*` → 仓库根；Node 24 + pnpm 11。
- 拖拽用原生 HTML5 drag-and-drop，不引入第三方库。
- commit message 用中文，与现有历史一致。

---

## File Structure

- `vitest.config.ts`（新增）— 测试配置，解析 `@/*` 别名。
- `lib/recommend.ts`（新增）— 纯函数 `buildRecommendationView`，前端与测试共用，不依赖 D1/React。
- `lib/recommend.test.ts`（新增）— 纯函数单测。
- `lib/mock-tags.ts` — 重构为 `MOCK_ATOMIC_TAGS` + `MOCK_COMPOSITE_TAGS` 两份池。
- `lib/types.ts` — 补充候选返回结构类型。
- `lib/repository.ts`（新增）— 薄数据访问层，收拢 SQL。
- `lib/idempotency.ts`（新增）— `withIdempotency` helper。
- `lib/cloudflare.ts` — 保留访客/DB 工具。
- `migrations/0002_add_composite_json.sql`（新增）— 加 `composite_json` 列。
- `app/api/uploads/init/route.ts`、`app/api/uploads/[id]/complete/route.ts`、`app/api/analyses/route.ts`、`app/api/analyses/[id]/route.ts`、`app/api/submissions/route.ts` — 瘦身。
- `app/api/tags/candidates/route.ts`（新增）；`app/api/tags/recommend/route.ts`（删除）。
- `app/page.tsx` — 改用 candidates + 本地编排、拖拽、步骤返回、协议文案、组合长度校验。

---
## Task 1: 测试框架与迁移脚手架

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`（devDependencies + `test` script）
- Create: `migrations/0002_add_composite_json.sql`

**Interfaces:**
- Produces: `pnpm test` 命令可运行 Vitest；`@/*` 别名在测试中可解析；迁移 `0002` 为 `recommendation_sessions` 增加 `composite_json` 列。

- [ ] **Step 1: 安装 Vitest**

```bash
pnpm add -D vitest@^3 vite-tsconfig-paths@^5
```

- [ ] **Step 2: 写 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: 加 test script**

在 `package.json` 的 `scripts` 中加入：

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: 写迁移 0002**

创建 `migrations/0002_add_composite_json.sql`：

```sql
ALTER TABLE recommendation_sessions
  ADD COLUMN composite_json TEXT
  CHECK (composite_json IS NULL OR json_valid(composite_json));
```

- [ ] **Step 5: 本地应用迁移，确认成功**

Run: `pnpm d1:migrate:local`
Expected: 输出包含应用 `0002_add_composite_json.sql`，无报错。

- [ ] **Step 6: 冒烟测试确认 Vitest 可跑**

创建临时文件 `lib/smoke.test.ts`：

```ts
import { expect, test } from 'vitest';
test('vitest runs', () => { expect(1 + 1).toBe(2); });
```

Run: `pnpm test`
Expected: PASS，1 passed。随后删除该临时文件：`rm lib/smoke.test.ts`

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts migrations/0002_add_composite_json.sql
git commit -m "chore: 引入 Vitest 与 composite_json 迁移"
```

---

## Task 2: 类型与 mock 候选池重构

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/mock-tags.ts`

**Interfaces:**
- Consumes: 现有 `RecommendTag`、`Badge`、`SelectedTag`（`lib/types.ts`）。
- Produces:
  - `CandidatesResponse = { atomic: RecommendTag[]; composite: RecommendTag[]; rankingVersion: string }`（`lib/types.ts`）。
  - `MOCK_ATOMIC_TAGS: RecommendTag[]`（含**多个** `primary`，按置信度降序，含 hot/fans 与无角标普通项）。
  - `MOCK_COMPOSITE_TAGS: RecommendTag[]`（`kind: 'composite'`，无 `displayBadge`，文案形如 `A✕B`）。

- [ ] **Step 1: 加候选返回类型**

在 `lib/types.ts` 末尾追加：

```ts
export type CandidatesResponse = {
  atomic: RecommendTag[];
  composite: RecommendTag[];
  rankingVersion: string;
};
```

- [ ] **Step 2: 重构 mock-tags 为两份池**

将 `lib/mock-tags.ts` 整体替换为：

```ts
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
```

- [ ] **Step 3: 确认无遗留引用 MOCK_TAG_BATCHES**

Run: `grep -rn "MOCK_TAG_BATCHES" app lib`
Expected: 仅 `app/api/analyses/route.ts` 与 `app/api/tags/recommend/route.ts` 命中（下游任务会改/删它们）。记录结果，暂不处理。

- [ ] **Step 4: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 仅 `analyses`/`recommend` 路由因引用已删除的 `MOCK_TAG_BATCHES` 报错（预期内，后续任务修复）。确认没有 `lib/` 内的新错误。

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/mock-tags.ts
git commit -m "refactor: mock 标签拆为 atomic/composite 两份候选池"
```

---

## Task 3: 前端编排纯函数 buildRecommendationView

**Files:**
- Create: `lib/recommend.ts`
- Test: `lib/recommend.test.ts`

**Interfaces:**
- Consumes: `RecommendTag`、`SelectedTag`（`lib/types.ts`）。
- Produces:
  - `tagIdentity(text: string): string` — 标签归一化（去空白、NFKC、小写），用于去重比较。
  - `buildRecommendationView(atomic: RecommendTag[], composite: RecommendTag[], opts: { selectedTags: SelectedTag[]; cursor: number; size?: number }): { tags: RecommendTag[]; nextCursor: number }` —
    纯函数、确定性（同输入同输出）；`size` 默认 5。

**算法约定（实现须严格遵守）：**
- `norm(t)` = `tagIdentity(t)`。`selected` = `selectedTags` 文案 norm 后的集合。
- 从 `atomic`、`composite` 中先剔除 norm 命中 `selected` 的项，得 `atomicAvail`、`compAvail`。
- **组合数量** `compCount`：`compAvail` 为空 → 0；否则由 `cursor` 决定 1 或 2（`compAvail.length === 1` 时最多 1）：`want = (cursor % 2) + 1`，`compCount = min(want, compAvail.length)`。目标 `atomicCount = size - compCount`。
- **primary 处理**：
  - `hasSelected = selectedTags.length > 0`。
  - `primaries = atomicAvail.filter(displayBadge === 'primary')`；`nonPrimary = atomicAvail.filter(displayBadge !== 'primary')`。
  - `hasSelected` 为 true：不放 primary，原子序列 `seq = nonPrimary`。
  - `hasSelected` 为 false 且 `primaries` 非空：选一个 primary 置顶 = `primaries[cursor % primaries.length]`；原子序列 `seq = [chosenPrimary, ...nonPrimary]`（chosenPrimary 在第 0 位）。
  - `hasSelected` 为 false 且 `primaries` 为空：`seq = nonPrimary`。
- **取原子**：从 `seq` 按 `offset = cursor % max(1, seq.length)` 起，环形取 `atomicCount` 个且不重复（按 candidateId 去重；`seq` 内本身唯一，环形取到重复即停止补足）。**若第 0 位是 chosenPrimary，则它必须包含且在首位**：实现上先把 chosenPrimary 固定为结果第 0 项，再从 `nonPrimary` 环形取 `atomicCount - 1` 个。
- **取组合**：从 `compAvail` 按 `offset = cursor % max(1, compAvail.length)` 起环形取 `compCount` 个不重复。
- **拼装**：`tags = [ ...原子结果, ...组合结果 ]`，组合永远在末尾。总数为 `min(size, atomicAvail(计入primary) + compAvail 去重后可用量)`。
- `nextCursor = cursor + 1`。

- [ ] **Step 1: 写失败测试**

创建 `lib/recommend.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，报 `buildRecommendationView` / `tagIdentity` 未定义（模块不存在）。

- [ ] **Step 3: 实现纯函数**

创建 `lib/recommend.ts`：

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS，全部用例通过。

- [ ] **Step 5: Commit**

```bash
git add lib/recommend.ts lib/recommend.test.ts
git commit -m "feat: 新增前端推荐编排纯函数 buildRecommendationView"
```

---

## Task 4: 数据访问层与幂等 helper

**Files:**
- Create: `lib/repository.ts`
- Create: `lib/idempotency.ts`

**Interfaces:**
- Consumes: `getDatabase`（`lib/cloudflare.ts`）、`D1DatabaseLike`（`lib/cloudflare.ts`）、`MOCK_ATOMIC_TAGS`/`MOCK_COMPOSITE_TAGS`（`lib/mock-tags.ts`）、`RecommendTag`（`lib/types.ts`）。
- Produces（`lib/repository.ts`）：
  - `createUpload(ownerId, { fileName, mimeType, size }): Promise<string>` → 返回 uploadId。
  - `verifyUpload(ownerId, uploadId): Promise<boolean>` → 是否命中并置为 verified。
  - `findVerifiedUpload(ownerId, uploadId): Promise<boolean>`。
  - `createAnalysisWithSession(ownerId, { uploadId, title, categoryId }): Promise<{ analysisId: string; sessionId: string }>` → 建分析任务（mock 直接 succeeded）+ 推荐会话（写入 atomic/composite 两份候选）。
  - `getAnalysis(ownerId, analysisId): Promise<{ id: string; status: string; sessionId: string | null; errorCode: string | null; errorMessage: string | null } | null>`。
  - `getSessionCandidates(ownerId, sessionId): Promise<{ atomic: RecommendTag[]; composite: RecommendTag[]; rankingVersion: string } | null>` → 会话过期或不存在返回 null。
  - `findOwnedAnalysis(ownerId, { analysisId, uploadId }): Promise<boolean>`。
  - `saveSubmission(ownerId, { uploadId, analysisId, title, categoryId, coverObjectKey, tags }): Promise<string>` → 返回 submissionId；写入 `submissions`（含 `cover_object_key`）与 `submission_tags`。
- Produces（`lib/idempotency.ts`）：
  - `withIdempotency<T>(ownerId, scope, key: string | null, status: number, produce: () => Promise<T>): Promise<{ body: T; status: number }>` — key 为 null 时直接执行 produce；否则先查命中则返回缓存，未命中执行并存缓存。

- [ ] **Step 1: 写 idempotency helper**

创建 `lib/idempotency.ts`：

```ts
import { getDatabase } from './cloudflare';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function withIdempotency<T>(
  ownerId: string,
  scope: string,
  key: string | null,
  status: number,
  produce: () => Promise<T>,
): Promise<{ body: T; status: number }> {
  const db = await getDatabase();
  if (!key || !db) {
    return { body: await produce(), status };
  }

  const previous = await db
    .prepare(
      `SELECT response_status, response_json FROM idempotency_keys WHERE owner_id = ? AND scope = ? AND idempotency_key = ?`,
    )
    .bind(ownerId, scope, key)
    .first<{ response_status: number | null; response_json: string | null }>();
  if (previous?.response_json) {
    return { body: JSON.parse(previous.response_json) as T, status: previous.response_status ?? status };
  }

  const body = await produce();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR REPLACE INTO idempotency_keys (owner_id, scope, idempotency_key, response_status, response_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(ownerId, scope, key, status, JSON.stringify(body), now, new Date(Date.now() + ONE_DAY_MS).toISOString())
    .run();
  return { body, status };
}
```

- [ ] **Step 2: 写 repository**

创建 `lib/repository.ts`：

```ts
import { getDatabase } from './cloudflare';
import { MOCK_ATOMIC_TAGS, MOCK_COMPOSITE_TAGS } from './mock-tags';
import type { RecommendTag } from './types';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function db() {
  const database = await getDatabase();
  if (!database) throw new Error('D1 database is not bound');
  return database;
}

export async function createUpload(
  ownerId: string,
  input: { fileName: string; mimeType: string; size: number },
): Promise<string> {
  const uploadId = crypto.randomUUID();
  // TODO(storage): 目前仅登记元信息，真实场景需接入 OSS/服务器直传后回填 object_key。
  await (await db())
    .prepare(
      `INSERT INTO upload_assets (id, owner_id, file_name, mime_type, byte_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'local_only', ?)`,
    )
    .bind(uploadId, ownerId, input.fileName, input.mimeType, input.size, new Date().toISOString())
    .run();
  return uploadId;
}

export async function verifyUpload(ownerId: string, uploadId: string): Promise<boolean> {
  const result = (await (await db())
    .prepare(`UPDATE upload_assets SET status = 'verified', verified_at = ? WHERE id = ? AND owner_id = ?`)
    .bind(new Date().toISOString(), uploadId, ownerId)
    .run()) as { meta?: { changes?: number } };
  return Boolean(result.meta?.changes);
}

export async function findVerifiedUpload(ownerId: string, uploadId: string): Promise<boolean> {
  const row = await (await db())
    .prepare(`SELECT id FROM upload_assets WHERE id = ? AND owner_id = ? AND status = 'verified'`)
    .bind(uploadId, ownerId)
    .first();
  return Boolean(row);
}

export async function createAnalysisWithSession(
  ownerId: string,
  input: { uploadId: string; title: string; categoryId: string },
): Promise<{ analysisId: string; sessionId: string }> {
  const analysisId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const database = await db();
  // TODO(algo): 目前直接标记 succeeded 并写入 mock 候选；
  // 接入真实算法后改为提交任务并轮询算法返回的候选写入会话。
  await database
    .prepare(
      `INSERT INTO analysis_jobs (id, upload_id, owner_id, title, category_id, status, attempt_count, created_at, updated_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'succeeded', 1, ?, ?, ?, ?)`,
    )
    .bind(analysisId, input.uploadId, ownerId, input.title, input.categoryId, now, now, now, now)
    .run();
  await database
    .prepare(
      `INSERT INTO recommendation_sessions (id, analysis_id, owner_id, ranking_version, candidates_json, composite_json, created_at, expires_at)
       VALUES (?, ?, ?, 'mock-v1', ?, ?, ?, ?)`,
    )
    .bind(
      sessionId,
      analysisId,
      ownerId,
      JSON.stringify(MOCK_ATOMIC_TAGS),
      JSON.stringify(MOCK_COMPOSITE_TAGS),
      now,
      new Date(Date.now() + ONE_DAY_MS).toISOString(),
    )
    .run();
  return { analysisId, sessionId };
}

export async function getAnalysis(
  ownerId: string,
  analysisId: string,
): Promise<{ id: string; status: string; sessionId: string | null; errorCode: string | null; errorMessage: string | null } | null> {
  const row = await (await db())
    .prepare(
      `SELECT id, status, error_code, error_message,
              (SELECT id FROM recommendation_sessions WHERE analysis_id = analysis_jobs.id) AS session_id
       FROM analysis_jobs WHERE id = ? AND owner_id = ?`,
    )
    .bind(analysisId, ownerId)
    .first<{ id: string; status: string; error_code: string | null; error_message: string | null; session_id: string | null }>();
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    sessionId: row.session_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

export async function getSessionCandidates(
  ownerId: string,
  sessionId: string,
): Promise<{ atomic: RecommendTag[]; composite: RecommendTag[]; rankingVersion: string } | null> {
  const row = await (await db())
    .prepare(
      `SELECT candidates_json, composite_json, ranking_version, expires_at
       FROM recommendation_sessions WHERE id = ? AND owner_id = ?`,
    )
    .bind(sessionId, ownerId)
    .first<{ candidates_json: string; composite_json: string | null; ranking_version: string; expires_at: string }>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return {
    atomic: JSON.parse(row.candidates_json) as RecommendTag[],
    composite: row.composite_json ? (JSON.parse(row.composite_json) as RecommendTag[]) : [],
    rankingVersion: row.ranking_version,
  };
}

export async function findOwnedAnalysis(
  ownerId: string,
  input: { analysisId: string; uploadId: string },
): Promise<boolean> {
  const row = await (await db())
    .prepare(
      `SELECT a.id FROM analysis_jobs a
       JOIN upload_assets u ON u.id = a.upload_id
       WHERE a.id = ? AND a.upload_id = ? AND a.owner_id = ? AND u.owner_id = ?`,
    )
    .bind(input.analysisId, input.uploadId, ownerId, ownerId)
    .first();
  return Boolean(row);
}

export async function saveSubmission(
  ownerId: string,
  input: {
    uploadId: string;
    analysisId: string;
    title: string;
    categoryId: string;
    coverObjectKey: string | null;
    tags: Array<{ text: string; candidateId?: string }>;
  },
): Promise<string> {
  const submissionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const database = await db();
  // TODO(storage): cover_object_key 目前来自前端本地 URL，真实场景应为 OSS 回填的对象键。
  await database
    .prepare(
      `INSERT INTO submissions (id, owner_id, upload_id, analysis_id, title, category_id, cover_object_key, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?)`,
    )
    .bind(submissionId, ownerId, input.uploadId, input.analysisId, input.title, input.categoryId, input.coverObjectKey, now, now)
    .run();
  await database.batch(
    input.tags.slice(0, 10).map((tag, position) =>
      database
        .prepare(`INSERT INTO submission_tags (submission_id, position, candidate_id, text) VALUES (?, ?, ?, ?)`)
        .bind(submissionId, position, tag.candidateId ?? null, tag.text.trim()),
    ),
  );
  return submissionId;
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: `lib/repository.ts` 与 `lib/idempotency.ts` 无类型错误（路由层旧错误仍可能存在，下一任务修复）。

- [ ] **Step 4: Commit**

```bash
git add lib/repository.ts lib/idempotency.ts
git commit -m "refactor: 抽出数据访问层与幂等 helper"
```

---

## Task 5: 路由瘦身 + 新增 candidates + 删除 recommend

**Files:**
- Modify: `app/api/uploads/init/route.ts`
- Modify: `app/api/uploads/[id]/complete/route.ts`
- Modify: `app/api/analyses/route.ts`
- Modify: `app/api/analyses/[id]/route.ts`
- Modify: `app/api/submissions/route.ts`
- Create: `app/api/tags/candidates/route.ts`
- Delete: `app/api/tags/recommend/route.ts`

**Interfaces:**
- Consumes: `lib/repository.ts` 所有导出、`withIdempotency`（`lib/idempotency.ts`）、`getVisitor`/`jsonWithVisitor`（`lib/cloudflare.ts`）。
- Produces: HTTP 接口契约不变（除 recommend 删除、candidates 新增）。

- [ ] **Step 1: 重写 uploads/init**

将 `app/api/uploads/init/route.ts` 整体替换为：

```ts
import { NextResponse } from 'next/server';
import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { createUpload } from '@/lib/repository';

export async function POST(request: Request) {
  const body = (await request.json()) as { fileName?: string; size?: number; mimeType?: string };
  if (!body.fileName || !body.size || body.size <= 0 || !body.mimeType) {
    return NextResponse.json({ error: { code: 'INVALID_UPLOAD', message: '文件信息不完整' } }, { status: 400 });
  }

  const visitor = await getVisitor(request);
  const uploadId = await createUpload(visitor.ownerId, { fileName: body.fileName, mimeType: body.mimeType, size: body.size });

  // TODO(storage): uploadUrl/objectKey 目前为 mock，接入 OSS 后返回真实直传地址与对象键。
  return jsonWithVisitor(
    {
      uploadId,
      objectKey: `mock/${uploadId}/${body.fileName}`,
      uploadUrl: `mock://r2/${uploadId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      requiredHeaders: { 'Content-Type': body.mimeType },
    },
    undefined,
    visitor,
  );
}
```

- [ ] **Step 2: 重写 uploads/[id]/complete**

将 `app/api/uploads/[id]/complete/route.ts` 整体替换为：

```ts
import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { verifyUpload } from '@/lib/repository';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const visitor = await getVisitor(request);
  const ok = await verifyUpload(visitor.ownerId, id);
  if (!ok) {
    return jsonWithVisitor({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或无权访问' } }, { status: 404 }, visitor);
  }
  return jsonWithVisitor({ uploadId: id, status: 'verified' }, undefined, visitor);
}
```

- [ ] **Step 3: 重写 analyses (POST)**

将 `app/api/analyses/route.ts` 整体替换为：

```ts
import { NextResponse } from 'next/server';
import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { withIdempotency } from '@/lib/idempotency';
import { createAnalysisWithSession, findVerifiedUpload } from '@/lib/repository';

export async function POST(request: Request) {
  const body = (await request.json()) as { uploadId?: string; title?: string; categoryId?: string };
  if (!body.uploadId || !body.title || !body.categoryId) {
    return NextResponse.json({ error: { code: 'INVALID_ANALYSIS', message: '分析参数不完整' } }, { status: 400 });
  }

  const visitor = await getVisitor(request);
  if (!(await findVerifiedUpload(visitor.ownerId, body.uploadId))) {
    return jsonWithVisitor({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或尚未完成' } }, { status: 404 }, visitor);
  }

  const uploadId = body.uploadId;
  const title = body.title.trim();
  const categoryId = body.categoryId;
  const { body: response, status } = await withIdempotency(
    visitor.ownerId,
    'analysis',
    request.headers.get('Idempotency-Key'),
    202,
    async () => {
      const { analysisId } = await createAnalysisWithSession(visitor.ownerId, { uploadId, title, categoryId });
      return { analysisId, status: 'queued', pollAfterMs: 700 };
    },
  );
  return jsonWithVisitor(response, { status }, visitor);
}
```

- [ ] **Step 4: 重写 analyses/[id] (GET)**

将 `app/api/analyses/[id]/route.ts` 整体替换为：

```ts
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
```

- [ ] **Step 5: 新增 tags/candidates (GET)**

创建 `app/api/tags/candidates/route.ts`：

```ts
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
```

- [ ] **Step 6: 删除 tags/recommend**

Run: `rm app/api/tags/recommend/route.ts && rmdir app/api/tags/recommend 2>/dev/null; true`

- [ ] **Step 7: 重写 submissions**

将 `app/api/submissions/route.ts` 整体替换为：

```ts
import { NextResponse } from 'next/server';
import { getVisitor, jsonWithVisitor } from '@/lib/cloudflare';
import { withIdempotency } from '@/lib/idempotency';
import { findOwnedAnalysis, saveSubmission } from '@/lib/repository';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    uploadId?: string;
    analysisId?: string;
    title?: string;
    categoryId?: string;
    coverUrl?: string;
    tags?: Array<{ text?: string; candidateId?: string }>;
  };

  if (!body.title || !body.categoryId || !body.tags?.length) {
    return NextResponse.json({ error: { code: 'INVALID_SUBMISSION', message: '请完善稿件信息并至少选择一个标签' } }, { status: 422 });
  }

  const visitor = await getVisitor(request);
  if (!body.uploadId || !body.analysisId) {
    return jsonWithVisitor({ error: { code: 'INVALID_SUBMISSION', message: '缺少上传或分析信息' } }, { status: 422 }, visitor);
  }
  if (!(await findOwnedAnalysis(visitor.ownerId, { analysisId: body.analysisId, uploadId: body.uploadId }))) {
    return jsonWithVisitor({ error: { code: 'INVALID_SUBMISSION', message: '上传或分析不存在' } }, { status: 404 }, visitor);
  }

  const uploadId = body.uploadId;
  const analysisId = body.analysisId;
  const title = body.title.trim();
  const categoryId = body.categoryId;
  // TODO(storage): coverUrl 目前为前端本地 URL，接入 OSS 后应为对象键。
  const coverObjectKey = body.coverUrl ?? null;
  const tags = (body.tags ?? [])
    .map((t) => ({ text: t.text?.trim() ?? '', candidateId: t.candidateId }))
    .filter((t) => t.text.length > 0);

  const { body: response, status } = await withIdempotency(
    visitor.ownerId,
    'submission',
    request.headers.get('Idempotency-Key'),
    200,
    async () => {
      const submissionId = await saveSubmission(visitor.ownerId, {
        uploadId,
        analysisId,
        title,
        categoryId,
        coverObjectKey,
        tags,
      });
      return { submissionId, status: 'saved' };
    },
  );
  return jsonWithVisitor(response, { status }, visitor);
}
```

- [ ] **Step 8: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 均通过，无错误（`MOCK_TAG_BATCHES` 已无引用）。

- [ ] **Step 9: 冒烟验证链路**

Run: `pnpm test`（确保纯函数测试仍通过）
Expected: PASS。

- [ ] **Step 10: Commit**

```bash
git add app/api lib
git commit -m "refactor: 路由瘦身，新增 tags/candidates，删除 tags/recommend"
```

---

## Task 6: 前端改用本地编排 + 拉取 candidates

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `buildRecommendationView`（`lib/recommend.ts`）、`CandidatesResponse`（`lib/types.ts`）、`GET /api/tags/candidates`。
- Produces: 前端换一批本地翻页；不再请求 `/api/tags/recommend`。

**说明：** 本任务无自动化测试，验证靠 `pnpm build` 通过 + 手动跑通链路。以下为对 `app/page.tsx` 的精确修改。

- [ ] **Step 1: 更新 import 与响应类型**

在 `app/page.tsx` 顶部，把
```ts
import type { Badge, RecommendTag, SelectedTag } from '@/lib/types';
```
改为
```ts
import type { Badge, CandidatesResponse, RecommendTag, SelectedTag } from '@/lib/types';
import { buildRecommendationView } from '@/lib/recommend';
```

把
```ts
type RecommendationResponse = { tags: RecommendTag[]; nextCursor?: string };
```
改为
```ts
type CandidatesApiResponse = CandidatesResponse;
```

- [ ] **Step 2: 替换推荐相关 state**

把
```ts
  const [sessionId, setSessionId] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [selectedTags, setSelectedTags] = useState<SelectedTag[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendTag[]>([]);
```
改为
```ts
  const [sessionId, setSessionId] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selectedTags, setSelectedTags] = useState<SelectedTag[]>([]);
  const [atomicPool, setAtomicPool] = useState<RecommendTag[]>([]);
  const [compositePool, setCompositePool] = useState<RecommendTag[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
```

- [ ] **Step 3: 派生 recommendations（替换网络请求）**

删除整个 `requestRecommendations` 函数：
```ts
  async function requestRecommendations(nextSessionId: string, nextCursor?: string) {
    const data = await readResponse<RecommendationResponse>(
      await fetch('/api/tags/recommend', { ... }),
    );
    setRecommendations(data.tags);
    setCursor(data.nextCursor);
  }
```
在 `selectedTags` state 之后、`activeStep` 之前，新增本地派生：
```ts
  const recommendations = buildRecommendationView(atomicPool, compositePool, { selectedTags, cursor }).tags;
```

- [ ] **Step 4: startAnalysis 改为拉 candidates**

在 `startAnalysis` 中，把
```ts
      const status = await readResponse<AnalysisStatusResponse>(await fetch(`/api/analyses/${analysis.analysisId}`));
      setSessionId(status.sessionId);
      await requestRecommendations(status.sessionId);
      setPhase('recommendations');
```
改为
```ts
      const status = await readResponse<AnalysisStatusResponse>(await fetch(`/api/analyses/${analysis.analysisId}`));
      setSessionId(status.sessionId);
      const candidates = await readResponse<CandidatesApiResponse>(
        await fetch(`/api/tags/candidates?sessionId=${encodeURIComponent(status.sessionId)}`),
      );
      setAtomicPool(candidates.atomic);
      setCompositePool(candidates.composite);
      setCursor(0);
      setPhase('recommendations');
```

- [ ] **Step 5: 换一批改为本地翻页**

把 `refreshRecommendations` 整体替换为：
```ts
  function refreshRecommendations() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setError('');
    setCursor((current) => current + 1);
    window.setTimeout(() => setIsRefreshing(false), 450);
  }
```
并把调用处 `onClick={() => void refreshRecommendations()}` 改为 `onClick={refreshRecommendations}`。

- [ ] **Step 6: 组合标签跳过长度校验**

在 `addTag` 中，把
```ts
  function addTag(text: string, candidateId?: string) {
    const validationError = validateTag(text, selectedTags);
    if (validationError) {
      setTagError(validationError);
      return false;
    }
    const normalized = normalizeTag(text);
    setSelectedTags((current) => [...current, { text: normalized, candidateId }]);
    setTagError('');
    return true;
  }
```
改为（新增 `skipLength` 参数，点选推荐时传 true）：
```ts
  function addTag(text: string, candidateId?: string, skipLength = false) {
    const validationError = validateTag(text, selectedTags, skipLength);
    if (validationError) {
      setTagError(validationError);
      return false;
    }
    const normalized = normalizeTag(text);
    setSelectedTags((current) => [...current, { text: normalized, candidateId }]);
    setTagError('');
    return true;
  }
```
并把推荐点选处 `onClick={() => addTag(tag.text, tag.candidateId)}` 改为 `onClick={() => addTag(tag.text, tag.candidateId, true)}`。

同时把 `validateTag` 签名与长度分支改为：
```ts
function validateTag(value: string, selectedTags: SelectedTag[], skipLength = false) {
  const normalized = normalizeTag(value);
  if (!normalized) return '请输入标签内容';
  if (!skipLength && Array.from(normalized).length > MAX_TAG_LENGTH) return `单个标签不能超过 ${MAX_TAG_LENGTH} 个字`;
  if (/[#，,\r\n]/.test(normalized)) return '标签中不能包含 #、逗号或换行';
  if (selectedTags.some((tag) => tagIdentity(tag.text) === tagIdentity(normalized))) return '该标签已添加';
  if (selectedTags.length >= MAX_TAGS) return `最多添加 ${MAX_TAGS} 个标签`;
  return '';
}
```
> 注意：`/[#，,\r\n]/` 校验保留，`✕` 不在禁止字符内，组合标签可正常通过。

- [ ] **Step 7: 更新 restart 重置新 state**

在 `restart()` 中，把
```ts
    setCursor(undefined);
    setSelectedTags([]);
    setRecommendations([]);
```
改为
```ts
    setCursor(0);
    setSelectedTags([]);
    setAtomicPool([]);
    setCompositePool([]);
    setDragIndex(null);
```

- [ ] **Step 8: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（拖拽与步骤返回在 Task 7、8 加入，本步先保证编排替换编译通过）。

- [ ] **Step 9: 构建验证**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 10: Commit**

```bash
git add app/page.tsx
git commit -m "feat: 前端改用本地编排并一次性拉取候选"
```

---

## Task 7: 已选标签拖拽排序（主标签跟随）

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `selectedTags`/`setSelectedTags`、`dragIndex`/`setDragIndex`（Task 6 已加）。
- Produces: 已选 chip 可拖拽重排；拖到第 0 位即成主标签。`selectedTags` 顺序即主标签顺序，推荐区经派生自动更新。

**说明：** 用原生 HTML5 drag-and-drop，不引入第三方库。无自动化测试，验证靠 `pnpm build` + 手动拖拽。

- [ ] **Step 1: 新增 moveTag 函数**

在 `removeTag` 函数之后新增：

```ts
  function moveTag(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setSelectedTags((current) => {
      if (from >= current.length || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setTagError('');
  }
```

- [ ] **Step 2: 给已选 chip 加拖拽属性**

把已选标签渲染块
```tsx
                {selectedTags.map((tag, index) => (
                  <span className="selected-chip" key={`${tag.text}-${index}`}>
                    {index === 0 && <b>主</b>}# {tag.text}
                    <button type="button" onClick={() => removeTag(index)} aria-label={`删除${tag.text}`}>×</button>
                  </span>
                ))}
```
替换为
```tsx
                {selectedTags.map((tag, index) => (
                  <span
                    className={`selected-chip ${dragIndex === index ? 'dragging' : ''}`}
                    key={`${tag.text}-${index}`}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragIndex !== null) moveTag(dragIndex, index);
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    title="拖拽可调整顺序，首个为主标签"
                  >
                    {index === 0 && <b>主</b>}# {tag.text}
                    <button type="button" onClick={() => removeTag(index)} aria-label={`删除${tag.text}`}>×</button>
                  </span>
                ))}
```

- [ ] **Step 3: 加拖拽视觉样式**

在 `app/globals.css` 末尾追加：

```css
.selected-chip[draggable='true'] { cursor: grab; }
.selected-chip.dragging { opacity: 0.5; }
```

- [ ] **Step 4: 构建验证**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/globals.css
git commit -m "feat: 已选标签支持拖拽排序，主标签跟随首位"
```

---

## Task 8: 步骤返回（第2步、第4步）

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `phase`/`setPhase`。
- Produces: 第 2 步「返回上一步」→ 第 1 步；第 4 步「返回上一步」→ 第 2 步；数据保留。

- [ ] **Step 1: 第2步（settings）加返回按钮**

在 settings 表单的「基本设置」区，把提交行
```tsx
              <div className="actions"><button type="submit" className="primary-button">生成标签</button></div>
```
替换为
```tsx
              <div className="actions">
                <button type="button" className="secondary-button" onClick={() => setPhase('upload')}>返回上一步</button>
                <button type="submit" className="primary-button">生成标签</button>
              </div>
```
> 说明：返回第 1 步（上传）。已选视频、标题、分区等 state 不清空，保留。

- [ ] **Step 2: 第4步（recommendations）返回改为回第2步**

把 recommendations 表单底部
```tsx
              <div className="actions">
                <button type="button" className="secondary-button" onClick={restart}>重新上传</button>
                <button type="submit" className="primary-button" disabled={isSubmitting}>{isSubmitting ? '发布中…' : '确认并发布'}</button>
              </div>
```
替换为
```tsx
              <div className="actions">
                <button type="button" className="secondary-button" onClick={() => setPhase('settings')}>返回上一步</button>
                <button type="submit" className="primary-button" disabled={isSubmitting}>{isSubmitting ? '发布中…' : '确认并发布'}</button>
              </div>
```
> 说明：第 4 步返回到第 2 步（基本设置），跳过第 3 步分析占位。已拉取的候选（atomicPool/compositePool）、已选标签保留；若用户改标题/分区后再次「生成标签」，会重新分析并覆盖候选。

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: 第2步/第4步支持返回上一步并保留数据"
```

---

## Task 9: 上传页协议文案与外链

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: 上传区底部协议文案 + 三个外链（新标签页打开）。

- [ ] **Step 1: 替换协议文案**

把
```tsx
              <p className="agreement">上传即代表你已阅读并同意《创作公约》</p>
```
替换为
```tsx
              <p className="agreement">
                上传视频，即表示您已同意{' '}
                <a href="https://www.bilibili.com/protocal/licence.html" target="_blank" rel="noopener noreferrer">哔哩哔哩使用协议</a>
                {' '}与{' '}
                <a href="https://member.bilibili.com/platform/convention/?search=q0" target="_blank" rel="noopener noreferrer">哔哩哔哩社区公约</a>
                ，请勿上传色情、反动等违法视频，{' '}
                <a href="https://www.bilibili.com/blackboard/blackroom.html" target="_blank" rel="noopener noreferrer">查看社区规则</a>
              </p>
```

- [ ] **Step 2: 加链接样式**

在 `app/globals.css` 末尾追加：

```css
.agreement a { color: var(--primary); text-decoration: none; }
.agreement a:hover { text-decoration: underline; }
```
> 说明：若 `--primary` 变量未定义于 globals.css，则改用现有主色值（检查 globals.css 中已有的主色定义并复用；B 站主色为 `#00aeec`）。

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/globals.css
git commit -m "feat: 上传页协议文案与三个外链"
```

---

## Task 10: 端到端手动验证

**Files:** 无（验证任务）

- [ ] **Step 1: 启动本地开发**

Run: `pnpm dev`
Expected: 迁移自动应用（含 0002），Next 启动于 http://localhost:3000。

- [ ] **Step 2: 走通链路**

在浏览器依次验证：
1. 上传页底部三个链接可点击、新标签页打开、指向正确 URL。
2. 选视频 → 上传进度 → 基本设置（有「返回上一步」，点它回到上传页且数据在）。
3. 填标题/封面/分区 → 生成标签 → 分析动画 → 进入推荐页。
4. 推荐页：零已选时第 1 位带「主标签」角标；点「换一批」第 1 位主标签会变化；组合标签（含 ✕）在末尾。
5. 点选一个标签后「换一批」：不再出现「主标签」角标。
6. 删光已选标签：「主标签」推荐重新出现。
7. 拖拽已选标签到第 1 位：该标签显示「主」。
8. 第 4 步「返回上一步」回到基本设置，标题/分区保留；再进推荐页数据仍在。
9. 点选组合标签：作为整体（含 ✕）加入，不报长度错误。
10. 确认并发布 → 成功页显示主标签与全部标签。

- [ ] **Step 3: 确认无残留请求**

在浏览器 DevTools Network 面板确认：「换一批」不再发起 `/api/tags/recommend` 请求（该接口已删除）。

- [ ] **Step 4: 全量检查**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: 全部通过。

- [ ] **Step 5: 确认 TODO 标记齐全**

Run: `grep -rn "TODO(algo)\|TODO(storage)" app lib`
Expected: 命中 `repository.ts`（algo + storage）、`uploads/init/route.ts`（storage）、`submissions/route.ts`（storage）。这些是将来接算法/存储的替换点。

