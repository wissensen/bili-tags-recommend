# 智能标签推荐

基于 Next.js 的智能标签推荐项目。前端包含上传、基本设置、AI 分析、推荐标签、换一批和提交完整交互；后端接口使用 Cloudflare Worker + D1 持久化，视频文件目前仍只在浏览器本地模拟上传，尚未接入 R2 或真实分析模型。

线上地址：<https://bili-tags-recommend.qiushanwanshan.workers.dev>

## 目录结构

```text
.
├── app/                    # Next.js App Router
│   ├── api/                # 后端接口
│   ├── globals.css         # 全局样式
│   ├── layout.tsx          # 前端布局
│   └── page.tsx            # 前端页面
├── docs/                   # 方案与调研文档
├── lib/                    # 共享逻辑（D1、访客 Cookie、mock 标签）
├── migrations/             # 数据库表结构
├── next.config.ts
├── open-next.config.ts
├── wrangler.jsonc          # Cloudflare 信息绑定
└── package.json
```

## 前置准备

本机需要 Node.js 24、pnpm 11 和 SQLite。仓库 `.nvmrc` 锁定 `24.19.0`；本地 D1 依赖 Node 24 自带的 `node:sqlite`。

### Node.js 24

推荐 [nvm](https://github.com/nvm-sh/nvm)。未安装时先按官方说明装好，然后在仓库根目录执行：

```bash
nvm install
nvm use
node -v   # v24.19.0
```

### pnpm 11

Node 24 自带 Corepack，用它启用项目指定的 pnpm 版本：

```bash
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm -v   # 11.x
```

### SQLite

本地开发时，将使用本地 SQLite 数据库，可以在 VSCode 插件市场安装 SQLite Viewer 插件便于本地查看。

本地数据库通过 Node 的 `node:sqlite` 读写 `.wrangler/` 里的库文件；另外需要系统 `sqlite3` 命令行，方便必要时直接打开本地库。

```bash
sqlite3 --version
```

macOS 一般已自带。没有的话用 Homebrew 安装：

```bash
brew install sqlite
```

## 启动

在仓库根目录执行：

```bash
nvm use
pnpm install
pnpm dev
```

打开 <http://localhost:3000>。

`pnpm dev` 会先把 `migrations/` 应用到本地 D1，再启动 Next.js。本地数据保存在 `.wrangler/`，不会写入线上数据库。

本地预览 Cloudflare 运行时使用 `pnpm cf:dev`。它同样使用本地 D1。

## API

- `POST /api/uploads/init`
- `POST /api/uploads/:id/complete`
- `POST /api/analyses`
- `GET /api/analyses/:id`
- `POST /api/tags/recommend`
- `POST /api/submissions`

各路由已接入 D1 的 MVP 持久化逻辑；真实视频传输和模型分析仍待后续接入。

## Cloudflare 信息

信息写在 `wrangler.jsonc`：

| 资源 | 名称 | 说明 |
| --- | --- | --- |
| Worker | `bili-tags-recommend` | 关联线上域名 `https://bili-tags-recommend.qiushanwanshan.workers.dev` |
| D1 | `bili-tags-recommend-db` | Cloudflare 基于 SQLite 的云原生分布式数据库 |

## 部署 SOP

所有命令都在仓库根目录执行，需使用 Node 24。`pnpm cf:deploy` 只更新 Worker，**不会**自动执行 D1 migration。

### 日常更新（表结构没有变化）

只更新页面或接口代码时：

```bash
nvm use
pnpm install --store-dir .pnpm-store
pnpm cf:deploy
```

表结构有变更时，必须先走下面的「更新数据库表 SOP」。

### 回滚

```bash
pnpm wrangler rollback
```

查看近期版本：

```bash
pnpm wrangler versions list
```

## 更新数据库表 SOP

表结构以 `migrations/` 为准，不要直接在 Cloudflare 控制台改表。前后端代码部署和数据库迁移是两件独立的事：需先改 SQL 并应用到数据库，再部署依赖新数据库表的代码。

本地开发只操作本地数据库；线上表结构必须用 `--remote` 更新，不要用 `--local` 去改生产数据。

### 1. 新增 migration

```bash
nvm use
pnpm wrangler d1 migrations create bili-tags-recommend-db 简短英文说明
```

会在 `migrations/` 下生成下一个序号的 SQL 文件，例如 `0002_add_xxx.sql`。

### 2. 编写 SQL

在新文件中写入增量变更，例如 `ALTER TABLE`、`CREATE TABLE`、`CREATE INDEX`。不要把已应用过的 `0001_initial.sql` 改掉再重新执行。

### 3. 先在本地验证

```bash
pnpm d1:migrate:local
```

`pnpm dev` / `pnpm cf:dev` 启动时也会自动执行这一步。

### 4. 确认线上待应用列表

```bash
pnpm wrangler d1 migrations list bili-tags-recommend-db --remote
```

### 5. 应用到线上 D1

```bash
pnpm wrangler d1 migrations apply bili-tags-recommend-db --remote
```

命令会列出即将执行的 migration 并要求确认。

### 6. 再部署 Worker

如果接口代码也依赖新表或新列：

```bash
pnpm cf:deploy
```

破坏性变更（删表、删列、改约束）应单独准备 migration，并先备份：

```bash
pnpm wrangler d1 export bili-tags-recommend-db --remote --output backup.sql
```
