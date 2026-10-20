# v0.48.0 稳定订单行与客户、批次资料

日期：2026-10-20。基线 main `76f9f31d4fcb5db41b9410f31dcbb2e423e08928`，源树 `4aae3f5a0b42d9eeb6430f648c028c842e1202f2`。

相同 SKU 可保留多条独立源订单行，分别记录订单编号、业务行号、批次、客户、目的地与卸货站次。继续使用原产品 id 作为稳定源行身份，不按 SKU 合并数量。具体范围见 [014A](field-upgrades/014a-order-rows.md)。

## 本轮行为

- 从货物表打开订单行资料；内部 ID 只读，编辑资料保持 ID。复制普通行创建新 ID；复制套装连同全部组成行，使用新套装编码并清空业务行号和外部来源引用，需求数量一同复制。
- CSV／Excel 选择替换订单、追加为新行，或按 ID 只更新数量。替换文件中有 orderLineId 时保留，没有时继续生成新行；追加总是新 ID，既有套装编码冲突会被拒绝。
- 数量更新只读 orderLineId 与 quantity，其他列忽略；拒绝未知／重复 ID，保留箱规、承重、客户、批次、来源及包装规则。允许 0 箱保留源行；已指定散装预留不得超过更新后的数量。替换不能静默移除包装或附件的源行引用。
- 旧结果的客户／站次在资料采用及数量更新时可继承到源订单；已有新源资料不被旧结果覆盖。双算法、预打托、多柜、独立数据审计和备份恢复使用相同资料；矛盾站次拒绝恢复。
- 同 SKU 的输入控件以行 ID 区分。有订单资料或同 SKU 多行时，坐标 CSV 追加源行身份与批次；其他旧导出保留原列序与末尾扩展列。客户报告、离线指导书与 PDF 增加源行明细，PDF 长 ID 自动换行。
- 订单行 CSV 供数量更新及新单导入；完整来源、包装版本和全工作区资料仍使用 JSON 备份。站次用于现有静态复核，没有新增几何调度优化。

## 验证与发布

本地 lint（0 错误，原有 3 条警告）、TypeScript、1,268 项单元测试（96 个文件）、21 项页面结构检查和 Next 生产静态构建通过。新增 34 项核心回归、3 项界面回归。已修正实际 UI 验收发现的表单输入框样式问题，专项 3 项再次通过；功能最终提交的 GitHub 完整构建亦通过。

源订单行稳定不等于实物箱／托身份稳定；014B 的跨版本身份、计划修订、逐托扫码、离线冲突与现场剩余重排仍未完成。具体叉车作业 EXCLUDED；真实 GPU 与现场试装 PENDING。


## 发布与正式站验收

功能提交 `307b81eae9617584692797d6842ec5e7ff7976aa`；界面修正提交 `580ecdf9382d67ee9dbfe9049974dcd9e10f134a`，最终功能源树 `c6842a44faf356f75eb20a5fee3ef7ac568d8e21`。修正提交 GitHub verify `39397638849`（job `118544214951`）成功；Pages `17760354-0087-415d-8023-32af97ab60fb` 成功；Vercel `dpl_CfCUSDtFX32FcpdokrgpXGBBy4et` READY、production，正式灰色域名已关联。后续仅更新本轮证据与文档，最终 main 以其最新自动检查为准。

正式地址：[Pages](https://container-load-planner.pages.dev/)／[Vercel](https://container-load-planner-gray.vercel.app/)。以下均使用合成软件测试订单，非实际客户资料。

| 实际操作 | 观察结果 |
| --- | --- |
| Pages 替换 CSV，两行相同 SHED-BOX | row-a／row-b 独立保留；分别为 2／3 箱，客户 A／B、批次 A-01／B-02、站次 1／2 |
| 按 ID 更新 Excel：row-b=4，另带 customer=IGNORED | 仅箱数变为 4；原客户 B、批次、站次和 500×500×200 mm、10 kg 箱规不变 |
| 未知行 ID 更新 | 整次拒绝，需求仍为 2＋4；无部分写入 |
| row-b 数量改为 0，再恢复 4 | 保留源行与业务资料，数量及总重正确归零／恢复 |
| 复制 row-b | 新独立 UUID、4 箱、保留客户 B／批次 B-02，清空业务行号，原 row-b 保持不动 |
| 追加 CSV 输入带既有 row-a ID | 生成新 UUID，不覆盖既有行；新行客户 C／批次 C-03／站次 3、1 箱 |
| 双算法与实际下载核对 | 四行需求 2／4／4／1，两套算法各 11 箱、110 kg；坐标 CSV 11 条，逐行批次、源行 ID、数量守恒；订单 CSV 4 行 |
| Vercel 英文跨站恢复及再次下载 | 原 ID、客户、批次、站次、箱规及两套方案逐箱坐标一致；恢复规范化增加空 setCode 和直接装柜未启用的默认 palletBuild，已在核对记录说明 |
| 备份后刷新与中英文表单 | 四条订单行草稿保留；稳定 ID 只读，英文新增表单无中文，修正后输入框边界及间距正常 |
| 实际 PDF | 7 页逐页渲染检查；第 4 页分别列出四条独立 ID 与客户、批次、站次和已装数，包含两条完整 UUID；未见截断重叠 |
| 默认回归 | 两站恢复验收前默认 3 SKU、40HQ、10 mm 间隙，重新求解两套方案各 116 箱、3,842 kg，引擎 0.48.0；临时订单清理 |

测试订单静态装卸路径未通过，PDF 如实显示“未通过”；本次通过的是源数据、几何及导出一致性，没有把路径问题当通过。验收环境 WebGL 未启用，仍使用同源坐标回退，真实 GPU、其他浏览器及现场试装继续 PENDING。

证据：[中文订单行](field-upgrades/evidence/v0.48.0-order-rows-pages.jpg)、[英文订单行](field-upgrades/evidence/v0.48.0-order-rows-english.jpg)、[实际订单 CSV](field-upgrades/evidence/v0.48.0-order-rows.csv)、[实际坐标 CSV](field-upgrades/evidence/v0.48.0-coordinates.csv)、[实际工作区](field-upgrades/evidence/v0.48.0-workspace.json)、[PDF 订单页](field-upgrades/evidence/v0.48.0-order-pdf-page.jpg)、[PDF 全页缩略图](field-upgrades/evidence/v0.48.0-pdf-contact.jpg)、[下载独立核对](field-upgrades/evidence/v0.48.0-download-review.json)。

下一阶段是 014B 实物箱／托的跨版本稳定身份及计划修订，之后才推进逐托二维码、防重、离线与现场变更；[未完成台账](field-upgrades/unfinished-roadmap.md)继续保留这些缺口。具体叉车操作不在范围内。
