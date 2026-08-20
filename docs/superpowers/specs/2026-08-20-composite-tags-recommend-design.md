# 组合标签推荐编排设计

日期：2026-08-20
范围：补齐 PRD 4.3.4「组合标签推荐」及相关边界规则，后端负责将算法下发的多份候选数据编排成推荐批次。不涉及真实算法接入、真实视频存储、Java 后端改造。

## 1. 背景与目标

现有 Next.js + Cloudflare（D1）应用已跑通完整投稿链路，前端交互（回车创建标签、点选推荐、主标签、上限、角标、换一批动画）已基本符合 PRD。

本次要补齐的是 PRD 中尚未真实实现的部分：**组合标签推荐**（如 `恐怖✕纪录片`）以及换一批的边界规则。关键认知是职责边界：

- **算法侧**：产出全部候选，分多份下发（技术方案 2.4「成功时带 2–3 份 JSON」）。其中主/副标签是一份，组合标签是**单独一份**。组合标签由算法拼好，后端不生成组合。
- **后端**：接收多份候选，负责排序、主标签联动过滤、换一批游标、去重、组合标签占位编排、循环复用，最终每批产出 5 个标签。
- **前端**：渲染与交互，已基本完成，仅需小幅对齐。

算法端目前未接入，因此用 mock 数据扮演「算法下发的多份结果」。将来替换这一 mock 层即可对接真实算法。

## 2. 关键决策（已确认）

1. 组合标签由算法侧拼好、单独一份下发，**后端不生成组合**。
2. 组合标签**不带角标**（PRD：组合只替换无角标的普通标签位）。
3. 每批随机取 **1~2 个**组合标签。
4. 换一批耗尽后**循环复用**，`isExhausted` 恒为 `false`，始终展示 5 个。
5. 两份候选数据在 `recommendation_sessions` 中**分列存储**：新增 `composite_json` 列，原 `candidates_json` 只存主/副标签候选（选择乙，需迁移）。

## 3. 数据来源：mock 模拟算法下发

将现有 `lib/mock-tags.ts` 的 `MOCK_TAG_BATCHES`（预分批、含写死组合）重构为两份扁平候选池，模拟算法一次下发的两份结果：

- `MOCK_ATOMIC_TAGS: RecommendTag[]` — 主/副标签候选。每项 `kind: 'atomic'`，可带 `displayBadge`（`primary` / `hot` / `fans`）或无角标（普通标签）。
- `MOCK_COMPOSITE_TAGS: RecommendTag[]` — 组合标签候选。每项 `kind: 'composite'`，文案形如 `A✕B`，**不带 `displayBadge`**，仅 `candidateId` + `text`。

命名与结构上体现「这是算法下发的候选」，未来替换为真实算法响应解析时只动这一层。

## 4. 存储：recommendation_sessions 增列

新增迁移 `migrations/0002_add_composite_json.sql`：

```sql
ALTER TABLE recommendation_sessions
  ADD COLUMN composite_json TEXT
  CHECK (composite_json IS NULL OR json_valid(composite_json));
```

- `analyses` 创建会话时：`candidates_json` 写 `MOCK_ATOMIC_TAGS`，`composite_json` 写 `MOCK_COMPOSITE_TAGS`。
- `composite_json` 允许为空，兼容旧会话（读取时按空数组处理）。
- 迁移向后兼容，无破坏性变更。

## 5. 后端 tags/recommend：编排逻辑

将挑选逻辑抽为纯函数，便于测试且不依赖 D1：

```
buildRecommendationBatch(
  atomicPool: RecommendTag[],
  compositePool: RecommendTag[],
  { selectedTags, cursor, batchSize = 5, compositeSeed }
): { tags: RecommendTag[]; nextCursor: string }
```

编排步骤（每次请求，首批与换一批同一逻辑）：

1. **主标签联动**（保留现有规则）
   - 未选主标签（`selectedTags` 为空）：候选可含 `primary`。
   - 已选主标签：过滤掉所有 `primary`；将 `hot` / `fans` 前置。
2. **去重**：排除已在 `selectedTags` 中的标签；排除本批内重复（按文案归一化）。
3. **游标取原子标签**：用 `cursor` 作为进入 `atomicPool`（经步骤 1 排序后）的偏移，向后取满，遍历到末尾**从头循环**。据此先凑出 5 个候选位。
4. **组合标签占位**（PRD 4.3.4）
   - 从当前 5 个里挑出**无角标的普通位**。
   - 随机 `1~2` 个普通位替换为组合标签，组合标签依 `cursor` 游标从 `compositePool` 取，避免与本批已展示标签重复、组合之间不重复。
   - **只替换普通位**，带角标（primary/hot/fans）的位置保持来自原子池。
   - `compositePool` 可用项不足（< 需要数量）：能替几个替几个；一个都没有则跳过组合，普通位保留原子标签（PRD 05 边界）。
5. **凑满 5 个**：始终返回 5 个；`nextCursor` 前进；`isExhausted` 恒 `false`（循环复用）。

随机性说明：Workers/edge 运行时可用 `crypto`/`Math.random`。组合数量与普通位选择用随机；为可测试，纯函数接受可选 `compositeSeed`（或注入随机源），测试时固定。

## 6. 前端对齐（小幅）

前端交互已基本达标，仅需：

- **组合标签整体加入**：点击组合标签，完整文案（含 `✕`）作为一个标签加入。现有 `addTag(tag.text, tag.candidateId)` 已是整体加入，符合，无需改。
- **放宽组合标签长度校验**：现有单标签 `≤20 字` 校验会误伤组合标签（`A✕B` 可能超 20）。调整：`kind: 'composite'` 或含 `✕` 的标签不受 20 字限制；用户手输的普通标签仍受限。校验发生在 `validateTag`，需要区分来源——点选推荐的组合标签直接加入、跳过长度校验；手动输入仍校验。

## 7. 测试

对 `buildRecommendationBatch` 写单元测试（纯函数，不依赖 D1）：

- 未选主标签：结果可含 primary，共 5 个。
- 已选主标签：结果不含 primary，hot/fans 前置，共 5 个。
- 组合占位：普通位被替换为 composite，数量 1~2；带角标位不被替换。
- 组合不足：compositePool 为空时跳过组合、退回原子标签，仍 5 个。
- 去重：已选标签不再出现；本批无重复。
- 循环：cursor 超过池长度后从头循环，仍 5 个，`isExhausted` 为 false。

若仓库尚无测试框架，引入与 Next 兼容的最简选择（Vitest）仅覆盖此纯函数。

## 8. 不做（YAGNI / 非目标）

- 不接真实算法、不真实上传视频、不接第三份「置信度」JSON。
- 后端不生成组合标签（属算法职责）。
- 不改动访客身份、幂等、投稿落库等既有逻辑。
- 不做 Java 后端、不做服务器部署（本次已明确排除）。

## 9. 影响文件

- `lib/mock-tags.ts` — 重构为两份候选池。
- `lib/types.ts` — 视需要补充类型（如候选池结构）。
- `lib/recommend.ts`（新增）— `buildRecommendationBatch` 纯函数。
- `app/api/analyses/route.ts` — 写入 `composite_json`。
- `app/api/tags/recommend/route.ts` — 读取两列、调用纯函数。
- `migrations/0002_add_composite_json.sql`（新增）。
- `app/page.tsx` — 组合标签长度校验对齐。
- 测试文件（新增）。
