# v0.69.0 尾数试算报告下载

2026-10-29。在完成 v0.68.0 的 GitHub 证据归档后，继续 [013J](field-upgrades/013j-tail-trial-reports.md)：增加当前完整尾数试算 JSON 与候选全部源行 CSV。

报告明确为未采用预览，记录范围、上限、预算、全部候选结果及选中候选的数量。复用现有五项复核，保留未核验；CSV 提供中英文、BOM、引号和公式保护。完整运行但没有改善时仍可保存 JSON，候选 CSV 不可用。停止、超时、异常或参数变化不导出旧批次。

## 验证与发布

新增 13 项单元回归，专项三文件 32 项通过。完整 `npm run verify` 通过：1,860 项单元／143 文件、21 项页面检查、lint 0 错误（两项原有警告）与 TypeScript；随后 `CF_PAGES=1 ./node_modules/.bin/next build --webpack` 生产构建通过。

运行提交 `6c5bac07c152d7450703957371cb8fee528e5cb1`，树 `638975d82fe4a22cb00ff94e0be874cd427d6f79`。Cloudflare 部署 `4d65330a-438c-41ab-889b-50788a89598d` 成功；Vercel `dpl_vkKGJohndBUnKDLV2CsZrf1z5F9z` READY，正式 gray 域名指向该提交。Vercel 独立构建日志确认 1,860 项单元、143 文件、21 项页面检查及生产编译通过。

GitHub Actions **未通过**：运行 `40798582946`、任务 `123200926410` 在执行任何步骤前失败，`steps=[]`、runner 为空，启动原因仍未取得；未将两站成功构建等同于 CI 通过。

## 两站原生文件验收

| 项目 | 实际结果 |
| --- | --- |
| 完整 JSON | 两站均下载格式 v1、引擎 0.69.0、26 个候选；搜索范围、全部候选及选中结果一致；明确 `preview-not-applied` |
| 下载保持原方案 | 原 24 箱方案 ID 保持不变，无新增散箱预留；报告内是 30 箱候选，不会自动采用 |
| 中文／英文 CSV | 各三条稳定源行、20 列、BOM；原需求、原／候选已装、预留、实际散箱、托内及未装一致；路径与固定仍为未核验 |
| 无改善 | 原装 12，四个候选仍 12；JSON 完整且 `selectedCandidate=null`，候选 CSV 不可用 |
| 失效与文件格式 | 第三上限往返修改后两个旧下载入口消失；把试算 JSON 送入工作区恢复会拒绝，无恢复确认、原 24 箱保留 |
| 回归与恢复 | 两站各 18 次基准全部通过，原九案例输入不变；原订单及配置完全恢复，两策略均 116 箱／3,842 kg，无托盘 |

原生下载、16 项文件断言及哈希见[验收索引](field-upgrades/evidence/v0.69.0-acceptance-index.json)，[页面截图](field-upgrades/evidence/v0.69.0-report-proof.jpg)、[本地检查记录](field-upgrades/evidence/v0.69.0-local-checks.txt)、[部署与 CI 记录](field-upgrades/evidence/v0.69.0-release.json)已归档。停止、超时、旧导出方法、篡改和公式保护等边界由完整单元回归覆盖；不把这些单元用例写成全部已在真实浏览器逐项操作。

当前云端 Chrome 两站均为 WebGL 回退；真实 GPU、多浏览器和现场试装继续 PENDING。

## 剩余范围

本轮没有扩大三组／单柜的求解范围。四组以上、跨柜联合、经济尾数、原位补货、真实 GPU、多浏览器及原用户 596→16 工作区核验保留待办。具体叉车动作排除；账号／会员／支付未启用。见[未完成台账](field-upgrades/unfinished-roadmap.md)。
