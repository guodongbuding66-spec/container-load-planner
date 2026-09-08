# 联系方式与备用站点

公开联系邮箱：1906761042@qq.com。主页提供邮件咨询、升级建议、方案定制和复制邮箱入口；不自动发送邮件。

## 站点清单

| 平台 | 地址 / 状态 |
| --- | --- |
| Cloudflare Pages | https://container-load-planner.pages.dev/ |
| Netlify | 已创建项目 cargo-fit-planner，尚未上线：账号额度耗尽，平台拒绝部署，无公开入口 |
| GitHub Pages | 待接入，无公开入口 |
| Vercel | https://container-load-planner-gray.vercel.app/ |
| EdgeOne Makers | 待接入，无公开入口 |

入口维护于 `components/support-and-sites.tsx`。只有完成部署的真实地址才可对用户开放；平台控制台、仓库地址不能作为备用网站。

## 部署要求

- 所有公开镜像均使用同一份源代码的纯静态导出：`npm ci` → `npm run build:pages` → `out/`。
- Netlify 配置在 `netlify.toml`。关闭 Next 服务端插件，避免为本机计算引入动态函数。
- Vercel 配置在 `vercel.json`，明确使用静态产物。项目 `prj_r8PcBkAQNeJQIUYqywz0Mv0VYY4g`，空间 `guodongbuding66-4957`。通过源码上传完成生产部署；尚未绑定 Git 持续部署，后续代码更新必须另行同步 Vercel。
- 上传构建源码时必须包含已跟踪的 `.openai/hosting.json`：Vite 配置的类型检查依赖该文件。该文件仅含项目标识和空资源绑定，不包含凭据。不要上传 `.env`、令牌、本机缓存或依赖目录。
- EdgeOne Makers/Pages 需要对应账号和项目权限；使用该平台支持的 Git 导入或静态产物上传流程。不能将未生成的默认域名当作已上线站点。
- 当前源代码仓库是私有仓库。GitHub Free 的 Pages 不支持私有仓库发布；不要为启用镜像擅自公开源码。可在用户选定后使用支持私有仓库的套餐或单独的公开静态产物仓库。
- GitHub Pages 若使用 `/container-load-planner/` 子路径，必须额外配置 Next `basePath` 并验证图标、JS/CSS 与打包后的装柜 Worker 路径，不能直接上传根路径产物。
- Cloudflare 现有 Git 集成负责主站自动更新。Netlify 本次尝试源码上传部署，但平台返回 `Skipped due to account credit usage exceeded`；待账号额度恢复后重试。配置 Git 持续部署前，后续更新必须同步发布 Netlify，不能假定推送主站后镜像自动更新。

## 访问与数据

不同域名的 localStorage 相互独立，不会自动同步订单和草稿。主页切换提示要求保留原标签页并导出方案；导出方案不代表支持自动跨站恢复草稿。

应提前收藏备用站。主站完全打不开时，其页面上的链接也不可达，因此页面按钮不能代替独立收藏或外部站点清单。

## 免费额度核对（2026-09-07）

Cloudflare Pages 静态资源请求免费且不限次数；触发 Pages Functions 才会计入 Workers 请求额度。免费 Pages 每月 500 次构建是发布次数，与访客数不同。装柜引擎运行在浏览器 Web Worker，不是 Cloudflare Worker。

参考：https://developers.cloudflare.com/pages/functions/pricing/ 、https://developers.cloudflare.com/pages/platform/limits/

Vercel Hobby 限个人非商业用途，商业定制业务需核实套餐：https://vercel.com/docs/plans/hobby
