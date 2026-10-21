# v0.49.0 交付版本与箱托登记编号

实现日期：2026-10-20；本轮恢复与验收：2026-10-21。基线 main `8baf07053781ce6b6996372ce1f92276025a3365`，源树 `802c57787ffc22260c94d87ceb582e863e811a5c`。

在“方案工具 → 交付与现场”增加交付版本登记。用户明确登记后，下载保留当前单柜／独立打托箱位的工作区备份，分配计划、修订及箱托 UUID。普通求解候选保持未登记，登记不代表制作、实装或运输安全。具体契约及剩余边界见 [014B1](field-upgrades/014b-delivery-versions.md)。

## 本轮变化

- 计划号与数字版本、独立版本 UUID、上版 UUID 分开，允许识别同号分支；未做分支合并。
- 已登记方案局部编辑后显示待登记下一版。移动、旋转、转托及局部重排保留可确认的箱托编号；新增单元新号，移出或批次／物理规格变化保留撤出记录。
- 复制新计划全部使用新编号并记来源；归档库复制采用相同契约。恢复版本保留原号，整单重算不猜测实物继承。
- 当前／待登记状态、单元号和版本资料进入工作区 JSON、坐标 CSV、客户／离线报告及 PDF；现场进度按版本区分。普通输入草稿仍只保存输入，登记操作明确下载持久备份。
- 按 schema 校验身份记录、唯一性、版本上限、父版本和当前绑定；摘要仅用于变更检测，不能代替认证或防恶意篡改。

## 验证与发布

专项 28 项核心、4 项界面回归恢复后再次通过。恢复后 `npm run build:pages` 的 1,300 项单元测试（98 个文件）、21 项页面检查、TypeScript、lint（0 错误，原有 3 条警告）与 Next 生产构建通过。正式双站实际验收通过，源提交 `6c1c48cc6a5662bb9c4eb1fba34051306b4970e6`；正式别名重建提交 `231da301d0d8e34678e7bab2b8d1f52e7c9085ff` 使用同一源树 `5f15e6835f483d59705259025cbc8b6f41f0bb39`，GitHub verify、Cloudflare Pages 与 Vercel production 均成功。

- Vercel 实际登记 v1，将首箱 Y 从 0 移至 100 mm 后显示待登记；发布 v2，11 箱全部保留编号。
- 实际复制新计划得到新计划号、版本 UUID 和全部新箱号，记录 v2 来源，箱位不变。
- Pages 根地址恢复 Vercel 的 v2，英文面板显示 current；实际下载备份为引擎 0.49.0，编号、版本和全部箱位逐项一致。
- 实际下载 CSV 的 11 箱与 v2 编号一一对应；8 页 PDF 全部渲染检查，第 4 页完整显示计划、版本 UUID 和 11 箱编号，无截断。PDF 为栅格报告，文本抽取不作为验收证据。

证据：[v1 JSON](field-upgrades/evidence/v0.49.0-v1.json)、[v2 JSON](field-upgrades/evidence/v0.49.0-v2.json)、[复制 JSON](field-upgrades/evidence/v0.49.0-fork.json)、[CSV](field-upgrades/evidence/v0.49.0-coordinates.csv)、[Vercel 界面](field-upgrades/evidence/v0.49.0-vercel.jpg)、[PDF 编号页](field-upgrades/evidence/v0.49.0-pdf-identity.png)。补充 [Pages 英文界面](field-upgrades/evidence/v0.49.0-pages.jpg)，跨站结论同时以实际下载 JSON 的独立逐项比较为依据。浏览器采用降级视图，不能据此宣称真实 GPU、多浏览器或现场试装通过。

014B 仍为 PARTIAL：源实物台账、跨柜身份、拆托替代及完整规格身份库待后续；扫码、现场事件、离线冲突仍待后续。真实 GPU、其他浏览器与现场试装保持 PENDING。具体叉车操作不属于本轮范围。
