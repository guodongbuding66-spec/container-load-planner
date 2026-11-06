# v0.80.0 独立账号与私有云（第 4／5 轮）

2026-11-06（Asia/Shanghai）。[五轮交付计划](five-release-plan.md) · [账号与沙箱部署手册](account-membership-plan.md)

- 顶部新增「账号与云项目」。邮箱首次校验后创建账号，可用验证码登录、设置或重置密码、退出本机或撤销全部会话。
- 主站和灰度站共用一个 API 和一份 PostgreSQL 数据。两站各自使用同源 HttpOnly 会话。组织所有者可发放绑定邮箱的邀请，管理编辑和只读权限。
- 本机备份明确预览后可保存为私有项目或追加版本。并发提交核对预期版本，重复请求只计一次。现场记录、核重文件、作业记录、多柜交接和照片可单独归档。分享只授予单一方案版本的七天读取权限。
- 服务端核算项目数、每月写入、存储和席位。额度与写入同事务提交。组织可暂停新增写入并读取既有版本。试用天数由部署配置。
- 独立沙箱数据库中的 Stripe 测试订单按固定期限发放测试权益。服务端校验签名，再读取供应商状态，处理重复或乱序通知、退款与争议，也可手动复核。正式收款、自动续费和发票需要实际商户配置。

## 验收与启用范围

公开部署的云端服务受配置门控。运行状态在账号面板显示。邮件实投、托管库及 Stripe 商户沙箱需要相应账号和密钥配置。原装柜工作区、算法和备份继续在浏览器中运行。

## 发布与验收

本地 2,131 项单元测试（165 个文件）、21 项页面检查、类型与生产构建通过。新增 7 项账号、权限、云档案、额度与支付联调。Better Auth 和数据库事务实际执行，发信和 Stripe 查询使用受控替身。另通过 5 项双站服务路由检查及 Cloudflare 转发编译。隔离界面走通验证码登录、备份预览、私有项目保存及恢复回调。

主站与灰度站均显示账号入口，服务状态返回 `enabled: false`。两站现场易执行、高密度参考均为 116 箱，订单毛重 3,842 kg。每站 20 次固定基准均通过。基准原件来自首次 v0.80.0 部署，服务端打包修复未改动前端或装柜引擎。正式数据库、真实邮件投递、Stripe 商户沙箱和收款待开通。

首次发布的 Vercel 函数启动时无法加载转译前的 TypeScript 路径。改为显式 Node 模块打包，并在构建阶段实际加载入口检查直连和重写路径。修复后的两站正式状态接口重新验证。

运行提交 `7f6f89c05b6c2b35206808d11f0f6c14350f4420`。Cloudflare Pages 发布 `c198f0c4-ed17-48bf-b9cf-820b9342fc55`，Vercel 发布 `dpl_J9wyB6XRLfuGccJAEL8hp85W3BeN`。[GitHub CI](https://github.com/guodongbuding66-spec/container-load-planner/actions/runs/42167539684) · [主站](https://container-load-planner.pages.dev/) · [灰度站](https://container-load-planner-gray.vercel.app/)

[验收证据及 SHA-256](field-upgrades/evidence/v0.80.0-acceptance-index.json) · [剩余功能清单](field-upgrades/unfinished-roadmap.md)
