# v0.78.0 包装、几何与工程约束（第 2／5 轮）

2026-11-05 发布，2026-11-06 完成采用后的双站复验（Asia/Shanghai）。[五轮交付计划](five-release-plan.md) · [工程与布局契约](field-upgrades/018-engineering-layouts.md)

- 新增原柜整托／木箱补入。保留原位箱托、已装柜前缀和散箱预留，核对实际新增包装库存、进柜路径和打托费用。
- 底铺托盘绕开障碍与预留，长件检查实际接触及各路径累计载荷上界。适用四角资料齐全时，同高落地木箱可联合承托一层。
- 新增额定地板区、接触载荷与配重窗口复核，以及铰接三支承点静态轴荷。输入、复核、备份及导出保留来源和版本。
- 异型层型保存实际截面；整托实测重排可按包装及箱规水平转向；模型零件增加 XYZ 刚性倾角、保守空隙和直线拆出复核。

## 正式站点验收

| 场景 | 受控结果 |
| --- | --- |
| 主站整托补入 | 原柜 4 箱、1 托。独立复核两个候选后采用 6 箱、2 托、88 kg，余货为 0。原托和 4 个锁定箱位的 ID、坐标和锁定记录一致。新半托起点为 1000／0／0 mm。 |
| 库存与报价 | 保持 1 柜，实际新增包装费 3 元和打托费 4 元，配置费用 105→112 元。采用后的方案可立即导出。 |
| Vercel 跨站恢复 | 完整多柜备份重新校验通过，配置费用仍为 112 元。两站导出的全柜坐标 CSV 逐字节一致，含 6 箱和 2 个底座。 |
| 地板与配重 | 10 kg 货物得出接触载荷上界 250 kg/m²，区段 10／12 kg，从柜头和左壁量起的重心均为 110 mm。400 kg/m² 限值通过，200 kg/m² 限值阻止坐标导出。备份恢复保留额定资料。 |

首次界面验收发现，整托补入采用后仍显示原多柜结果，因为包装输入相同，原有交接流程没有重新挂载多柜面板。修复后直接采用已校验的多柜候选，随后完成原生采用、导出和跨站恢复。

## 发布与证据

2,113 项单元测试（161 个文件，较 v0.77.0 新增 14 项）、21 项页面检查、类型检查和生产构建通过。ESLint 为 0 错误及 2 项既有警告。两个站点各完成 20 次固定基准，所有结果均通过模型校验。地板及固定基准原生报告来自首次 v0.78.0 发布，采用修复未改动相关引擎源文件。最终运行提交完成 13 项界面断言与 10 项原件复核。两站已恢复验收前的订单，现场与高密度策略均为 116 箱、3,842 kg。

运行提交 `a22bf0db7dadc539a4c59fed6ae2d61b1035334c` 的 GitHub CI 成功，Cloudflare Pages 发布 `d2363fc0-170d-423f-9a11-bac0e71dc225` 成功，Vercel 发布 `dpl_AinDUvvmmqCJJDnWa3FHkLsmDt7k` 为 READY。[GitHub CI](https://github.com/guodongbuding66-spec/container-load-planner/actions/runs/42014420131) · [主站](https://container-load-planner.pages.dev/) · [Vercel](https://container-load-planner-gray.vercel.app/)

[原件及 SHA-256 索引](field-upgrades/evidence/v0.78.0-acceptance-index.json) · [界面验收](field-upgrades/evidence/v0.78.0-native-ui-checks.json) · [文件复核](field-upgrades/evidence/v0.78.0-native-file-checks.json) · [发布状态](field-upgrades/evidence/v0.78.0-release-state.json)

## 验收范围

装箱和受控工程资料用于软件校验。包装额定与材料、现场试装、原 596→16 工作区、真实 GPU、多浏览器及道路工况需要实际证据。CAD 约束、任意姿态自动搜索及柔性／强度模型继续保留在台账。[剩余功能清单](field-upgrades/unfinished-roadmap.md)
