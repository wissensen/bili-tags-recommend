# 二期技术方案：登录/注册 + 一键润色

日期：2026-08-20
范围：实现二期两个功能——(1) 登录/注册前置鉴权；(2) 基本设置的「一键润色」（Qwen3-VL 多模态读封面，润色/生成标题与简介）。基于 `docs/phase-2-proposal.md` 的已确认决策。

## 0. 已确认决策

- 登录方式：用户名 + 密码（不做手机/邮箱/找回密码）。
- 密码存储：PBKDF2（Web Crypto，SHA-256）+ 每用户随机盐，不存明文。
- 简介：新增字段，上限 300 字，选填。
- 润色启用条件：仅需封面已填；标题/简介有则润色、无则据封面生成。
- 模型：Qwen3-VL-27B，经阿里云百炼（DashScope）OpenAI 兼容接口调用；封面以 base64 data URL 传给模型。
- AI 失败/超时：前端弹提示说明原因、引导手动重试，不自动重试，保留已填内容。
- 实施顺序：先登录/注册，再一键润色。

## 1. 功能一：登录 / 注册

### 1.1 数据模型（迁移 0003）

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
```

### 1.2 密码哈希（lib/auth.ts）

- `hashPassword(password: string): Promise<{ hash: string; salt: string }>`：生成 16 字节随机盐，PBKDF2（SHA-256，100000 次迭代，导出 32 字节），hash/salt 均以 hex 存储。
- `verifyPassword(password, hash, salt): Promise<boolean>`：用相同盐+迭代重算，恒定时间比较（逐字符异或累加）。
- 全部用 `crypto.subtle.deriveBits`（Workers 兼容，禁用 bcrypt）。

### 1.3 会话与身份（lib/auth.ts + lib/repository.ts）

- 会话 cookie：名 `bili_session`，值为随机 token（=sessions.id），属性 `Path=/; HttpOnly; SameSite=Lax; Max-Age=<30天>`，仅 HTTPS 加 `Secure`（沿用一期按 `request.url` 协议判断的做法）。
- repository 新增：
  - `createUser(username, hash, salt): Promise<string>` → userId（用户名重复抛可识别错误）。
  - `findUserByName(username): Promise<{ id, passwordHash, passwordSalt } | null>`。
  - `createSession(userId): Promise<string>` → sessionId（token），过期 30 天。
  - `getUserIdBySession(token): Promise<string | null>` → 校验存在且未过期。
  - `deleteSession(token): Promise<void>`。
- `getUser(request): Promise<{ userId: string } | null>`：读 `bili_session` cookie → `getUserIdBySession` → 返回 userId 或 null。**替换**一期的匿名 `getVisitor`。

### 1.4 身份迁移：owner_id → userId

- 现有 6 个投稿路由都用 `visitor.ownerId` 作为 `owner_id` 写库/查库。改为：先 `getUser(request)`，为 null 直接返回 401；否则用 `userId` 作为 owner_id 传给 repository（repository 函数签名不变，传入值从匿名 id 变为 userId）。
- 删除匿名访客机制：移除 `getVisitor`、`setVisitorCookie`、`jsonWithVisitor` 里下发匿名 cookie 的逻辑。响应不再需要「新访客下发 cookie」；auth 接口单独负责下发/清除会话 cookie。
- 新增统一辅助 `requireUser(request): Promise<{ userId } | Response>`：未登录时返回一个 401 Response，路由拿到 Response 直接 return。

### 1.5 接口

| 方法 | 路径 | 入参 | 成功返回 | 错误 |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | `{ username, password }` | 201 `{ userId, username }` + 下发会话 cookie（注册即登录） | 400 参数缺失/过短；409 用户名已存在 |
| POST | `/api/auth/login` | `{ username, password }` | 200 `{ userId, username }` + 下发会话 cookie | 400 参数缺失；401 用户名或密码错误 |
| POST | `/api/auth/logout` | — | 200 `{ ok: true }` + 清除会话 cookie | — |
| GET | `/api/auth/me` | — | 200 `{ userId, username }` | 401 未登录 |

- 校验：username 1–32 字符；password ≥ 6 字符。
- 401/错误响应统一 `{ error: { code, message } }`。
- 登录/注册成功统一错误信息「用户名或密码错误」避免暴露账号是否存在（登录场景）。

### 1.6 前端

- 新增页面 `/login`（客户端组件）：用户名 + 密码表单，登录/注册切换 tab。成功后跳转 `/`。
- 主页 `/`：挂载时调 `GET /api/auth/me`；401 则 `router.replace('/login')`。已登录则正常渲染投稿流程。加载态避免闪烁。
- 顶部展示当前用户名 + 「退出登录」按钮（调 logout 后跳 `/login`）。
- 投稿过程中任一接口返回 401（会话过期）→ 提示并跳登录。

### 1.7 边界

- 用户名唯一：DB `UNIQUE` + 注册 409。
- 会话过期：`getUserIdBySession` 校验 `expires_at`；过期视为未登录。
- 不做：找回密码、第三方登录、邮箱验证、权限分级、记住登录设备。

## 2. 功能二：一键润色

### 2.1 数据模型（迁移 0004）

```sql
ALTER TABLE submissions ADD COLUMN summary TEXT;
```

- `saveSubmission` 增加 `summary` 参数，透传落库；提交接口接收 `summary` 字段。
- 简介上限 300 字：前端实时计数 + 后端截断到 300。

### 2.2 大模型调用（lib/ai.ts）

- `polishMetadata({ coverDataUrl, title, summary }): Promise<{ title: string; summary: string }>`：
  - 读环境变量 `DASHSCOPE_API_KEY`（Workers secret）。
  - 向百炼 OpenAI 兼容 endpoint 发 chat 请求，`messages` 含一个 user 消息，内容块为：图片（`image_url` = coverDataUrl）+ 文本 prompt。
  - 模型名用占位常量 `QWEN_VL_MODEL`（实施时填百炼准确模型名，先用文档标注的名，如 `qwen3-vl-plus` 待核）。
  - prompt 要求：据封面图润色/生成标题与简介，标题简洁、简介 ≤300 字，**只返回严格 JSON** `{"title": "...", "summary": "..."}`。
  - 解析返回 JSON；解析失败或字段缺失 → 抛错（由路由转成可读错误）。
  - 设超时（如 30s，用 `AbortController`）；超时/网络错误抛出带 code 的错误。
  - API Key 仅服务端使用，绝不返回前端。

### 2.3 接口

| 方法 | 路径 | 入参 | 成功返回 | 错误 |
| --- | --- | --- | --- | --- |
| POST | `/api/ai/polish` | `{ coverDataUrl: string(base64 data URL), title?: string, summary?: string }` | 200 `{ title, summary }` | 401 未登录；400 缺封面；502 `AI_UNAVAILABLE`（模型失败/超时，message 说明原因） |

- 需登录（`requireUser`）。
- 缺 `coverDataUrl` → 400。
- 结果 summary 截断到 300 字后返回。
- 封面以 base64 data URL 传入（前端把 `coverFile` 读成 data URL）；标 `TODO(storage)`：接入 OSS 后改传 URL。

### 2.4 前端

- 第二步表单新增：
  - **简介** 输入框（多行、选填），实时字数 `x/300`，超限提示。
  - **一键润色** 按钮：`coverFile` 存在才启用；点击进入 loading。
- 点击流程：把 `coverFile` 读成 base64 data URL → `POST /api/ai/polish` 带 `{ coverDataUrl, title, summary }` → 成功用返回的 title/summary 填入对应输入框（用户可再改）。
- 失败/超时：弹出错误提示（用现有 `error` banner），文案说明原因（如「AI 服务超时，请稍后手动重试」），保留已填内容，不自动重试。
- 提交时把 `summary` 加入 submissions 请求体。

### 2.5 边界

- 无封面 → 按钮禁用。
- 标题/简介为空 → 正常，AI 生成。
- 简介超 300 → 前端拦截，后端兜底截断。
- AI 失败 → 降级为手动填写，不阻塞发布。

## 3. 影响文件

**功能一**
- `migrations/0003_add_users_sessions.sql`（新增）
- `lib/auth.ts`（新增）— 密码哈希、会话 cookie 读写、getUser/requireUser
- `lib/repository.ts` — 新增 user/session 相关函数
- `lib/cloudflare.ts` — 移除匿名 getVisitor/jsonWithVisitor 的匿名 cookie 逻辑（保留 DB/env、cookie 底层工具）
- `app/api/auth/register/route.ts`、`login/route.ts`、`logout/route.ts`、`me/route.ts`（新增）
- 6 个投稿路由 — 改用 requireUser，401 拦截，owner_id 用 userId
- `app/login/page.tsx`（新增）
- `app/page.tsx` — 登录态检查、顶栏用户名/登出
- `app/layout.tsx` — 视需要

**功能二**
- `migrations/0004_add_submission_summary.sql`（新增）
- `lib/ai.ts`（新增）— polishMetadata
- `lib/repository.ts` — saveSubmission 加 summary
- `app/api/ai/polish/route.ts`（新增）
- `app/api/submissions/route.ts` — 接收并透传 summary
- `app/page.tsx` — 简介字段、一键润色按钮、调用与错误处理
- `wrangler.jsonc` / 部署 — 说明需配置 `DASHSCOPE_API_KEY` secret

## 4. 测试

- `lib/auth.ts`：hashPassword/verifyPassword 单测（正确密码通过、错误密码拒绝、盐不同哈希不同），Vitest。
- `lib/ai.ts`：JSON 解析与 summary 截断的纯逻辑单测（mock fetch 或抽出解析函数单测）。
- 手动走查：注册→登录→投稿全链路；未登录跳转；会话过期；一键润色成功/失败/无封面禁用。

## 5. 不做（YAGNI）

- 找回密码、邮箱/手机、第三方登录、权限分级。
- 封面 AI 生成、真实视频画面理解（三期）。
- 真实视频/封面对象存储（仍 mock + base64，标 TODO(storage)）。
- 流式输出、多轮对话、自动重试。
