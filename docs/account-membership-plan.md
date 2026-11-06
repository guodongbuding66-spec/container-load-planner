# 装柜智算独立账号、会员与付费接入方案

2026-11-06（Asia/Shanghai）。v0.80.0 接入独立账号、组织和私有云项目。正式站的开通取决于数据库和发信配置，付费沙箱与正式云数据分开。进度见[发布记录](upgrade-v0.80.0.md)。

## 现有服务

两个前端使用同源 `/api/cargo/*`。Vercel 运行服务，Pages Functions 只转发这组路径。两站各自持有站点会话，数据库和会员权益共用。邮箱验证码成功后创建账号，可选密码登录、设置或重置密码、当前站退出及全部会话撤销。登录限流使用服务端存储，Pages 签名传递客户端地址。

本机 Worker 继续处理装柜。云端接收用户确认后的工作区快照，导入前预览箱型和大小，取回时走既有校验和恢复确认。项目和历史版本按组织隔离。快照和 JSON 附件单文件上限 2 MiB，PNG／JPEG／WebP 照片上限 1,000,000 字节。附件以私有字节保存在数据库，可下载完整原件。多柜交接、现场事件、核重及作业档案需要明确选择文件上传。只读链接只开放所选版本的工作区 JSON，有效期七天，可撤销。

| 范围 | v0.80.0 软件 | 待实际验收 |
| --- | --- | --- |
| A1 独立登录 | 邮箱验证码、密码设置或重置、两站独立会话、撤销及三种角色 | 已验证发件域名、邮件实投和实际设备会话 |
| A2 数据归属 | 私有项目、版本、附件、受控分享和本机迁入预览 | 托管库备份恢复、实际组织和大文件数据策略 |
| A3 会员授权 | 服务端权益、试用、原子用量、存储和席位，暂停云写入 | 正式产品权益、定价、续费规则和商户对账 |
| A4 支付沙箱 | Stripe 测试订单、签名、幂等、退款、争议及手动复核 | 供应商测试账号实际结账、退款与回调 |
| A5 正式开通 | 门控及操作手册 | 商户资质、渠道、价格、结算币种、续费、退款政策、发票和正式验收 |

## 开通与配置

在可信终端及各托管平台的秘密配置中提供以下变量。

| 平台 | 设置 | 用途 |
| --- | --- | --- |
| Vercel | `CARGOFIT_CLOUD_MODE` | `private` 提供账号和私有云。 `sandbox` 用于独立测试数据库和测试邮箱。未填写时公开入口显示待启用。 |
| Vercel | `CARGOFIT_DATABASE_URL` | 专用 PostgreSQL 数据库，连接串使用 `sslmode=verify-full`。优先使用支持 startup options 的连接。 |
| Vercel | `CARGOFIT_AUTH_SECRET` | 至少 32 字符的随机会话密钥。 |
| Vercel | `CARGOFIT_RESEND_API_KEY`、`CARGOFIT_MAIL_FROM` | 发信密钥和已验证域名的发件地址。 |
| Vercel 和 Cloudflare Pages | `CARGOFIT_PROXY_SECRET` | 两站服务端使用相同的独立随机秘密，至少 32 字符。 |
| Vercel（可选） | `CARGOFIT_TRIAL_DAYS` | 0–30 天，默认 0。 |
| Vercel（沙箱） | `CARGOFIT_SANDBOX_EMAILS` | 逗号分隔的允许测试邮箱。 |
| Vercel（沙箱支付） | `CARGOFIT_STRIPE_TEST_KEY`、`CARGOFIT_STRIPE_WEBHOOK_SECRET` | 测试 API 密钥和测试事件签名密钥。 |

1. 新建专用数据库和授权角色。先设置运行配置，再用同一配置和具备建表权限的连接执行 `npm run cloud:migrate`。脚本安装 Better Auth 表和 `cargofit_cloud` 业务表并绑定部署模式。日常运行角色应限于该模式的专用库和业务架构。
2. 为 Cloudflare Pages 设置同一代理秘密并部署。分别检查两站的 `GET /api/cargo/status`，确认返回预期模式。数据库和运行模式不一致时停止服务。
3. 用已获授权的测试邮箱完成验证码登录、两站项目读取、账户退出和私有文件恢复。对新库安排加密、备份与恢复演练，按实际地区和数据保留要求配置。
4. 在 Stripe 测试环境中将 webhook 指向 Vercel 的 `/api/cargo/billing/webhook`。订阅 Checkout 完成、异步成功／失败、过期，退款及争议事件。首次核验包括测试结账、重复事件、部分及全额退款，再对照页面订单。沙箱报价为固定测试 USD 金额，测试权益为一次性 30 天。测试和正式数据库不可混用。

API 以 `/api/cargo/status`、`/api/cargo/auth/*`、`/api/cargo/data`、`/api/cargo/share` 和 `/api/cargo/billing/webhook` 为入口。云写入核对组织权限、预期版本、请求编号、项目数量、每月写入和字节额度。文件写入与额度记录同事务。跨柜现场档案合并继续使用现有校验。沙箱测试从服务端确立权益。已知失败、乱序、重复及退款保留审核记录。

## 软件联调

```bash
npm run test:unit -- lib/cloud/service.test.ts
npm run build:pages
```

专项通过真实认证和数据库事务执行，邮件送达及 Stripe 查询使用测试替身。真实邮件、托管库、真实供应商沙箱及正式收款须在对应环境再验收。

[Better Auth 邮箱验证码](https://better-auth.com/docs/plugins/email-otp) · [Pages Functions 路由](https://developers.cloudflare.com/pages/functions/routing/) · [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js) · [Stripe Checkout 对账](https://docs.stripe.com/checkout/fulfillment)
