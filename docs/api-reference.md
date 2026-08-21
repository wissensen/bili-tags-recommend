# 接口文档（API Reference）

创作者后台智能标签推荐 · 后端接口契约。本文件描述精确的请求/响应格式；链路概念与设计取舍见 `docs/api-guide.md`。

## 通用约定

- **Base URL**：与前端同源。本地 `http://localhost:3000`，线上 `https://bili-tags-recommend.qiushanwanshan.workers.dev`。
- **请求/响应格式**：均为 `application/json`（`GET` 无请求体）。
- **字符编码**：UTF-8。
- **访客身份**：无登录体系。首个请求后端通过 `Set-Cookie` 下发签名 cookie `bili_visitor`；后续请求浏览器自动携带，用于区分「我的数据」与「他人数据」。前端无需手动处理。
  - 该 cookie 属性：`Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`；仅 HTTPS 请求附加 `Secure`。
- **幂等**：`POST /api/analyses`、`POST /api/submissions` 支持请求头 `Idempotency-Key`（任意唯一字符串，建议 UUID）。相同 key 的重复请求返回首次结果，不重复写库。
- **错误响应统一格式**：
  ```json
  { "error": { "code": "ERROR_CODE", "message": "中文提示" } }
  ```
- **调用顺序**：`uploads/init` → `uploads/:id/complete` → `analyses` → `analyses/:id`(轮询) → `tags/candidates` → `submissions`。后一步依赖前一步返回的 id。

## 接口总览

| # | 方法 | 路径 | 功能 |
| --- | --- | --- | --- |
| ① | POST | `/api/uploads/init` | 登记一次上传，返回 uploadId |
| ② | POST | `/api/uploads/:id/complete` | 确认上传完成，置为 verified |
| ③ | POST | `/api/analyses` | 发起 AI 分析任务 |
| ④ | GET | `/api/analyses/:id` | 轮询分析结果 |
| ⑤ | GET | `/api/tags/candidates` | 一次性拉取整包推荐候选 |
| ⑥ | POST | `/api/submissions` | 提交稿件落库 |

---

## ① POST /api/uploads/init

**功能**：用户选好视频后登记一次上传，在数据库建记录（状态 `local_only`）并生成 `uploadId`。

**请求头**：`Content-Type: application/json`

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileName` | string | 是 | 文件名 |
| `size` | number | 是 | 字节数，须 > 0 |
| `mimeType` | string | 是 | MIME 类型，如 `video/mp4` |

**请求示例**：
```json
{ "fileName": "demo.mp4", "size": 10485760, "mimeType": "video/mp4" }
```

**成功响应** `200`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `uploadId` | string | 上传 ID（后续步骤引用） |
| `objectKey` | string | 对象存储键（当前为 mock） |
| `uploadUrl` | string | 直传地址（当前为 mock） |
| `expiresAt` | string | 凭证过期时间（ISO 8601） |
| `requiredHeaders` | object | 直传所需请求头 |

```json
{
  "uploadId": "9abaf436-b9ae-4b00-a723-17c0cbb5cdd5",
  "objectKey": "mock/9abaf436-.../demo.mp4",
  "uploadUrl": "mock://r2/9abaf436-...",
  "expiresAt": "2026-08-21T07:02:32.073Z",
  "requiredHeaders": { "Content-Type": "video/mp4" }
}
```

**错误响应**：

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `INVALID_UPLOAD` | 文件名/大小/类型缺失或 size ≤ 0 |

---

## ② POST /api/uploads/:id/complete

**功能**：确认上传完成，将该上传记录状态置为 `verified`，之后才允许发起分析。

**路径参数**：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | ① 返回的 `uploadId` |

**请求体**：无

**成功响应** `200`：
```json
{ "uploadId": "9abaf436-...", "status": "verified" }
```

**错误响应**：

| HTTP | code | 场景 |
| --- | --- | --- |
| 404 | `UPLOAD_NOT_FOUND` | 记录不存在或不属于当前访客 |

---

## ③ POST /api/analyses

**功能**：为指定视频发起一次 AI 分析任务，同时生成推荐会话（写入候选标签）。当前 mock 直接标记成功。

**请求头**：
- `Content-Type: application/json`
- `Idempotency-Key`（可选，建议传，防重复提交）

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `uploadId` | string | 是 | ① 返回的 uploadId，且须已 verified |
| `title` | string | 是 | 视频标题 |
| `categoryId` | string | 是 | 分区 id |

**请求示例**：
```json
{ "uploadId": "9abaf436-...", "title": "我的旅行 vlog", "categoryId": "vlog" }
```

**成功响应** `202 Accepted`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `analysisId` | string | 分析任务 ID |
| `status` | string | 任务状态，当前恒为 `queued` |
| `pollAfterMs` | number | 建议前端多少毫秒后开始轮询（当前 700） |

```json
{ "analysisId": "6f1c...", "status": "queued", "pollAfterMs": 700 }
```

**错误响应**：

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `INVALID_ANALYSIS` | uploadId/title/categoryId 缺失 |
| 404 | `UPLOAD_NOT_FOUND` | 上传不存在或尚未完成（未 verified） |

---

## ④ GET /api/analyses/:id

**功能**：轮询分析任务状态。成功时返回 `sessionId`（拉取候选标签的钥匙）。

**路径参数**：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | ③ 返回的 `analysisId` |

**请求体**：无

**成功响应** `200`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `analysisId` | string | 分析任务 ID |
| `status` | string | `queued` / `running` / `succeeded` / `failed`（当前 mock 恒 `succeeded`） |
| `sessionId` | string \| null | 成功时为推荐会话 ID，否则 null |
| `error` | object? | 失败时存在：`{ code, message }` |

```json
{ "analysisId": "6f1c...", "status": "succeeded", "sessionId": "a2d8..." }
```

**错误响应**：

| HTTP | code | 场景 |
| --- | --- | --- |
| 404 | `ANALYSIS_NOT_FOUND` | 分析不存在或不属于当前访客 |

**说明**：真实场景需按 `pollAfterMs` 反复调用直至 `succeeded`/`failed`；当前 mock 秒回成功，实际只需一次。

---

## ⑤ GET /api/tags/candidates

**功能**：一次性返回该会话的全部推荐候选。原子标签（主/副标签，带角标）与组合标签（`A✕B`，无角标）分字段返回。后端只负责下发；「换一批」由前端本地翻页，不再请求后端。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | ④ 成功时返回的 sessionId |

**请求示例**：
```
GET /api/tags/candidates?sessionId=a2d8...
```

**成功响应** `200`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `atomic` | RecommendTag[] | 原子标签，按置信度降序；含多个 primary |
| `composite` | RecommendTag[] | 组合标签，无角标 |
| `rankingVersion` | string | 排序版本标识（当前 `mock-v1`） |

**RecommendTag 结构**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `candidateId` | string | 候选唯一 id |
| `text` | string | 标签文案（组合标签含 `✕`） |
| `kind` | string | `atomic` 或 `composite` |
| `displayBadge` | string? | 角标：`primary`(主标签) / `hot`(热搜) / `fans`(粉丝爱看)；组合标签及普通标签无此字段 |

```json
{
  "atomic": [
    { "candidateId": "tag-film-edit", "text": "影视剪辑", "kind": "atomic", "displayBadge": "primary" },
    { "candidateId": "tag-funny", "text": "搞笑", "kind": "atomic", "displayBadge": "hot" },
    { "candidateId": "tag-edit", "text": "剪辑", "kind": "atomic" }
  ],
  "composite": [
    { "candidateId": "combo-horror-documentary", "text": "恐怖✕纪录片", "kind": "composite" }
  ],
  "rankingVersion": "mock-v1"
}
```

**错误响应**：

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `INVALID_SESSION` | 缺少 sessionId |
| 404 | `INVALID_SESSION` | 会话不存在或已过期 |

**前端编排规则**（本地，不走接口）：零已选时第 1 位放一个 primary、换一批轮换不同 primary；已选 ≥1 时不含 primary；组合标签永远置底；去重；始终 5 个。详见 `lib/recommend.ts`。

---

## ⑥ POST /api/submissions

**功能**：提交稿件落库。写入 `submissions` 与 `submission_tags`，标签按顺序存储（第 0 个为主标签）。

**请求头**：
- `Content-Type: application/json`
- `Idempotency-Key`（可选，建议传，防重复发布）

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `uploadId` | string | 是 | ① 的 uploadId |
| `analysisId` | string | 是 | ③ 的 analysisId |
| `title` | string | 是 | 标题 |
| `categoryId` | string | 是 | 分区 id |
| `coverUrl` | string | 否 | 封面（当前为前端本地 URL，将来为对象键） |
| `tags` | Tag[] | 是 | 标签数组，至少 1 个；顺序即优先级，第 0 个为主标签 |

**Tag 结构**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `text` | string | 是 | 标签文案 |
| `candidateId` | string | 否 | 若来自推荐则带上 |

**请求示例**：
```json
{
  "uploadId": "9abaf436-...",
  "analysisId": "6f1c...",
  "title": "我的旅行 vlog",
  "categoryId": "vlog",
  "coverUrl": "blob:http://localhost:3000/...",
  "tags": [
    { "text": "影视剪辑", "candidateId": "tag-film-edit" },
    { "text": "旅行" }
  ]
}
```

**成功响应** `200`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `submissionId` | string | 稿件 ID |
| `status` | string | 恒为 `saved` |

```json
{ "submissionId": "b7e2...", "status": "saved" }
```

**错误响应**：

| HTTP | code | 场景 |
| --- | --- | --- |
| 422 | `INVALID_SUBMISSION` | 缺 title/categoryId/tags，或缺 uploadId/analysisId |
| 404 | `INVALID_SUBMISSION` | 上传或分析不存在、不属于当前访客 |

**说明**：后端会校验 `uploadId + analysisId` 确属当前访客且已走完流程，防止跳过前序步骤直接伪造提交。

---

## 数据存储说明

- **视频、封面**：真实场景存对象存储（OSS/R2），数据库仅存 `object_key`，读取时按「配置域名 + key」拼 URL。当前为 mock，标注 `TODO(storage)`。
- **过程数据**（`upload_assets`、`analysis_jobs`、`recommendation_sessions`）：承担跨请求校验与候选暂存；`recommendation_sessions` 带 `expires_at`，属临时会话数据。
- **业务数据**（`submissions`、`submission_tags`）：长期留存的稿件结果。
- **算法接入点**：分析成功与候选生成当前为 mock，标注 `TODO(algo)`，接入真实算法时替换。

