# 智能标签推荐

基于 Next.js 的智能标签推荐项目。前端包含上传、基本设置、AI 分析、推荐标签、换一批和提交完整交互；后端接口使用 Cloudflare Worker + D1 持久化，视频文件目前仍只在浏览器本地模拟上传，尚未接入 R2 或真实分析模型。

线上地址：<https://bili-tags-recommend.qiushanwanshan.workers.dev>

## 启动

需要 Node.js 24 和 pnpm 11。使用 nvm 时可执行：

```bash
nvm use
pnpm install
pnpm dev
```

打开 <http://localhost:3000>。

本地预览 Cloudflare 运行时使用 `pnpm cf:dev`。它会先构建 OpenNext，再启动 Wrangler；`wrangler.jsonc` 中的 D1 绑定已设为 `remote: true`，因此本地预览会直接访问线上 D1，请谨慎写入测试数据。

## API

- `POST /api/uploads/init`
- `POST /api/uploads/:id/complete`
- `POST /api/analyses`
- `GET /api/analyses/:id`
- `POST /api/tags/recommend`
- `POST /api/submissions`

各路由已接入 D1 的 MVP 持久化逻辑；真实视频传输和模型分析仍待后续接入。

## Cloudflare 资源

信息写在 `wrangler.jsonc`：

| 资源 | 名称 | 说明 |
| --- | --- | --- |
| Worker | `bili-tags-recommend` | 线上地址为 `https://bili-tags-recommend.qiushanwanshan.workers.dev` |
| D1 | `bili-tags-recommend-db` | 只用于持久化，不要改成和 Worker 同名 |

## 部署 SOP

所有命令都在仓库根目录执行，需使用 Node 24：

```bash
nvm use
pnpm install --store-dir .pnpm-store
```

### 首次部署

1. 登录 Cloudflare（本机只需一次）：

```bash
pnpm wrangler login
```

2. 确认 `wrangler.jsonc` 里的 `database_name` / `database_id` 与 Cloudflare 控制台中的 D1 一致。

3. 生成绑定类型（可选，但建议执行）：

```bash
pnpm cf:types
```

4. 把初始表结构应用到线上 D1（只需一次；已应用过的 migration 会被跳过）：

```bash
pnpm wrangler d1 migrations apply bili-tags-recommend-db --remote
```

5. 配置 Worker Secret（不要写入 `.env` 或 `wrangler.jsonc`）：

```bash
pnpm wrangler secret put VISITOR_COOKIE_SECRET
```

改 Worker 名称后，Secret 不会从旧 Worker 自动带过来，需要在新 Worker 上重新执行这一步。

6. 构建并部署：

```bash
pnpm cf:deploy
```

完成后访问 <https://bili-tags-recommend.qiushanwanshan.workers.dev>。

### 日常更新（表结构没有变化）

只更新页面或接口代码时：

```bash
nvm use
pnpm install --store-dir .pnpm-store
pnpm cf:deploy
```

`pnpm cf:deploy` **不会**自动执行 D1 migration。表结构有变更时，必须先走下面的「更新数据库表 SOP」。

### 回滚

```bash
pnpm wrangler rollback
```

查看近期版本：

```bash
pnpm wrangler versions list
```

## 更新数据库表 SOP

表结构以 `migrations/` 为准，不要直接在 Cloudflare 控制台改表。Worker 部署和 D1 migration 是两件独立的事：先改 SQL 并应用到 D1，再部署依赖新表的代码。

### 1. 新增 migration

```bash
nvm use
pnpm wrangler d1 migrations create bili-tags-recommend-db 简短英文说明
```

会在 `migrations/` 下生成下一个序号的 SQL 文件，例如 `0002_add_xxx.sql`。

### 2. 编写 SQL

在新文件中写入增量变更，例如 `ALTER TABLE`、`CREATE TABLE`、`CREATE INDEX`。不要把已应用过的 `0001_initial.sql` 改掉再重新执行。

### 3. 先确认待应用列表

```bash
pnpm wrangler d1 migrations list bili-tags-recommend-db --remote
```

### 4. 应用到线上 D1

```bash
pnpm wrangler d1 migrations apply bili-tags-recommend-db --remote
```

命令会列出即将执行的 migration 并要求确认。当前项目的 D1 绑定是 `remote: true`，因此不要用 `--local` 来更新生产数据。

### 5. 再部署 Worker

如果接口代码也依赖新表或新列：

```bash
pnpm cf:deploy
```

破坏性变更（删表、删列、改约束）应单独准备 migration，并先备份：

```bash
pnpm wrangler d1 export bili-tags-recommend-db --remote --output backup.sql
```
