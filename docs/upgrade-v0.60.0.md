# v0.60.0 木箱外部总高与逐托底座说明

日期：2026-10-23。功能、标签宽度修正与双站验收已完成，原生证据已归档。

针对用户截图中“高度为什么自定义不了”，新增木箱外部总高输入并自动换算内部净高；1174 mm 明确分解为底座 144＋内部 1000＋箱盖 30。每托底座结构、完整外形和底座尺寸分别说明，主场景托盘属性及整托独立查看补充托面位置、包装自重、整托总重和箱数，清单不再把底座尺寸笼统称为整托尺寸。

每个整托独立底座的求解已有实现；本轮核对其多托坐标、计高、计重、门洞限制和备份一致性，没有新增叉车动作，也没有改动搜索算法。范围与实物照片来源见 [006B](field-upgrades/006b-crate-exterior-height.md)。

## 软件验证与发布

| 检查 | 结果 |
| --- | --- |
| 完整单元测试 | 1,665 项通过，129 文件 |
| 相关专项 | 30 项通过，其中 12 项新增 |
| HTML 页面检查 | 21 项通过 |
| TypeScript、生产构建 | 通过 |
| lint | 0 错误、2 项既有警告 |
| 标签宽度修正 | 12 项专项、TypeScript、生产构建通过，修改组件 eslint 0 错误 |
| GitHub CI、Cloudflare、Vercel | 最终功能及标签宽度修正均成功 |

功能提交：[27d771ca65285ba94ad538fb900bc4e64cc5a26b](https://github.com/guodongbuding66-spec/container-load-planner/commit/27d771ca65285ba94ad538fb900bc4e64cc5a26b)，[CI](https://github.com/guodongbuding66-spec/container-load-planner/actions/runs/39884260408/job/120188629745)；Cloudflare 部署 `17a30842-d0b9-47e3-bbff-6011ffd13cbf`，Vercel `dpl_HNjKUiEZ4AJWekhpcnMWY2yE8zjN` READY。标签宽度修正提交：[9768d4e527eda0002d9ba82d38f9dd93ed4081f8](https://github.com/guodongbuding66-spec/container-load-planner/commit/9768d4e527eda0002d9ba82d38f9dd93ed4081f8)。

## 正式站实际操作

在 [Cloudflare](https://container-load-planner.pages.dev/) 通过正常“恢复工作区”入口导入[合成输入夹具](field-upgrades/evidence/v0.60.0-crate-height-input.json)。这不是用户真实订单或已核准现场方案。

- 总高 1174 改为 1200 mm，内部净高自动变为 1026 mm，预览同为 1200 mm。输入 174 mm 显示无效并禁用计算；改回有效总高恢复。
- 移除箱盖后总高为 1170 mm；无盖时输入 1200 mm，内部净高为 1056 mm；加回箱盖，总高为 1230 mm。最后恢复含盖 1200 mm。
- 先输入无效草稿，再切换开放托盘，总高字段消失且计算恢复可用；切回条板木箱可以正常录入。
- 计算得到 4 箱、2 托、90 kg。每托底座 1700 × 560 × 144 mm、外形 1700 × 560 × 1200 mm、包装自重 25 kg、整托总重 45 kg、2 箱；货物 Z 为 144／644 mm，没有再次叠加底座高度。
- 主视图用键盘 Enter 选中托盘，独立查看第二托，均显示本托数据。独立查看的 XYZ 明确移到局部原点。现有俯视回退图中心点击会命中覆盖底座的货物，因此不把中心点击误记为底座选择通过。
- 验收截图发现新属性沿用了原有 40 px 短标签列，导致中文标签断行；已改为按字号分配 6 em 标签宽度，正式站已复查：标签列 84 px、每个中文标签单行 21 px，截图已确认。

原生[工作区备份](field-upgrades/evidence/v0.60.0-workspace-native.json)恢复到 [Vercel](https://container-load-planner-gray.vercel.app/) 后，[原方案](field-upgrades/evidence/v0.60.0-plan-cloudflare.json)与[恢复方案](field-upgrades/evidence/v0.60.0-plan-restored-vercel.json)的箱位、托盘、包装参数、柜型和业务统计相同。恢复不会重复搜索，`solveTimeMs` 从原始 17.8 ms 变为 0，不将两份 JSON 冒称为逐字节一致。内部净高仍为 1026 mm；切换英文后字段、分解式和提示正确，重新计算仍为 4 箱。

两站[坐标 CSV](field-upgrades/evidence/v0.60.0-coordinates-cloudflare.csv)逐字节相同，均为 1,586 字节，SHA-256 `e9a08bb29f4f8d4f0eda622c897ce322f1f018f09d301ed4d67ac784183ba64f`。[另一站 CSV](field-upgrades/evidence/v0.60.0-coordinates-vercel.csv)同步归档。

该高度夹具的布局模型通过，路径复核仍显示门洞失败和未指定卸货站次，不作为现场可执行方案。承重缺资料仍显示未核验，没有因尺寸录入成功改为已核验。

## 基准、恢复与交付边界

双站均通过正常界面恢复直接装柜样例并重新计算，现场和高密度均为 116 箱、3,842 kg。两站各运行六组、两策略共 12 个固定案例，均结束并通过模型校验，原生报告：[Cloudflare](field-upgrades/evidence/v0.60.0-benchmarks-cloudflare.json)／[Vercel](field-upgrades/evidence/v0.60.0-benchmarks-vercel.json)。整格案例为 22／24 箱、重量案例 12／12、门洞 0／0、套装 21／24、长条混装 116／116、整托散箱 32／32；保留策略差异与未知最优状态。

浏览器捕获的 error／warn 中观察到扩展元数据传输错误，未观察到应用来源错误。Vercel 功能部署最近 30 分钟 error／fatal 查询未返回日志，这不能替代浏览器或 GPU 验收。最终双站刷新、重算和查看偏好复查通过；已恢复中文、mm、测量三位小数、关闭临时测量、0 条保存测量和默认 116 箱方案。

上一轮四份最终测量 PDF、原生 JSON 和截图已归档；测试测量数据已清零。v0.59.0 的中断历史和本轮重新验收分别记录，不把 v0.60.0 基准改标为旧版。

真实 GPU、多浏览器、工程额定资料与现场试装继续 PENDING。具体叉车操作 EXCLUDED；账号、会员、支付未启用。其他未完事项仍见[台账](field-upgrades/unfinished-roadmap.md)。机器可读结果及原件校验值见[验收记录](field-upgrades/evidence/v0.60.0-acceptance.json)。

最终修正 [CI](https://github.com/guodongbuding66-spec/container-load-planner/actions/runs/39906408975/job/120259286458) 再次完整通过 1,665 项单元与 21 项页面检查。Cloudflare 部署 `a08b169d-ca89-4a82-99ce-f30fa351c93c` 成功，Vercel `dpl_8HQfLzJhRqi4dcn9L37n4nsYFzuV` READY，正式别名均指向修正提交。上列两份固定基准为最终修正部署刷新后重新运行并下载的原件。截图：[外部总高输入](field-upgrades/evidence/v0.60.0-crate-height-ui.jpg)／[整托属性最终界面](field-upgrades/evidence/v0.60.0-unit-base-ui-final.jpg)。
