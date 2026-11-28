# CargoFit v1.1.0 升级与全量质量验收记录

发布日期：2026-11-27

## 一、核心升级内容

### 1. 真实浏览器 QA 7 项缺陷彻底修复
- **极简 3 步模式修复**（`components/packing-app.tsx`）：修复步骤 1 点击下一步卡死并误报「请按顺序完成当前步骤」的问题，同步修正按钮文案（「下一步 · 录入货物」「下一步 · 计算方案」）与步骤 3「上一步」回退目标。
- **深色模式全界面对比度修复**（`app/cargo-workbench.css`）：修复步骤七 KPI 卡片黑字隐身、策略切换栏反白、三视图表头/角标反白及步骤一简化预览画布反白问题。
- **WebGL 降级刻度标尺修正**（`lib/packing/scene-dimensions.ts`、`lib/packing/qa-round8-fixes.test.ts`）：消除 40HQ 与托盘短边出现无效 `0` 刻度的缺陷。
- **全局单位制完整联动**（`components/packing-app.tsx`）：顶部 `mm/kg`、`cm/kg`、`in/lb` 切换后实时换算步骤一柜体内尺、门洞、最大净载重、间隙输出、右侧概览及步骤六核对摘要。
- **移动端响应式重构**（`components/packing-app.tsx`、`app/cargo-workbench.css`）：`390px` / `320px` 视口顶栏收起为 `64px` 单行加可展开「菜单」按钮，底部操作栏改为通栏布局，水平溢出 `0 px`。
- **向导步骤回退解锁**（`components/packing-app.tsx`、`components/workflow-steps.tsx`）：引入 `maxReachedStep` / `maxUnlocked`，从步骤 7 回看步骤 2 后步骤 3–7 保持解锁可直达。
- **动效、文案、无障碍与站点地图**：统一按钮 `0.14s` 过渡动效，`SPACE PREVIEW` 汉化为「空间预览」，消除托盘副标题重复尺寸，更新货物设置提示文案并显式添加 `role="dialog" aria-modal="true"`，补齐 `public/sitemap.xml`。

### 2. P0 公开学术基准与独立三维物理校验体系
- 新增 `lib/packing/public-benchmarks.ts` 与 `lib/packing/public-benchmarks.test.ts`：
  - 覆盖 Bischoff–Ratcliff 经典 ISO 20ft（`5870×2330×2200 mm`）BR1–BR7 弱/强异构 7 组标准案例、5 组极端几何压力案例及 25 组确定性种子随机混装案例（共 **37 组**）。
  - 独立三维物理校验器（零信任 AABB 碰撞、边界、底部承托防悬空、限载、数量与套装原子守恒）实测 **37 / 37 全部通过**（0 碰撞、0 越界、0 悬空、0 超载、0 守恒错误）。
  - **BR1–BR7 平均体积利用率：`88.51%`**（BR3 最高达 `91.74%`）；全量 37 组计算延迟：**P50 = `79.58 ms` · P95 = `408.96 ms` · P99 = `513.85 ms`**。

### 3. P1 工程热力图、多目标评分与装柜 ROI 实时联动
- 新增 `lib/packing/engineering-heatmaps.ts`：基于当前真实三维箱位与载荷实时计算四类工程热力图（累计上压、地板载荷 kg/m²、稳定性细长比、承托面积 %），缺抗压资料时明确标示「未核验」。
- 新增 `lib/packing/multi-objective-roi.ts`：5 维可调权重多目标评估器（硬性工程约束不可绕过，非法方案直接淘汰）+ 实时联动当前单柜实装量的装柜经济收益 ROI 计算器。
- 新增 `components/engineering-analytics-panel.tsx` 并接入步骤七「清单与导出 → 外贸实战增效工具箱」新标签页「热力图 · 多目标 & ROI」。

### 4. 版本对齐与完整研发台账
- 对齐 `ENGINE_VERSION`、`package.json` 与 `README.md` 版本为 `v1.1.0`，新增 [全量功能台账与 P0–P4 演进计划](COMPETITIVENESS_LEDGER_AND_PLAN.md)。
