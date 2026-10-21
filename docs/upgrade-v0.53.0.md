# v0.53.0 防潮、唛头与人工过程核对

当前交付版本增加独立作业核对：柜况、整单清单、唛头、防潮依据、封柜，到货、附件拆除和清场。按已有附件安装依赖形成前置关系；只读取已计入的材料，不重复加重量。每次登记必须填写核对人和实查说明，未核对保持未核对。

撤回或重做前置检查后，下游旧确认转为需复核。多人并行记录保留为冲突，须明确复核合并；旧版本及相同编号不同内容拒绝导入。提供完整 JSON、文本备份和 CSV，损坏缓存保留原文，存储失败保留本页记录。详细契约见 [016B](field-upgrades/016b-operations.md)。

具体叉车操作继续排除；账号、会员及付费没有启用。U22 仍为 PARTIAL，真实表面唛头遮挡、防潮计算、暂存工序和临时支承安全判断尚未完成。

## 验证与部署

`npm run build:pages` 通过：1,415 项单元测试（106 文件）、21 项页面结构检查、TypeScript、静态生产构建；lint 0 错误、2 项既有警告。新增作业核心及界面专项 30 项通过。首轮因本地缺失两份旧验收夹具失败；从 GitHub 恢复原字节并核对摘要后，完整流程重跑通过，没有删除旧测试。

运行提交 `66d0e9a087b1de10d27726ae201d7722406e48f0`，树 `2383d9fab9857db3446dc12bfdee403e15272cc7`；[GitHub verify](https://github.com/guodongbuding66-spec/container-load-planner/actions/runs/39624495307/job/119306218880) SUCCESS。Vercel 生产部署 `dpl_5e8EanZWJmAPE9mkstEADWN3htgB` READY，正式域名为 https://container-load-planner-gray.vercel.app/。

## Vercel 正式站实际验收

- 在界面配置两项合成附件：装货前垫木 3kg、装货后防潮材料 2×0.5kg，防潮材料依赖垫木。116 箱货物 3842kg，加附件合计 3846kg，不重复计重。原始[交付方案](field-upgrades/evidence/v0.53.0-operations-workspace.json)留档。数据仅用于软件验收，不能作实装说明。
- 未核对时不能确认整单。7 项装货检查逐项登记后，撤回并重新确认柜况检查，6 项下游仍显示需复核，不自动恢复；[中文截图](field-upgrades/evidence/v0.53.0-operations-zh.jpg)及[英文截图](field-upgrades/evidence/v0.53.0-operations-en.jpg)。
- 从真实导出构造明确标识的合成并行异常分支，经文件导入触发冲突。查看完整历史并明确勾选后才可复核合并，原异常保留。提前确认拆垫木被阻止，反向依赖下 5 项到货／卸货核对依次可登记。这是软件记录流，不是设备动作验收。
- 最终保留 16 条事件；完整 [JSON](field-upgrades/evidence/v0.53.0-operations-records.json) 原生下载与公开备份文本逐字节一致，[CSV](field-upgrades/evidence/v0.53.0-operations.csv) 为 16 条事件加表头。重复导入、面板重开、刷新后恢复同一方案均未丢失或增加记录。错版本、同编号不同内容拒绝且原备份不变。
- 中英文新界面和保存提示通过。恢复默认三 SKU 后，现场／高密度均为 116 箱、3842kg、算法 0.53.0，切回现场方案；最近 200 条日志范围内应用错误及警告为 0。
- 合成方案的既有门洞路径不通过、承重／固定未核验均保留，作业确认没有将其改成通过。WebGL 不可用时仍为真实坐标俯视图，不能宣称真实 GPU 验收完成。

详细结果见[验收 JSON](field-upgrades/evidence/v0.53.0-acceptance.json)。最终证据提交仅更新文档和验收文件，运行代码保持相同。

## Cloudflare 及其他未完成验收

Cloudflare 未出现本提交自动部署；现有控制台和 Wrangler 均未登录。安全登录请求返回 declined，未继续登录或改变授权。实际从该站导出的输入备份仍为 0.52.0，因此 **Cloudflare 发布和双站往返验收为 PENDING**，本轮不能宣称双站同步。该站验收草稿已恢复默认示例。

真实 GPU、多浏览器、实物扫码、打印和现场试装仍待对应环境验收。U22 的实体唛头遮挡、防潮计算、动态暂存和临时支承判断继续保留；账号、会员、支付仍按独立方案后续接入。
