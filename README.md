# 智能标签推荐 Demo

基于 `PRD-智能标签推荐.html` 和 `upload.html` 还原的 Next.js 前端项目。页面包含上传、基本设置、AI 分析、推荐标签、换一批和提交完整交互；服务端 Route Handler 当前返回 mock 数据。

## 启动

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。

## Mock API

- `POST /api/uploads/init`
- `POST /api/uploads/:id/complete`
- `POST /api/analyses`
- `GET /api/analyses/:id`
- `POST /api/tags/recommend`
- `POST /api/submissions`

各路由内均保留了接入 R2、D1、Queue 和真实模型的 `TODO`。
