# 免费且无需信用卡的 MVP 部署与存储核查

> 核查日期：2026-08-19。只引用服务商官方资料；免费额度和产品规则可能变化，上线前应再次核对。

## 结论

Cloudflare **R2 有免费额度，但不能据此理解为一定可以不绑定支付方式**。官方启用流程要求账户具有 R2 subscription；没有时需要在 Dashboard 完成 checkout。Cloudflare 的计费文档同时说明，购买产品和服务需要主支付方式。因此，控制台要求添加支付方式属于正常流程。支付方式不只信用卡，也可能包括 PayPal、Apple Pay、Google Pay 或 Link，具体取决于地区。[R2 Get started](https://developers.cloudflare.com/r2/get-started/)；[创建 Cloudflare billing profile](https://developers.cloudflare.com/billing/get-started/create-billing-profile/)；[Cloudflare billing policy](https://developers.cloudflare.com/billing/understand/billing-policy/#account-payment-method-preauthorization)

R2 产品页同时出现 “Start building for free — no credit card required” 的营销文案，但它与 R2 subscription checkout 的实际启用流程存在表面冲突。对于本项目应以 Dashboard 实际要求和 Get Started/Billing 文档为准，不把 R2 作为“确定无需支付方式”的方案。[R2 产品页](https://www.cloudflare.com/developer-platform/products/r2/)

建议分两阶段：

1. **当前 MVP（推荐）**：Cloudflare Workers/静态资源 + D1；暂不创建 R2 和 Queue。视频只在浏览器本地用于预览，不上传服务器；D1 只保存标题、分区、用户最终选择的标签、状态等结构化数据。因为模型接口尚不存在，目前持久化 100 MB 原视频不会产生业务价值。这一阶段可以确定做到免费且无需信用卡。
2. **确实需要保存原视频时**：保持 Workers + D1，把视频通过浏览器直传到 Cloudinary Free；Worker 只签发短时上传参数并保存返回的 asset ID/URL。Cloudinary 官方说明 Free 方案永久免费、无需信用卡，可用于生产直到耗尽滚动 30 天的免费 credits。它是当前较明确的无卡对象/媒体存储替代，但无登录状态下必须做限流，否则公开接口很容易被滥用。

## Cloudflare 免费层与是否需要支付方式

| 服务 | 无卡可用结论 | 官方免费限制 | 对本 MVP 的判断 |
| --- | --- | --- | --- |
| Workers | 是。用户默认拥有 Workers Free；产品页明确 no credit card required | 100,000 个动态请求/日；每次调用 10 ms CPU；静态资源请求免费且不限量。Free 账户单请求体上限 100 MB、内存 128 MB、每请求最多 50 个 subrequests、Worker bundle 3 MB | 适合承载 Next.js 静态产物和轻量 API；完整 SSR/OpenNext 运行时需先验证包体和 CPU，不要让视频经过 Worker |
| D1 | 是。Get Started 只要求 Cloudflare 账户和 Node.js；产品页明确 no credit card required | 读取 5,000,000 rows/日；写入 100,000 rows/日；账户下所有数据库合计 5 GB。免费层超限后操作失败，不会自动产生超额账单；无数据传输费 | 足够保存 MVP 的结构化元数据，不能当作视频 Blob 存储 |
| Queues | 是。Get Started 只要求 Cloudflare 账户和 Node.js；产品页明确 no credit card required | 10,000 operations/日；消息只保留 24 小时且不可调整。每 64 KB 的写、读、删分别计一次 operation，一条正常投递通常约 3 次 operation，即约 3,333 条小消息/日（不含重试） | 模型接口未提供前没有必要接入；以后异步分析时再启用 |
| R2 | **不建议视为无卡可用**；启用 R2 subscription 的 checkout 通常要求支付方式 | Standard：10 GB-month/月、Class A 1,000,000 次/月、Class B 10,000,000 次/月、互联网出网免费；超出免费量会按量收费 | 技术上最匹配，但不满足当前“确定无需支付方式”的约束 |

官方来源：

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers)；[Workers limits](https://developers.cloudflare.com/workers/platform/limits/#account-plan-limits)；[Workers 产品页](https://www.cloudflare.com/developer-platform/products/workers/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)；[D1 Get Started](https://developers.cloudflare.com/d1/get-started/)；[D1 产品页](https://www.cloudflare.com/developer-platform/products/d1/)
- [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)；[Queues Get Started](https://developers.cloudflare.com/queues/get-started/)；[Queues 产品页](https://www.cloudflare.com/products/queues)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/#free-tier)

## 无卡视频存储替代：Cloudinary Free

Cloudinary 官方定价页标明 Free 方案为 “Free forever / No credit card required”，包含 25 monthly credits。官方免费方案 FAQ 进一步说明可以用于生产，只要不超过滚动 30 天免费 credit allowance，注册不需要信用卡或其他财务信息。[Cloudinary pricing](https://cloudinary.com/pricing)；[Cloudinary Free plan FAQ](https://cloudinary.com/documentation/developer_onboarding_faq_free_plan)

与本项目有关的限制和实现要求：

- 定价页把 25 credits 对应为最高约 25 GB managed storage、25 GB monthly net viewing bandwidth 或 25,000 transformations；这些是共享 credits 的不同消耗方式，不能理解为三份互不相关的完整额度。[Cloudinary pricing](https://cloudinary.com/pricing)
- Cloudinary Upload API 文档说明，大于 100 MB 的文件必须使用分片上传，否则返回 HTTP 413。本项目前端限制为“不超过 100 MB”，可使用浏览器直传；仍建议使用 Upload Widget 或 SDK，并在边界值测试 100 MB 文件。[Cloudinary Upload API reference](https://cloudinary.com/documentation/image_upload_api_reference#upload)
- 浏览器可做 unsigned upload，但官方提示 preset 名称会暴露，知道 preset 的任何客户端都能触发上传。对于无登录 MVP，更稳妥的实现是由 Worker 返回短时签名，同时设置文件类型、大小、folder 和 overwrite 约束，并按 IP/设备做速率限制。[Cloudinary upload security considerations](https://cloudinary.com/documentation/upload_images#security_considerations)
- 这不是无限免费存储。达到免费 credits 后必须清理旧视频、等待额度窗口恢复或升级；不应承诺长期永久保存所有 100 MB 原视频。

## 为什么暂不采用其他常见免费组合

- **Supabase Storage Free**：官方文件限制文档写明 Free project 的全局最大文件大小不能超过 50 MB，低于本项目约 100 MB 的要求，因此除非把前端上限降到 50 MB，否则不适合。[Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- **把视频写入 D1**：D1 是关系数据库，免费层总存储虽然为 5 GB，但 Worker 请求体、数据库行/SQL 操作和查询成本均不适合保存大视频；只应用来保存视频 asset ID、URL 和业务元数据。
- **把视频经 Next.js/Worker API 中转**：Cloudflare Free 账户请求体上限正好是 100 MB，边界文件还会叠加 multipart 开销，容易直接超限；即使未超限，也会占用 Worker 资源。应采用浏览器到存储服务的直传。

## 推荐的线上 MVP 拓扑

```text
浏览器
  ├─ 页面与轻量 API ──> Cloudflare Workers（免费、无卡）
  ├─ 业务元数据 ──────> D1（免费、无卡）
  └─ 原视频（可选） ──> Cloudinary Free 浏览器直传（免费、无卡）

模型接口未提供：不创建 Queue，不展示“真实分析完成”；保留待接入状态。
模型接口提供后：Worker 创建任务 -> Queue -> 模型服务 -> 回写 D1。
```

当前最小上线版本甚至可以先不接 Cloudinary：保留本地视频预览，在用户点击“发布”时只把结构化结果写入 D1。等模型方明确是接收文件、预签名 URL 还是可公开 URL 后，再决定视频是否需要持久化，避免现在选错存储协议。
