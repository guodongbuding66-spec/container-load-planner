# v0.50.0 箱托二维码与离线现场事件

日期：2026-10-21。基线 main `231da301d0d8e34678e7bab2b8d1f52e7c9085ff`。v0.49.0 交付版本双站验收完成后，继续接入实际装载登记。

在“方案工具 → 交付与现场”新增“扫码与实际装载登记”。先登记当前交付版本，再手选或核对二维码，确认箱托装载、缺箱、损伤及撤回。重复确认不重复统计，事件只追加；离线文件按事件 ID 去重，同单元并行分支须明确处理。

每箱／每托可下载包含二维码、版本和完整分层清单的离线 HTML；二维码仅携带版本与编号，接收设备先恢复匹配工作区。现场 JSON 单独下载，包含备注及本机照片；普通工作区备份不包含现场事件。事件 CSV 用于核对，JSON 用于无损合并。旧指导书页面游标改称阅读位置，避免误作实装台账。

完整契约、上限和继续待做见 [014C/D/E 首阶段](field-upgrades/014c-field-events.md)。具体叉车操作排除；已装自动锁定、修订间迁移和云端同步尚未实现，真实 GPU、扫码硬件和现场试装分别待验收。

## 验证与发布

28 项新增专项全部通过；`npm run build:pages` 的 1,328 项单元测试（101 个文件）、21 项 HTML 检查、TypeScript、lint（0 错误、原有 3 条警告）与 Next 静态生产构建通过。运行代码提交 `c642f85a27ae92d7ed6dde859faa61916ac1b459`，错误本地化修订 `5abbbf1d77622ba0962d0c9e49a1bc31f115019b`（源树 `abf13db9ad96050a0e6348f6a7a97acec704b626`）再次通过专项、类型、lint 及 GitHub 完整 verify。后续验收资料提交不改变运行代码。

- Cloudflare Pages 部署 `ba6de6bd-87a9-4381-9d2e-ab9172dc6e3b` 成功；根域实际恢复 v2 并使用英文现场面板，旧 v1 二维码明确拒绝。
- Vercel production `dpl_4iskpm6jDcztYckDziS69s8zzLMe` READY，精确指向 `5abbbf1`，正式灰色域名已分配。最终部署刷新并恢复 v2 后，本机四事件及已装／损伤状态继续保留。
- Vercel 明确确认首箱两次，仍为 1 箱／1 事件；附本机照片登记损伤后为 1 已装、1 损伤、2 事件。未填原因撤回被拒绝，计数不变。
- Pages 独立记录同箱缺失后导入 Vercel 事件，产生 1 个冲突，普通操作禁用、无原因不能处理。明确核实为“已装／损伤”后为 4 事件；重导旧分支不重计或重开冲突。导回 Vercel 后，两个实际下载文件的 context 与按 ID 归一的完整事件映射一致，照片保留；实际 CSV 四行事件逐项匹配。
- Vercel 正式站重新计算八箱、两层独立打托，登记 8 箱及 1 包装。一次确认整托产生 1 条事件、9 个原子变化，105 kg 计划重量；重复确认不增加。实际 HTML 标签为 1200 × 1000 × 544 mm，包含全部八箱与两层坐标。
- 两站恢复测试前的默认三 SKU 草稿，双算法均完成并独立校验。实际下载备份的引擎均为 0.50.0；两个策略各 116 箱，逐箱／包装重量合计 3,842 kg，没有测试交付登记号。
- 抽查 Pages 135 条、Vercel 150 条浏览器 error 日志，均为浏览器扩展来源；应用来源 error 为 0。此结论仅覆盖捕获的前端日志，不代表全站后端监控或全部用户会话。

原始证据（均为合成验收样例）：[合并事件及照片 JSON](field-upgrades/evidence/v0.50.0-merged-events.json)、[事件 CSV](field-upgrades/evidence/v0.50.0-events.csv)、[单箱标签 HTML](field-upgrades/evidence/v0.50.0-unit-label.html)、[英文冲突界面](field-upgrades/evidence/v0.50.0-conflict.jpg)、[整托方案 JSON](field-upgrades/evidence/v0.50.0-pallet-plan.json)、[整托事件 JSON](field-upgrades/evidence/v0.50.0-pallet-events.json)、[整托标签 HTML](field-upgrades/evidence/v0.50.0-pallet-label.html)、[整托登记界面](field-upgrades/evidence/v0.50.0-pallet.jpg)。

标签已通过生成 SVG、HTML 结构及完整内容检查。云浏览器禁止打开本地 file 协议，未绕过该限制，未宣称已进行该离线文件的浏览器渲染或真实打印扫码验收。实际网站采用降级视图，真实 GPU、其他浏览器和现场设备验证继续 PENDING。
