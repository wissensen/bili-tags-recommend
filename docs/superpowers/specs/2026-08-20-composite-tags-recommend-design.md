# 组合标签推荐与前端编排设计

日期：2026-08-20
范围：补齐 PRD 组合标签推荐、主标签规则与相关交互。核心调整是推荐模型——**后端一次性下发排好序的候选（选品），前端本地编排翻页/过滤/拖拽/复用（展示）**。不涉及真实算法接入、真实视频存储、Java 后端改造。

## 1. 背景与目标

现有 Next.js + Cloudflare（D1）应用已跑通完整投稿链路，前端交互（回车创建标签、点选推荐、主标签、上限、角标、换一批动画）已基本符合 PRD。

本次要补齐 / 调整的是：**组合标签推荐**（如 `恐怖✕纪录片`）、**主标签规则**、以及把推荐的翻页与编排从后端分页改为**前端本地编排**。

**职责边界（核心认知）**：区分「选品」与「编排」。

- **选品（后端 / 将来算法）**：产出全部候选并排好序——哪些标签值得推、谁是主标签（置信度最高）、组合怎么拼。分多份下发（技术方案 2.4「成功时带 2–3 份 JSON」）：主/副标签一份、组合标签单独一份。
- **编排（前端）**：拿到整包候选后，按「当前已选了什么」在本地决定这一屏展示哪 5 个——主标签置顶、组合置底、去重、换一批本地翻页。只依赖前端已掌握的已选状态，不需回后端。
- **交互（前端）**：渲染、拖拽排序、步骤返回。

算法端目前未接入，用 mock 数据扮演「算法下发的多份结果」。将来替换这一 mock 层即可对接真实算法，前端编排逻辑不变。

## 2. 关键决策（已确认）

1. **推荐模型**：后端一次性下发排好序的候选，前端本地编排翻页/过滤/拖拽/复用。取消「每次换一批请求后端」。
2. 候选通过**独立拉取接口** `GET /api/tags/candidates` 在分析成功后取一次（不并进分析结果，职责清晰、便于扩展）。
3. 组合标签由算法侧拼好、单独一份下发，**前端与后端都不生成组合**。
4. 组合标签**不带角标**，且**永远置于推荐列表末尾**，不占主标签位。
5. **主标签规则**：主标签 = 已选列表的第一个。primary 角标标注「主标签建议」，池中有多个 primary 候选。
   - 零已选：展示 5 个，**第 1 位是一个 primary 主标签建议**，其后为热搜/粉丝爱看/普通/组合。**换一批时第 1 位轮换成另一个 primary**（按 cursor 在多个 primary 间循环）。
   - 已选 ≥1：**不再出现任何 primary**，只推补充标签（热搜/粉丝爱看/普通/组合）。
   - 删光已选、回到零已选：primary 主标签建议**重新出现**在第 1 位。
6. 换一批耗尽后**循环复用**，始终展示 5 个（`isExhausted` 概念取消，恒有更多）。
7. 两份候选数据在 `recommendation_sessions` 中**分列存储**：新增 `composite_json` 列，原 `candidates_json` 只存主/副标签候选（需迁移）。

## 3. 数据来源：mock 模拟算法下发

将现有 `lib/mock-tags.ts` 的 `MOCK_TAG_BATCHES`（预分批、含写死组合）重构为两份扁平候选池，模拟算法一次下发的两份结果：

- `MOCK_ATOMIC_TAGS: RecommendTag[]` — 主/副标签候选，**按置信度降序排列**。每项 `kind: 'atomic'`，可带 `displayBadge`（`primary` / `hot` / `fans`）或无角标（普通标签）。约定池中含**多个 `primary`（多个主标签建议）**，按置信度排在前列，供换一批轮换。
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

## 5. 接口调整

### 5.1 取消 POST /api/tags/recommend
不再每次换一批请求后端。删除该路由（及其后端挑选逻辑）。

### 5.2 新增 GET /api/tags/candidates
- **调用时机**：分析成功（`GET /api/analyses/:id` 返回 succeeded 拿到 `sessionId`）后，前端拉取一次。
- **入参**：`sessionId`（query）。
- **返回**：
  ```json
  {
    "atomic":    [ { "candidateId": "…", "text": "影视剪辑", "kind": "atomic", "displayBadge": "primary" }, "…" ],
    "composite": [ { "candidateId": "…", "text": "恐怖✕纪录片", "kind": "composite" }, "…" ],
    "rankingVersion": "mock-v1"
  }
  ```
  `atomic` 已按置信度降序（首个为 primary）。
- **校验**：缺 `sessionId` 400；会话不存在或过期 404；owner 不符 404。
- **实现**：读 `recommendation_sessions` 的 `candidates_json` 与 `composite_json`，直接返回。后端不做编排。

## 6. 前端编排逻辑

新增纯函数 `lib/recommend.ts`（前端与测试共用，不依赖 D1 / React）：

```
buildRecommendationView(
  atomic: RecommendTag[],
  composite: RecommendTag[],
  { selectedTags, cursor, size = 5 }
): { tags: RecommendTag[]; nextCursor: number }
```

规则：

1. **过滤已选**：从 `atomic`、`composite` 中排除文案已在 `selectedTags` 里的项（归一化比较）。
2. **主标签联动**：
   - `selectedTags` 为空：**第 1 位放一个 primary**。池中有多个 primary，按 `cursor` 在它们之间循环选取（换一批轮换出不同的主标签建议）。
   - `selectedTags` 非空：从候选中**移除所有 primary**。
3. **组装 5 个**：
   - 零已选时先放选中的那个 primary 占第 1 位；其余位从（过滤后的、非 primary 的）`atomic` 序列按 `cursor` 偏移向后取，遍历到末尾**从头循环**。
   - **组合置底**：每屏末尾放 `1~2` 个来自 `composite` 的组合标签（按 cursor 循环取、去重）；组合不足则少放或不放，用 atomic 补足 5 个。
   - 组合始终在末尾；零已选时 primary 始终占第 1 位；总数恒为 5（候选总量 ≥5 时）。
4. **翻页**：换一批时 `cursor := nextCursor`，本地重算，无请求。
5. **复用**：删标签、拖拽、回退再进入，都用同一份 `atomic/composite` 数据本地重算。

随机性：组合数量（1~2）等可用随机；为可测试，函数行为对给定 `cursor` 确定（随机源可注入或用 cursor 派生），测试固定输入验证输出。

## 7. 前端交互

### 7.1 换一批 / 数据复用
- 分析成功后调 `GET /api/tags/candidates` 拉一次，存入组件状态（`atomic` / `composite`）。
- 「换一批」、删标签、拖拽后重排，都调用 `buildRecommendationView` 本地重算，不再请求后端。
- 换一批仍保留旋转动画反馈（现有 UI 不变）。

### 7.2 组合标签
- **整体加入**：点击组合标签，完整文案（含 `✕`）作为一个标签加入。现有 `addTag(tag.text, tag.candidateId)` 已是整体加入，符合。
- **放宽长度校验**：`≤20 字` 校验会误伤组合（`A✕B` 可能超 20）。点选推荐的组合标签直接加入、跳过长度校验；用户手动输入仍受 20 字限制。

### 7.3 已选标签拖拽排序（新增）
- 已选标签 chip 可拖拽重排；拖到第 1 位的标签成为主标签（显示「主」角标）。
- 主标签始终是列表第 1 项，拖拽改变顺序即改变主标签。
- 实现方式：HTML5 drag-and-drop（无需引入第三方库）；`selectedTags` 数组顺序即主标签顺序，拖拽只重排该数组。
- 拖拽导致主标签状态变化（第 1 位有无标签）时，推荐区通过 `buildRecommendationView` 相应更新（primary 出现/消失）。

### 7.4 步骤返回（新增）
四步流程：1 上传 / 2 基本设置 / 3 AI 分析（自动过场占位）/ 4 推荐标签。

- **第 2 步（基本设置）**：新增「返回上一步」→ 回到第 1 步（上传）。
- **第 4 步（推荐标签）**：新增「返回上一步」→ **回到第 2 步**（跳过第 3 步分析占位）。
- **数据保留**：返回时已填内容（标题、分区、封面、已选标签、已拉取的候选）全部保留，不清空、不重新分析。
- 第 3 步为自动过场，无返回操作。

### 7.5 上传页协议文案与外链
将上传区底部文案（`app/page.tsx` 中 `<p className="agreement">上传即代表你已阅读并同意《创作公约》</p>`）改为：

> 上传视频，即表示您已同意 **哔哩哔哩使用协议** 与 **哔哩哔哩社区公约**，请勿上传色情、反动等违法视频，**查看社区规则**

三处为可点击链接，均在新标签页打开（`target="_blank"` + `rel="noopener noreferrer"`）：
- 哔哩哔哩使用协议 → `https://www.bilibili.com/protocal/licence.html`
- 哔哩哔哩社区公约 → `https://member.bilibili.com/platform/convention/?search=q0`
- 查看社区规则 → `https://www.bilibili.com/blackboard/blackroom.html`

链接沿用现有站点视觉风格（主色 `--primary`），其余为普通说明文字。

## 8. 测试

对纯函数 `buildRecommendationView` 写单元测试（不依赖 D1 / React）：

- 零已选：第 1 位为 primary，共 5 个，组合在末尾。
- 零已选换一批：第 1 位轮换成**另一个** primary（cursor 递增时 primary 不同）。
- 已选 ≥1：结果不含任何 primary，共 5 个，组合在末尾。
- 删光回到零已选：primary 重新出现在第 1 位。
- 组合置底：composite 恒在末尾，数量 1~2。
- 组合不足：composite 为空时用 atomic 补足，仍 5 个。
- 去重：已选标签不再出现；本屏无重复。
- 翻页循环：cursor 递增超过池长度后从头循环，仍 5 个。

若仓库尚无测试框架，引入与项目兼容的最简选择（Vitest）仅覆盖此纯函数。

## 9. 不做（YAGNI / 非目标）

- 不接真实算法、不真实上传视频、不接第三份「置信度」JSON。
- 前端与后端都不生成组合标签（属算法职责）。
- 不改动访客身份、幂等、投稿落库等既有逻辑。
- 不做 Java 后端、不做服务器部署（本次已明确排除）。
- 拖拽不引入第三方拖拽库。

## 10. 影响文件

- `lib/mock-tags.ts` — 重构为两份候选池（atomic 按置信度排序、含唯一 primary；composite 无角标）。
- `lib/types.ts` — 补充候选返回结构类型。
- `lib/recommend.ts`（新增）— `buildRecommendationView` 纯函数。
- `app/api/analyses/route.ts` — 会话写入 `candidates_json` + `composite_json`。
- `app/api/tags/candidates/route.ts`（新增）— 拉取整包候选。
- `app/api/tags/recommend/route.ts` — **删除**。
- `migrations/0002_add_composite_json.sql`（新增）。
- `app/page.tsx` — 改用 `candidates` + 本地编排；拖拽排序；步骤返回；协议文案与外链；组合标签长度校验。
- 测试文件（新增）。
