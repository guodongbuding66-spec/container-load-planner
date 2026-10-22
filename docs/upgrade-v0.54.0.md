# v0.54.0 费用、工程复核与业务基准

日期：2026-10-22。发布状态：验证中，最终提交及线上证据在验收后补充。

## 本轮范围

- [013C](field-upgrades/013c-delivery-charges.md)：多柜增加材料、人工、返工、其他费用与手工报价汇率，同步单位成本、备份与 CSV。
- [015A](field-upgrades/015a-engineering-review.md)：当前已登记交付版本的整托实测保守包络／附件增重试算，以及独立刚性两支点静态反力与超限检查。
- [017](field-upgrades/017-business-benchmarks.md)：版本化 6×2 固定案例，独立 Worker、停止／超时、质量与数量差距及 JSON 报告。

## 验证与发布

专项测试、完整构建、GitHub CI、Vercel 及 Cloudflare 状态待本轮验证后填写。不以待验证代码声明已上线。

## 保留限制

具体叉车操作仍按用户要求 EXCLUDED。U13、U17、U20、U23 的深化和全部其他未完项目见[未完成清单](field-upgrades/unfinished-roadmap.md)，本轮不把它们整体改为 DONE。GPU／多浏览器／实机试装、承重及设备资料仍需实际证据；账号、会员和付费接入仍为后续独立范围。Cloudflare 上一轮自动发布未出现且安全登录未完成，本轮不重试已拒绝的登录。
