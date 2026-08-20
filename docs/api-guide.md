# 接口说明（大白话版）

这份文档用最直白的方式解释：整条投稿链路里有哪 6 个接口、每个在**做什么**、**谁在什么时候调它**、**传什么 / 返回什么**。看完你应该能对着前端页面把每个请求对上号。

## 一、先看全景：一次投稿会依次发生什么

用户从"选视频"到"发布成功"，前端会按顺序调用这些接口。可以把它想成 6 个步骤：

```
用户选好视频文件
  │
  ① POST /api/uploads/init          「登记一下：我要传一个视频」
  │      → 后端建一条上传记录，返回 uploadId
  │
  （前端模拟上传进度条…）
  │
  ② POST /api/uploads/:id/complete  「视频传完了，确认一下」
  │      → 后端把这条上传标记为 verified（就绪）
  │
用户填标题、选分区、点「生成标签」
  │
  ③ POST /api/analyses              「开始分析这个视频」
  │      → 后端建一个分析任务，返回 analysisId，让前端稍后来问结果
  │
  （前端播放"AI 分析中"动画，然后来查结果）
  │
  ④ GET  /api/analyses/:id          「分析好了没？」
  │      → 后端说"好了"，并给一个 sessionId（推荐会话）
  │
进入推荐标签环节
  │
  ⑤ GET  /api/tags/candidates       「把这次分析的所有候选标签给我」
  │      → 后端一次性返回整包候选（atomic + composite 分开）
  │        之后「换一批」由前端本地翻页，不再请求后端
  │
用户选好标签，点「确认并发布」
  │
  ⑥ POST /api/submissions           「把这篇稿子存下来」
  │      → 后端落库，返回 submissionId
  │
发布成功页
```

一句话总结每个接口的角色：

| 步骤 | 接口 | 一句话作用 |
| --- | --- | --- |
| ① | `POST /api/uploads/init` | 登记一次上传，拿到 `uploadId` |
| ② | `POST /api/uploads/:id/complete` | 告诉后端"传完了"，标记就绪 |
| ③ | `POST /api/analyses` | 发起一次 AI 分析任务，拿到 `analysisId` |
| ④ | `GET /api/analyses/:id` | 轮询问"分析好了没"，好了拿到 `sessionId` |
| ⑤ | `GET /api/tags/candidates` | 一次性拉整包候选；"换一批"前端本地翻 |
| ⑥ | `POST /api/submissions` | 提交稿件，落库 |

## 二、几个反复出现的概念

理解这几个词，接口就不难懂了：

- **uploadId（上传 ID）**：代表"用户这一次上传的那个视频文件"。后续分析、投稿都靠它指认是哪个视频。
- **analysisId（分析 ID）**：代表"针对某个视频的一次 AI 分析任务"。因为分析要花时间，所以先建任务拿到 ID，之后拿 ID 去查进度。
- **sessionId（推荐会话 ID）**：分析成功后生成，代表"这次分析产出的一整包候选标签"。前端用它调 ⑤ 一次性把整包候选拉下来，之后"换一批"在本地翻页，不再回后端。
- **owner_id（访客身份）**：项目没有登录，用一个签名 cookie 认人。每个接口都靠它确认"这个视频/分析/会话是不是你的"，防止 A 看到 B 的数据。这部分是自动的，前端不用管。
- **轮询（polling）**：分析要时间，前端不能干等。做法是隔一小段时间就调 ④ 问一次"好了没"，直到返回"成功"。当前 mock 实现是秒回成功，真实算法接入后才会有真正的等待。
- **Idempotency-Key（幂等键）**：③ 和 ⑥ 请求头里带的一串随机值。作用是"防止重复提交"——万一网络重试、用户狂点，同一个 key 只会生效一次，后端直接返回上次的结果，不会建两条重复数据。前端每次操作生成一个新的即可。

## 三、逐个接口详解

> 说明：字段标注为**当前实现**，其中视频存储、算法分析目前是 mock（假数据/秒回），字段结构已按未来真实接入预留。

### ① POST /api/uploads/init —— 登记一次上传

- **什么时候调**：用户选好视频文件的那一刻，浏览器立即调用。
- **在做什么**：在数据库建一条上传记录（状态 `local_only`），生成一个 `uploadId`。真实场景下还会返回一个"往哪传视频"的地址；当前是 mock 地址。
- **请求体**：
  ```json
  { "fileName": "myvideo.mp4", "size": 10485760, "mimeType": "video/mp4" }
  ```
- **返回**：
  ```json
  {
    "uploadId": "……",
    "objectKey": "mock/……/myvideo.mp4",
    "uploadUrl": "mock://r2/……",
    "expiresAt": "……",
    "requiredHeaders": { "Content-Type": "video/mp4" }
  }
  ```
- **校验**：文件名/大小/类型必须齐全，否则 400。
- **对应前端**：`startUpload()` 里第一个 `fetch('/api/uploads/init')`。

### ② POST /api/uploads/:id/complete —— 确认上传完成

- **什么时候调**：前端"上传"完成后（当前是模拟的进度条跑满后）。
- **在做什么**：把那条上传记录的状态从"待定"改成 `verified`（已就绪），之后才允许拿它去分析。
- **路径参数**：`:id` 就是上一步的 `uploadId`。
- **返回**：`{ "uploadId": "……", "status": "verified" }`
- **失败**：找不到这条上传、或不属于当前访客 → 404。
- **对应前端**：`startUpload()` 里 `fetch('/api/uploads/${uploadId}/complete')`。

### ③ POST /api/analyses —— 发起 AI 分析

- **什么时候调**：用户填完标题、选好分区，点「生成标签」。
- **在做什么**：为这个视频建一个分析任务。真实场景下会把视频交给算法侧、任务状态是 `queued/running`；**当前 mock 直接标成 `succeeded`**，并顺手生成好推荐会话（候选标签）。返回一个 `analysisId` 和"多久后来查"的建议（`pollAfterMs`）。
- **请求头**：`Idempotency-Key`（防重复）。
- **请求体**：`{ "uploadId": "……", "title": "标题", "categoryId": "分区id" }`
- **返回**（202）：`{ "analysisId": "……", "status": "queued", "pollAfterMs": 700 }`
- **校验**：三个字段缺一 400；上传必须存在且已 `verified`，否则 404。
- **对应前端**：`startAnalysis()` 里 `fetch('/api/analyses', { method: 'POST' })`。

### ④ GET /api/analyses/:id —— 查询分析结果（轮询）

- **什么时候调**：发起分析后，前端按 `pollAfterMs` 的间隔反复调用，直到成功。
- **在做什么**：告诉前端这个分析任务当前状态。成功时附带 `sessionId`——推荐标签会话的钥匙。
- **路径参数**：`:id` 是 `analysisId`。
- **返回**：
  ```json
  { "analysisId": "……", "status": "succeeded", "sessionId": "……" }
  ```
  失败时会带 `error: { code, message }`。
- **对应前端**：`startAnalysis()` 里 `fetch('/api/analyses/${analysisId}')`。（当前 mock 秒回成功，所以只查一次。）

### ⑤ GET /api/tags/candidates —— 一次性拉取整包候选

> 设计取舍：推荐的"选品"（哪些标签、谁是主标签、组合怎么拼）由后端/算法负责；"编排"（这一屏展示哪 5 个、翻页、过滤、拖拽）由前端本地做。所以这个接口**只在分析成功后调用一次**，把整包候选给前端；之后"换一批"是前端本地翻页，**不再请求后端**。这样换一批秒切、回退复用数据、无频繁请求。详见组合标签设计 spec。

- **什么时候调**：分析成功（④ 返回 succeeded、拿到 `sessionId`）后，前端拉取一次。
- **在做什么**：把这次会话的所有候选标签一次返回。原子标签（主/副标签，已按置信度排序、带角标）与组合标签（`A✕B`，无角标）**分成两个字段**。后端不做编排。
- **请求参数**：`sessionId`（放在 query，如 `/api/tags/candidates?sessionId=……`）。
- **返回**：
  ```json
  {
    "atomic": [
      { "candidateId": "……", "text": "影视剪辑", "kind": "atomic", "displayBadge": "primary" },
      { "candidateId": "……", "text": "搞笑", "kind": "atomic", "displayBadge": "hot" }
    ],
    "composite": [
      { "candidateId": "……", "text": "恐怖✕纪录片", "kind": "composite" }
    ],
    "rankingVersion": "mock-v1"
  }
  ```
  - `atomic`：已按置信度降序，首个即 primary（主标签建议）。`displayBadge` 为 `primary`/`hot`/`fans` 或无。
  - `composite`：组合标签，无角标。前端编排时永远置于列表末尾、不占主标签位。
- **校验**：缺 `sessionId` 400；会话不存在或过期 404。
- **前端编排（本地，不走接口）**：前端拿到 `atomic` + `composite` 后，按"当前已选了什么"本地算出这屏 5 个——零已选时第 1 位放 primary，已选后不再出现 primary，组合永远置底，去重，换一批本地翻页循环。逻辑见 `lib/recommend.ts` 的 `buildRecommendationView`。

### ⑥ POST /api/submissions —— 提交稿件

- **什么时候调**：用户选好标签，点「确认并发布」。
- **在做什么**：把这篇稿子（视频 + 标题 + 分区 + 标签）写进数据库，标签按顺序存（第 0 个即主标签）。
- **请求头**：`Idempotency-Key`（防重复发布）。
- **请求体**：
  ```json
  {
    "uploadId": "……",
    "analysisId": "……",
    "title": "标题",
    "categoryId": "分区id",
    "tags": [ { "text": "主标签", "candidateId": "……" }, { "text": "标签2" } ]
  }
  ```
- **返回**：`{ "submissionId": "……", "status": "saved" }`
- **校验**：标题/分区/标签至少一个，缺则 422；上传与分析必须存在且属于当前访客，否则 404。
- **对应前端**：`submit()` 里 `fetch('/api/submissions')`。

## 四、和算法侧的关系（当前 mock）

技术方案里后端还要和算法侧打交道，映射关系是：

- ①② 对应算法侧的"创建上传凭证 / 确认文件就绪"——真实场景视频直传算法侧，当前 mock。
- ③④ 对应算法侧的"创建分析任务 / 查询分析结果"——真实场景后端把视频信息交给算法，轮询拿回**多份 JSON**（主/副标签一份、组合标签一份，可能还有置信度）。当前后端用 mock 数据扮演算法的这几份返回。
- ⑤ 只是把算法给的多份候选原样一次下发；"编排成每屏 5 个"由前端本地完成。

将来接真实算法时，改动集中在③④读取算法返回、以及承载这些候选的 mock 数据层，接口契约本身基本不变。
