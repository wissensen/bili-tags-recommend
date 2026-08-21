# 二期实现计划：登录/注册 + 一键润色

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为投稿链路前置登录/注册鉴权，并在基本设置加入 Qwen3-VL 多模态「一键润色」标题与简介。

**Architecture:** 用户体系用 D1 存 users/sessions，PBKDF2 哈希密码，会话 cookie 认身份；现有匿名 `owner_id` 全量切换为登录 `userId`。润色接口把封面图 base64 传给阿里云百炼的 Qwen3-VL，返回润色后的标题/简介。

**Tech Stack:** Next.js 16 · Cloudflare Workers + D1 · TypeScript · Vitest · 阿里云百炼（DashScope，OpenAI 兼容）

## Global Constraints

- DB 为唯一路径；repository 函数在 DB 未绑定时抛错（沿用一期）。
- 密码：PBKDF2（Web Crypto，SHA-256，100000 迭代，32 字节），每用户 16 字节随机盐，hex 存储；禁用 bcrypt。恒定时间比较。
- 会话 cookie：`bili_session`，`Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`（30 天），仅 HTTPS 加 `Secure`（按 `new URL(request.url).protocol === 'https:'` 判断）。
- 登录/注册凭据校验：username 1–32 字符，password ≥ 6 字符。
- 匿名访客机制（getVisitor / 匿名 cookie）**移除**；所有投稿路由未登录返回 401。
- 简介上限 300 字（前端计数 + 后端截断）。
- 一键润色：仅需封面即可用；AI Key（`DASHSCOPE_API_KEY`）仅服务端；失败/超时返回可读错误，前端提示并引导手动重试，不自动重试。
- 错误响应统一 `{ error: { code, message } }`。
- commit message 用中文。
- 路径别名 `@/*` → 仓库根。

---

## File Structure

- `migrations/0003_add_users_sessions.sql`（新增）
- `migrations/0004_add_submission_summary.sql`（新增）
- `lib/auth.ts`（新增）— 密码哈希、会话 cookie、getUser/requireUser
- `lib/ai.ts`（新增）— polishMetadata + 纯解析函数
- `lib/repository.ts` — 新增 user/session 函数；saveSubmission 加 summary
- `lib/cloudflare.ts` — 移除匿名访客逻辑，保留 DB/env/cookie 底层
- `app/api/auth/{register,login,logout,me}/route.ts`（新增）
- `app/api/ai/polish/route.ts`（新增）
- 6 个投稿路由 — 改用 requireUser
- `app/login/page.tsx`（新增）
- `app/page.tsx` — 登录态、顶栏、简介字段、一键润色
- 测试：`lib/auth.test.ts`、`lib/ai.test.ts`

---
## Task 1: 数据库迁移（users/sessions + summary）

**Files:**
- Create: `migrations/0003_add_users_sessions.sql`
- Create: `migrations/0004_add_submission_summary.sql`

- [ ] **Step 1: 写迁移 0003**

创建 `migrations/0003_add_users_sessions.sql`：

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

- [ ] **Step 2: 写迁移 0004**

创建 `migrations/0004_add_submission_summary.sql`：

```sql
ALTER TABLE submissions ADD COLUMN summary TEXT;
```

- [ ] **Step 3: 本地应用迁移**

Run: `pnpm d1:migrate:local`
Expected: 输出应用 0003、0004，无报错。

- [ ] **Step 4: Commit**

```bash
git add migrations/0003_add_users_sessions.sql migrations/0004_add_submission_summary.sql
git commit -m "chore: 新增 users/sessions 表与 submissions.summary 列迁移"
```

---

## Task 2: 密码哈希与校验（lib/auth.ts 基础）

**Files:**
- Create: `lib/auth.ts`
- Test: `lib/auth.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(password: string): Promise<{ hash: string; salt: string }>` — 16 字节随机盐，PBKDF2/SHA-256/100000 迭代/32 字节，hash 与 salt 均 hex。
  - `verifyPassword(password: string, hash: string, salt: string): Promise<boolean>` — 恒定时间比较。

- [ ] **Step 1: 写失败测试**

创建 `lib/auth.test.ts`：

```ts
import { expect, test } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth';

test('正确密码校验通过', async () => {
  const { hash, salt } = await hashPassword('secret123');
  expect(await verifyPassword('secret123', hash, salt)).toBe(true);
});

test('错误密码校验失败', async () => {
  const { hash, salt } = await hashPassword('secret123');
  expect(await verifyPassword('wrongpass', hash, salt)).toBe(false);
});

test('相同密码不同盐产生不同哈希', async () => {
  const a = await hashPassword('secret123');
  const b = await hashPassword('secret123');
  expect(a.salt).not.toBe(b.salt);
  expect(a.hash).not.toBe(b.hash);
});

test('hash 与 salt 均为 hex 字符串', async () => {
  const { hash, salt } = await hashPassword('secret123');
  expect(hash).toMatch(/^[0-9a-f]+$/);
  expect(salt).toMatch(/^[0-9a-f]+$/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL，`@/lib/auth` 不存在。

- [ ] **Step 3: 实现 lib/auth.ts（哈希部分）**

创建 `lib/auth.ts`：

```ts
const PBKDF2_ITERATIONS = 100_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BYTES * 8,
  );
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt);
  return { hash, salt: toHex(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const candidate = await derive(password, fromHex(salt));
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i += 1) {
    diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS，全部通过。

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/auth.test.ts
git commit -m "feat: 新增 PBKDF2 密码哈希与校验"
```

---

## Task 3: 会话 cookie 与身份（lib/auth.ts 续 + repository）

**Files:**
- Modify: `lib/auth.ts`
- Modify: `lib/repository.ts`

**Interfaces:**
- Consumes: `getDatabase`（lib/cloudflare.ts）。
- Produces（lib/repository.ts）:
  - `createUser(username: string, hash: string, salt: string): Promise<string>` — 返回 userId；用户名冲突抛 `Error` 且 `message` 含 `UNIQUE`（路由据此转 409）。
  - `findUserByName(username: string): Promise<{ id: string; passwordHash: string; passwordSalt: string } | null>`。
  - `createSession(userId: string): Promise<string>` — 返回 token，过期 30 天。
  - `getUserIdBySession(token: string): Promise<string | null>` — 校验存在且未过期。
  - `deleteSession(token: string): Promise<void>`。
- Produces（lib/auth.ts）:
  - `SESSION_COOKIE = 'bili_session'`。
  - `getUser(request: Request): Promise<{ userId: string } | null>`。
  - `sessionCookieHeader(token: string, secure: boolean): string` — 生成 Set-Cookie 值。
  - `clearSessionCookieHeader(secure: boolean): string`。
  - `isSecureRequest(request: Request): boolean`。

- [ ] **Step 1: repository 新增 user/session 函数**

在 `lib/repository.ts` 末尾追加（`db()` helper 已存在于该文件）：

```ts
export async function createUser(username: string, hash: string, salt: string): Promise<string> {
  const id = crypto.randomUUID();
  await (await db())
    .prepare(`INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, username, hash, salt, new Date().toISOString())
    .run();
  return id;
}

export async function findUserByName(
  username: string,
): Promise<{ id: string; passwordHash: string; passwordSalt: string } | null> {
  const row = await (await db())
    .prepare(`SELECT id, password_hash, password_salt FROM users WHERE username = ?`)
    .bind(username)
    .first<{ id: string; password_hash: string; password_salt: string }>();
  if (!row) return null;
  return { id: row.id, passwordHash: row.password_hash, passwordSalt: row.password_salt };
}

export async function findUsernameById(userId: string): Promise<string | null> {
  const row = await (await db())
    .prepare(`SELECT username FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ username: string }>();
  return row?.username ?? null;
}

export async function createSession(userId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await (await db())
    .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(id, userId, now, expires)
    .run();
  return id;
}

export async function getUserIdBySession(token: string): Promise<string | null> {
  const row = await (await db())
    .prepare(`SELECT user_id, expires_at FROM sessions WHERE id = ?`)
    .bind(token)
    .first<{ user_id: string; expires_at: string }>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return row.user_id;
}

export async function deleteSession(token: string): Promise<void> {
  await (await db()).prepare(`DELETE FROM sessions WHERE id = ?`).bind(token).run();
}
```

> 注：`findUsernameById` 供 `/api/auth/me` 用。

- [ ] **Step 2: 实现 lib/auth.ts 会话/身份部分**

在 `lib/auth.ts` 末尾追加：

```ts
import { getUserIdBySession } from './repository';

export const SESSION_COOKIE = 'bili_session';
const MAX_AGE = 30 * 24 * 60 * 60;

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=0`;
}

export async function getUser(request: Request): Promise<{ userId: string } | null> {
  const token = request.headers.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!token) return null;
  const userId = await getUserIdBySession(token);
  return userId ? { userId } : null;
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: `lib/auth.ts`、`lib/repository.ts` 无错误（投稿路由此时仍引用旧 getVisitor，可能报错——下一任务处理；确认新增代码本身无误）。

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts lib/repository.ts
git commit -m "feat: 会话 cookie 与用户/会话数据访问"
```

---

## Task 4: requireUser 辅助 + auth 接口

**Files:**
- Modify: `lib/auth.ts`
- Create: `app/api/auth/register/route.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/api/auth/me/route.ts`

**Interfaces:**
- Consumes: hashPassword/verifyPassword/getUser/session cookie helpers（lib/auth.ts）；createUser/findUserByName/createSession/deleteSession/findUsernameById（lib/repository.ts）。
- Produces（lib/auth.ts）:
  - `requireUser(request: Request): Promise<{ userId: string } | Response>` — 未登录返回 401 Response。

- [ ] **Step 1: 实现 requireUser**

在 `lib/auth.ts` 末尾追加：

```ts
import { NextResponse } from 'next/server';

export async function requireUser(request: Request): Promise<{ userId: string } | Response> {
  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, { status: 401 });
  }
  return user;
}
```

- [ ] **Step 2: 注册接口**

创建 `app/api/auth/register/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { hashPassword, isSecureRequest, sessionCookieHeader } from '@/lib/auth';
import { createSession, createUser } from '@/lib/repository';

export async function POST(request: Request) {
  const body = (await request.json()) as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password;
  if (!username || username.length > 32 || !password || password.length < 6) {
    return NextResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '用户名 1-32 字符，密码至少 6 位' } }, { status: 400 });
  }

  const { hash, salt } = await hashPassword(password);
  let userId: string;
  try {
    userId = await createUser(username, hash, salt);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      return NextResponse.json({ error: { code: 'USERNAME_TAKEN', message: '用户名已存在' } }, { status: 409 });
    }
    throw error;
  }

  const token = await createSession(userId);
  const response = NextResponse.json({ userId, username }, { status: 201 });
  response.headers.append('Set-Cookie', sessionCookieHeader(token, isSecureRequest(request)));
  return response;
}
```

- [ ] **Step 3: 登录接口**

创建 `app/api/auth/login/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { isSecureRequest, sessionCookieHeader, verifyPassword } from '@/lib/auth';
import { createSession, findUserByName } from '@/lib/repository';

export async function POST(request: Request) {
  const body = (await request.json()) as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password;
  if (!username || !password) {
    return NextResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '请输入用户名和密码' } }, { status: 400 });
  }

  const user = await findUserByName(username);
  if (!user || !(await verifyPassword(password, user.passwordHash, user.passwordSalt))) {
    return NextResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } }, { status: 401 });
  }

  const token = await createSession(user.id);
  const response = NextResponse.json({ userId: user.id, username }, { status: 200 });
  response.headers.append('Set-Cookie', sessionCookieHeader(token, isSecureRequest(request)));
  return response;
}
```

- [ ] **Step 4: 登出接口**

创建 `app/api/auth/logout/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, clearSessionCookieHeader, isSecureRequest } from '@/lib/auth';
import { deleteSession } from '@/lib/repository';

export async function POST(request: Request) {
  const token = request.headers.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (token) await deleteSession(token);
  const response = NextResponse.json({ ok: true });
  response.headers.append('Set-Cookie', clearSessionCookieHeader(isSecureRequest(request)));
  return response;
}
```

- [ ] **Step 5: 当前用户接口**

创建 `app/api/auth/me/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { findUsernameById } from '@/lib/repository';

export async function GET(request: Request) {
  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '未登录' } }, { status: 401 });
  }
  const username = await findUsernameById(user.userId);
  return NextResponse.json({ userId: user.userId, username });
}
```

- [ ] **Step 6: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: auth 接口无错误（投稿路由仍待改）。

- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts app/api/auth
git commit -m "feat: 注册/登录/登出/当前用户接口与 requireUser"
```

---

## Task 5: 投稿路由改用 requireUser + 移除匿名访客

**Files:**
- Modify: `lib/cloudflare.ts`
- Modify: `app/api/uploads/init/route.ts`
- Modify: `app/api/uploads/[id]/complete/route.ts`
- Modify: `app/api/analyses/route.ts`
- Modify: `app/api/analyses/[id]/route.ts`
- Modify: `app/api/tags/candidates/route.ts`
- Modify: `app/api/submissions/route.ts`

**Interfaces:**
- Consumes: `requireUser`（lib/auth.ts）。
- 所有投稿路由：`const auth = await requireUser(request); if (auth instanceof Response) return auth;` 然后用 `auth.userId` 作为 owner_id 传给 repository。删除 `getVisitor`/`jsonWithVisitor` 用法，改用 `NextResponse.json`。

- [ ] **Step 1: 精简 lib/cloudflare.ts**

移除匿名访客相关导出：删除 `getVisitor`、`setVisitorCookie`、`jsonWithVisitor` 及 `VISITOR_COOKIE`、`sign`/`encode`（若仅被这些使用）。保留 `getRuntimeEnv`、`getDatabase`、`D1DatabaseLike`。

> 注：实现者需确认删除的函数无其他引用（Task 5 会把所有引用改掉）。若 `sign/encode` 无其他用途一并删除。

- [ ] **Step 2: 改 uploads/init**

将 `app/api/uploads/init/route.ts` 的 body 改为：

```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createUpload } from '@/lib/repository';

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as { fileName?: string; size?: number; mimeType?: string };
  if (!body.fileName || !body.size || body.size <= 0 || !body.mimeType) {
    return NextResponse.json({ error: { code: 'INVALID_UPLOAD', message: '文件信息不完整' } }, { status: 400 });
  }

  const uploadId = await createUpload(auth.userId, { fileName: body.fileName, mimeType: body.mimeType, size: body.size });
  // TODO(storage): uploadUrl/objectKey 目前为 mock，接入 OSS 后返回真实直传地址与对象键。
  return NextResponse.json({
    uploadId,
    objectKey: `mock/${uploadId}/${body.fileName}`,
    uploadUrl: `mock://r2/${uploadId}`,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    requiredHeaders: { 'Content-Type': body.mimeType },
  });
}
```
（保留文件头注释块，仅替换 import 与函数体。）

- [ ] **Step 3: 改 uploads/[id]/complete**

函数体改为：

```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { verifyUpload } from '@/lib/repository';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const ok = await verifyUpload(auth.userId, id);
  if (!ok) {
    return NextResponse.json({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或无权访问' } }, { status: 404 });
  }
  return NextResponse.json({ uploadId: id, status: 'verified' });
}
```

- [ ] **Step 4: 改 analyses (POST)**

函数体改为（保留幂等逻辑，owner 用 auth.userId）：

```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withIdempotency } from '@/lib/idempotency';
import { createAnalysisWithSession, findVerifiedUpload } from '@/lib/repository';

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as { uploadId?: string; title?: string; categoryId?: string };
  if (!body.uploadId || !body.title || !body.categoryId) {
    return NextResponse.json({ error: { code: 'INVALID_ANALYSIS', message: '分析参数不完整' } }, { status: 400 });
  }
  if (!(await findVerifiedUpload(auth.userId, body.uploadId))) {
    return NextResponse.json({ error: { code: 'UPLOAD_NOT_FOUND', message: '上传不存在或尚未完成' } }, { status: 404 });
  }

  const uploadId = body.uploadId;
  const title = body.title.trim();
  const categoryId = body.categoryId;
  const { body: response, status } = await withIdempotency(
    auth.userId,
    'analysis',
    request.headers.get('Idempotency-Key'),
    202,
    async () => {
      const { analysisId } = await createAnalysisWithSession(auth.userId, { uploadId, title, categoryId });
      return { analysisId, status: 'queued', pollAfterMs: 700 };
    },
  );
  return NextResponse.json(response, { status });
}
```

- [ ] **Step 5: 改 analyses/[id] (GET)**

函数体改为：

```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getAnalysis } from '@/lib/repository';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const analysis = await getAnalysis(auth.userId, id);
  if (!analysis) {
    return NextResponse.json({ error: { code: 'ANALYSIS_NOT_FOUND', message: '分析不存在或无权访问' } }, { status: 404 });
  }
  return NextResponse.json({
    analysisId: analysis.id,
    status: analysis.status,
    sessionId: analysis.sessionId,
    error: analysis.errorCode ? { code: analysis.errorCode, message: analysis.errorMessage } : undefined,
  });
}
```

- [ ] **Step 6: 改 tags/candidates (GET)**

函数体改为：

```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getSessionCandidates } from '@/lib/repository';

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: { code: 'INVALID_SESSION', message: '缺少推荐会话' } }, { status: 400 });
  }
  const candidates = await getSessionCandidates(auth.userId, sessionId);
  if (!candidates) {
    return NextResponse.json({ error: { code: 'INVALID_SESSION', message: '推荐会话不存在或已过期' } }, { status: 404 });
  }
  return NextResponse.json(candidates);
}
```

- [ ] **Step 7: 改 submissions (POST)**

函数体改为（含 summary 透传，见 Task 8 也会用到；此处先加 owner 改造与 summary 参数占位）：

```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withIdempotency } from '@/lib/idempotency';
import { findOwnedAnalysis, saveSubmission } from '@/lib/repository';

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as {
    uploadId?: string;
    analysisId?: string;
    title?: string;
    categoryId?: string;
    coverUrl?: string;
    summary?: string;
    tags?: Array<{ text?: string; candidateId?: string }>;
  };

  if (!body.title || !body.categoryId || !body.tags?.length) {
    return NextResponse.json({ error: { code: 'INVALID_SUBMISSION', message: '请完善稿件信息并至少选择一个标签' } }, { status: 422 });
  }
  if (!body.uploadId || !body.analysisId) {
    return NextResponse.json({ error: { code: 'INVALID_SUBMISSION', message: '缺少上传或分析信息' } }, { status: 422 });
  }
  if (!(await findOwnedAnalysis(auth.userId, { analysisId: body.analysisId, uploadId: body.uploadId }))) {
    return NextResponse.json({ error: { code: 'INVALID_SUBMISSION', message: '上传或分析不存在' } }, { status: 404 });
  }

  const uploadId = body.uploadId;
  const analysisId = body.analysisId;
  const title = body.title.trim();
  const categoryId = body.categoryId;
  // TODO(storage): coverUrl 目前为前端本地 URL，接入 OSS 后应为对象键。
  const coverObjectKey = body.coverUrl ?? null;
  const summary = body.summary?.trim().slice(0, 300) ?? null;
  const tags = (body.tags ?? [])
    .map((t) => ({ text: t.text?.trim() ?? '', candidateId: t.candidateId }))
    .filter((t) => t.text.length > 0);

  const { body: response, status } = await withIdempotency(
    auth.userId,
    'submission',
    request.headers.get('Idempotency-Key'),
    200,
    async () => {
      const submissionId = await saveSubmission(auth.userId, {
        uploadId, analysisId, title, categoryId, coverObjectKey, summary, tags,
      });
      return { submissionId, status: 'saved' };
    },
  );
  return NextResponse.json(response, { status });
}
```

> 注：`saveSubmission` 的 `summary` 参数在 Task 8 加入其签名与 SQL。本任务先传参，Task 8 补齐 repository。为避免中间态 tsc 报错，**Task 5 与 Task 8 的 saveSubmission 改动应在同一提交前完成**——实现者在本任务同时完成 Task 8 的 repository/迁移已在 Task 1 就绪，故本任务可一并加 saveSubmission 的 summary 支持（见 Task 8 Step 1 代码）。

- [ ] **Step 8: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 0 error（若 saveSubmission summary 未就绪则先做 Task 8 Step 1）。

- [ ] **Step 9: Commit**

```bash
git add lib/cloudflare.ts app/api
git commit -m "refactor: 投稿路由改用登录鉴权，移除匿名访客"
```

---

## Task 6: 登录页与主页登录态

**Files:**
- Create: `app/login/page.tsx`
- Modify: `app/page.tsx`

**说明：** 无自动化测试，验证靠 `pnpm build` + 手动。

- [ ] **Step 1: 登录/注册页**

创建 `app/login/page.tsx`（客户端组件，用户名+密码，登录/注册切换，成功后 `router.push('/')`）：

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? '操作失败');
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <h1>{mode === 'login' ? '登录' : '注册'}</h1>
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button>
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <label>用户名<input value={username} maxLength={32} onChange={(e) => setUsername(e.target.value)} required /></label>
        <label>密码<input type="password" value={password} minLength={6} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button type="submit" className="auth-submit" disabled={busy}>{busy ? '处理中…' : mode === 'login' ? '登录' : '注册'}</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: 加登录页样式**

在 `app/globals.css` 末尾追加：

```css
.auth-shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg, #f6f7f9); }
.auth-card { width: 340px; background: #fff; border-radius: 14px; padding: 32px; box-shadow: 0 2px 16px rgba(0,0,0,.08); display: flex; flex-direction: column; gap: 14px; }
.auth-card h1 { font-size: 22px; }
.auth-tabs { display: flex; gap: 8px; }
.auth-tabs button { flex: 1; padding: 8px; border: 1px solid var(--border, #e3e5e7); background: #fff; border-radius: 6px; cursor: pointer; }
.auth-tabs button.active { border-color: var(--primary, #00aeec); color: var(--primary, #00aeec); }
.auth-card label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: #61666d; }
.auth-card input { padding: 10px; border: 1px solid var(--border, #e3e5e7); border-radius: 6px; font-size: 14px; }
.auth-submit { padding: 11px; background: var(--primary, #00aeec); color: #fff; border: none; border-radius: 6px; font-size: 15px; cursor: pointer; }
.auth-submit:disabled { opacity: .6; cursor: default; }
.auth-error { color: #f56c6c; font-size: 13px; }
```

- [ ] **Step 3: 主页登录态守卫 + 顶栏**

在 `app/page.tsx` 的 `Home` 组件内新增：登录用户名 state、挂载时校验、登出。

在组件顶部 state 区加：
```ts
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
```

在组件内（其他 effect/函数附近）加登录校验（需从 'react' 引入 `useEffect`，从 'next/navigation' 引入 `useRouter`）：
```ts
  const router = useRouter();
  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { username: string }) => { setCurrentUser(data.username); setAuthChecked(true); })
      .catch(() => router.replace('/login'));
  }, [router]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }
```

在 `return` 的最外层容器内、页面标题区顶部插入顶栏（展示用户名 + 登出）：
```tsx
        {currentUser && (
          <div className="user-bar">
            <span>{currentUser}</span>
            <button type="button" onClick={logout}>退出登录</button>
          </div>
        )}
```

在文件顶部把 `import { useRef, useState } from 'react';` 改为 `import { useEffect, useRef, useState } from 'react';`，并新增 `import { useRouter } from 'next/navigation';`。

未通过校验时避免渲染投稿内容：在主 `return` 前加：
```ts
  if (!authChecked) return <main className="page-shell" />;
```

- [ ] **Step 4: 顶栏样式**

在 `app/globals.css` 末尾追加：

```css
.user-bar { display: flex; justify-content: flex-end; align-items: center; gap: 12px; padding: 8px 0; font-size: 14px; color: #61666d; }
.user-bar button { border: 1px solid var(--border, #e3e5e7); background: #fff; border-radius: 6px; padding: 5px 12px; cursor: pointer; }
```

- [ ] **Step 5: 构建验证**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: 成功。

- [ ] **Step 6: Commit**

```bash
git add app/login app/page.tsx app/globals.css
git commit -m "feat: 登录页与主页登录态守卫、顶栏用户名与登出"
```

---

## Task 7: AI 润色逻辑（lib/ai.ts）

**Files:**
- Create: `lib/ai.ts`
- Test: `lib/ai.test.ts`

**Interfaces:**
- Produces:
  - `parsePolishResult(raw: string): { title: string; summary: string }` — 从模型返回文本中解析严格 JSON，截断 summary 到 300 字；解析失败抛 `Error('AI_BAD_OUTPUT')`。
  - `polishMetadata(input: { coverDataUrl: string; title?: string; summary?: string }): Promise<{ title: string; summary: string }>` — 调百炼；失败/超时抛带 code 的错误。
  - `QWEN_VL_MODEL` 常量（模型名，占位 `qwen-vl-max`，实施时按百炼实际可用名核对）。

- [ ] **Step 1: 写 parsePolishResult 的失败测试**

创建 `lib/ai.test.ts`：

```ts
import { expect, test } from 'vitest';
import { parsePolishResult } from '@/lib/ai';

test('解析标准 JSON', () => {
  const r = parsePolishResult('{"title":"标题","summary":"简介"}');
  expect(r.title).toBe('标题');
  expect(r.summary).toBe('简介');
});

test('解析被 ```json 包裹的输出', () => {
  const r = parsePolishResult('```json\n{"title":"T","summary":"S"}\n```');
  expect(r.title).toBe('T');
  expect(r.summary).toBe('S');
});

test('summary 超过 300 字被截断', () => {
  const long = 'x'.repeat(400);
  const r = parsePolishResult(`{"title":"T","summary":"${long}"}`);
  expect(r.summary.length).toBe(300);
});

test('非法输出抛错', () => {
  expect(() => parsePolishResult('not json')).toThrow();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test`
Expected: FAIL，`@/lib/ai` 不存在。

- [ ] **Step 3: 实现 lib/ai.ts**

创建 `lib/ai.ts`：

```ts
export const QWEN_VL_MODEL = 'qwen-vl-max'; // TODO(algo): 核对百炼上 Qwen3-VL-27B 的准确模型名
const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const TIMEOUT_MS = 30_000;

export function parsePolishResult(raw: string): { title: string; summary: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI_BAD_OUTPUT');
  let parsed: { title?: unknown; summary?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('AI_BAD_OUTPUT');
  }
  if (typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') {
    throw new Error('AI_BAD_OUTPUT');
  }
  return { title: parsed.title.trim(), summary: parsed.summary.trim().slice(0, 300) };
}

export async function polishMetadata(input: {
  coverDataUrl: string;
  title?: string;
  summary?: string;
}): Promise<{ title: string; summary: string }> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED');

  const prompt = [
    '你是视频投稿助手。请根据封面图片，为视频润色或生成标题与简介。',
    input.title ? `已有标题：${input.title}` : '暂无标题，请据封面生成。',
    input.summary ? `已有简介：${input.summary}` : '暂无简介，请据封面生成。',
    '要求：标题简洁有吸引力；简介不超过300字。只返回严格 JSON：{"title":"...","summary":"..."}，不要多余文字。',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: QWEN_VL_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: input.coverDataUrl } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error((error as Error).name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_NETWORK');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error('AI_UPSTREAM');
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI_BAD_OUTPUT');
  return parsePolishResult(content);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/ai.ts lib/ai.test.ts
git commit -m "feat: Qwen-VL 润色逻辑与结果解析"
```

---

## Task 8: 润色接口 + saveSubmission summary

**Files:**
- Modify: `lib/repository.ts`
- Create: `app/api/ai/polish/route.ts`

**Interfaces:**
- `saveSubmission` 签名加 `summary: string | null`，SQL 写入 summary 列。

- [ ] **Step 1: saveSubmission 加 summary**

在 `lib/repository.ts` 的 `saveSubmission`：函数入参对象加 `summary: string | null`，并把 INSERT 改为包含 `summary` 列。

将 `saveSubmission` 的 INSERT 语句改为：

```ts
  await database
    .prepare(
      `INSERT INTO submissions (id, owner_id, upload_id, analysis_id, title, category_id, cover_object_key, summary, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?)`,
    )
    .bind(submissionId, ownerId, input.uploadId, input.analysisId, input.title, input.categoryId, input.coverObjectKey, input.summary, now, now)
    .run();
```

并把函数签名的 input 类型加上 `summary: string | null;`。

- [ ] **Step 2: 润色接口**

创建 `app/api/ai/polish/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { polishMetadata } from '@/lib/ai';

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as { coverDataUrl?: string; title?: string; summary?: string };
  if (!body.coverDataUrl) {
    return NextResponse.json({ error: { code: 'MISSING_COVER', message: '请先添加封面' } }, { status: 400 });
  }

  try {
    const result = await polishMetadata({ coverDataUrl: body.coverDataUrl, title: body.title, summary: body.summary });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AI_UNAVAILABLE';
    const message = code === 'AI_TIMEOUT' ? 'AI 服务超时，请稍后手动重试' : 'AI 暂不可用，请稍后手动重试';
    return NextResponse.json({ error: { code: 'AI_UNAVAILABLE', message } }, { status: 502 });
  }
}
```

- [ ] **Step 3: 类型检查 + 测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: tsc 0 error；测试通过。

- [ ] **Step 4: Commit**

```bash
git add lib/repository.ts app/api/ai
git commit -m "feat: 一键润色接口，submissions 落库 summary"
```

---

## Task 9: 前端简介字段 + 一键润色按钮

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: 新增 summary state 与常量**

在 `app/page.tsx`：
- 常量区加 `const MAX_SUMMARY_LENGTH = 300;`
- state 区加：
```ts
  const [summary, setSummary] = useState('');
  const [isPolishing, setIsPolishing] = useState(false);
```
- `restart()` 内加 `setSummary('');`。

- [ ] **Step 2: 读封面为 dataURL 的辅助 + 润色函数**

在组件内（`startAnalysis` 附近）新增：

```ts
  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('封面读取失败'));
      reader.readAsDataURL(file);
    });
  }

  async function polish() {
    if (!coverFile || isPolishing) return;
    setIsPolishing(true);
    setError('');
    try {
      const coverDataUrl = await fileToDataUrl(coverFile);
      const res = await fetch('/api/ai/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverDataUrl, title: title.trim() || undefined, summary: summary.trim() || undefined }),
      });
      const data = (await res.json()) as { title?: string; summary?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? 'AI 暂不可用，请稍后手动重试');
      if (data.title) setTitle(data.title.slice(0, MAX_TITLE_LENGTH));
      if (typeof data.summary === 'string') setSummary(data.summary.slice(0, MAX_SUMMARY_LENGTH));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 暂不可用，请稍后手动重试');
    } finally {
      setIsPolishing(false);
    }
  }
```

- [ ] **Step 3: 表单加简介字段 + 润色按钮**

在第二步 settings 表单的分区 `form-row` 之后、`actions` 之前插入：

```tsx
              <div className="form-row">
                <label htmlFor="summary">简介</label>
                <div className="field">
                  <textarea
                    id="summary"
                    value={summary}
                    maxLength={MAX_SUMMARY_LENGTH}
                    rows={3}
                    placeholder="选填，可点「一键润色」由 AI 据封面生成"
                    onChange={(event) => setSummary(event.target.value)}
                  />
                  <span className="field-counter">{Array.from(summary).length}/{MAX_SUMMARY_LENGTH}</span>
                </div>
              </div>
              <div className="form-row">
                <span className="label-spacer" />
                <button
                  type="button"
                  className="polish-button"
                  disabled={!coverFile || isPolishing}
                  onClick={() => void polish()}
                >
                  {isPolishing ? 'AI 润色中…' : '✨ 一键润色'}
                </button>
              </div>
```

- [ ] **Step 4: 提交时带上 summary**

在 `submit()` 的 `fetch('/api/submissions')` 请求体（`submissionPayload`）中加入 `summary: summary.trim() || undefined,`。

- [ ] **Step 5: 润色按钮样式**

在 `app/globals.css` 末尾追加：

```css
.polish-button { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: 1px solid var(--primary, #00aeec); color: var(--primary, #00aeec); background: #fff; border-radius: 6px; cursor: pointer; font-size: 14px; }
.polish-button:disabled { opacity: .5; cursor: default; }
.label-spacer { width: 82px; flex-shrink: 0; }
```

- [ ] **Step 6: 构建验证**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: 成功。

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/globals.css
git commit -m "feat: 基本设置新增简介字段与一键润色按钮"
```

---

## Task 10: 端到端验证

**Files:** 无

- [ ] **Step 1: 全量门禁**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: 全绿（lint 允许既有 describe 警告）。

- [ ] **Step 2: 手动走查（本地 http://localhost:3000）**

`pnpm dev` 后：
1. 未登录访问 `/` → 自动跳 `/login`。
2. 注册新用户 → 自动登录 → 回到 `/`，顶栏显示用户名。
3. 退出登录 → 跳 `/login`；用刚注册账号登录成功。
4. 走投稿链路：上传 → 基本设置。
5. 未加封面时「一键润色」按钮禁用；加封面后启用。
6. 点「一键润色」：若已配置 `DASHSCOPE_API_KEY` 则标题/简介被填/润色；未配置或失败则弹出错误提示、内容保留、可手动填。
7. 简介超 300 字被拦截（计数到 300）。
8. 完成投稿 → 成功页。
9. 用浏览器删除会话 cookie 后调接口 → 401，前端跳登录。

- [ ] **Step 3: 确认 secret 说明**

确认 `DASHSCOPE_API_KEY` 通过 `pnpm wrangler secret put DASHSCOPE_API_KEY` 配置（线上）；本地 dev 可在 `.dev.vars` 放 `DASHSCOPE_API_KEY=...`。在 README 或部署说明补一句。

- [ ] **Step 4: TODO 标记检查**

Run: `grep -rn "TODO(algo)\|TODO(storage)" app lib`
Expected: 含 ai.ts 的模型名 TODO、repository/uploads/submissions 的 storage TODO。

