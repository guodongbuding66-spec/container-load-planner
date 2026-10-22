# v0.55.0 整托搜索一致性与候选来源

日期：2026-10-22。发布状态：完整回归、GitHub CI 和双站同源发布及实际验收通过。

## 本轮变化

固定整托散箱案例此前现场 32 箱、高密度原始候选 31 箱，且主页面、基准与多柜调用结果不一致。本轮在共同整托求解入口加入一次完整现场候选，按相同输入独立重建校验；仅在箱数严格增加、每个源订单行已装数量不减少时采用。

原始夹具与策略限制保持不变，该案例采用 A 12 + B 20 = 32 箱／340 kg，保留原高密度 31 箱及采用来源。整托内容、库存、自重与余货来自同一完整候选。基准报告和页面明确说明来源，恢复旧备份不推断两次搜索独立收敛。页面比较也增加逐订单行保护，不能用更多可选箱替换必装货物，不能把不同数量错误显示成一致。新增警告按界面语言翻译；归档箱位只称为启发式候选，不暗示本次独立搜索得到。

范围、采用契约与保留限制见 [017A](field-upgrades/017a-pallet-search-lower-bound.md)。U09、U10、U23 继续 PARTIAL，完整剩余清单见[台账](field-upgrades/unfinished-roadmap.md)。具体叉车操作继续 EXCLUDED；账号、会员及支付尚未启用。

## 验证与发布

`npm run build:pages` 完整通过：1,484 项单元测试（112 文件）、21 项页面结构检查、TypeScript 和静态生产构建；lint 0 错误、2 项既有警告。新增 22 项候选采用、共同调用与界面来源回归通过。[GitHub verify](https://github.com/guodongbuding66-spec/container-load-planner/actions/runs/39712418939/job/119606603607) SUCCESS。运行提交 `f8b4152e14d42f9fec2485f10c62535e9363ca52`，树 `b5da2da1c780b472841211ccb41fdaf419f7595e`。Vercel 生产部署 `dpl_55K5HeHZAkk7ss8w2c7EteTM3DaT` READY；Cloudflare `2444a8fa-b889-4934-bd2e-6ce58d450f73` SUCCESS，两个正式域名均实际复测。后续文档和证据提交不修改上述运行代码。

## 正式站验收

- 使用原始固定案例的[合成输入](field-upgrades/evidence/v0.55.0-workspace.json)，柜内 1400×1000×800 mm、A 30 箱、B 20 箱，分别指定散箱 2 箱，包装总上限 4。没有修改案例版本、限高、允许方向或库存来得到更多箱数。
- 两站主页面均为现场／高密度各 32 箱，A 12、B 20、货物 320 kg 加 1 托自重 20 kg，合计 340 kg；余货 A 18。显示“采用合法下界”和“候选复用，不代表两次搜索自然收敛”。新警告及比较说明的英文实测不夹带中文，见[英文截图](field-upgrades/evidence/v0.55.0-comparison-en.jpg)。
- 双站各实际运行 12 组 Worker 基准，全部模型校验通过；箱数、套数、重量、物理参考差距和候选来源一致。高密度原始 31 箱、补充并复核后采用 32 箱的事实保留；大业务案例最优值仍未知。[Vercel JSON](field-upgrades/evidence/v0.55.0-benchmarks-vercel.json)、[Cloudflare JSON](field-upgrades/evidence/v0.55.0-benchmarks-cloudflare.json)、[中文截图](field-upgrades/evidence/v0.55.0-benchmarks-zh.jpg)。
- 双站原生方案 JSON 的全部货物箱位、托盘记录一致；原生坐标 CSV 均为表头 + 32 货物记录 + 1 托盘记录，合计 340 kg，逐字节相同。[Vercel 方案](field-upgrades/evidence/v0.55.0-plan-vercel.json)、[Cloudflare 方案](field-upgrades/evidence/v0.55.0-plan-cloudflare.json)、[坐标 CSV](field-upgrades/evidence/v0.55.0-placements-vercel.csv)。
- Vercel [原生工作区备份](field-upgrades/evidence/v0.55.0-workspace-native.json)在 Cloudflare 实际恢复成功，仍为 32 箱／340 kg；[恢复后 CSV](field-upgrades/evidence/v0.55.0-placements-restored.csv)与两站原始导出逐字节相同。历史坐标没有保留未经重算的生成来源，界面改称“启发式候选”。
- Vercel 实际多柜 Worker：仅启用同一 QA 柜型、可用 1 柜、最多 1 柜，运费 100、每包装 5。输出 32 箱／340 kg，总费用 CNY 105，余货 A 18；已用包装 1／4，剩余 3，指定散箱 A/B 各装 2。完整包装和候选来源保留在[原生多柜备份](field-upgrades/evidence/v0.55.0-fleet.json)，[费用 CSV](field-upgrades/evidence/v0.55.0-fleet-costs.csv)原生下载通过。该多柜操作本轮在 Vercel 实测；Cloudflare 通过相同基准与主求解入口验收，不冒充该站同一费用界面操作。
- 双站恢复默认三 SKU、直接装柜、清除合成柜型，再运行双算法：现场／高密度均 116 箱、3842 kg、算法 0.55.0，当前现场策略和中文。原生默认备份复核通过。两个标签最近 200 条浏览器日志未见应用 error/warn；Vercel 当前部署最近 30 分钟 error/fatal 无记录。

文件摘要与结果见[验收 JSON](field-upgrades/evidence/v0.55.0-acceptance.json)。当前浏览器仍无 WebGL，使用真实坐标俯视图；真实 GPU、多浏览器和现场试装继续 PENDING。

## 保留工作

U09／U10 的经济尾数、自动拆托重打、跨柜联合搜索，以及 U23 的隐藏验收集、历史比较均未完成；候选比较不是全局最优证明。复测另发现多柜“已达到柜数上限”终止说明在英文界面仍显示中文，登记为后续界面修正；本轮通过的是新增候选来源及比较说明的中英文验收。全部剩余功能见[未完成清单](field-upgrades/unfinished-roadmap.md)。
