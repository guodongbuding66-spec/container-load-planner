# CargoFit 真实浏览器 Bug 发现、修复与回归台账

本台账严格记录真实浏览器测试中发现的所有缺陷，包含**复现路径、原始输入、预期结果、实际结果、修复位置、回归测试映射与截图证据**，确保每项 Bug 修复后自动进入自动化回归保护，防止下一版本复发。

| Bug ID | 严重级别 | 复现路径与原始输入 | 预期结果 | 实际结果（修复前） | 修复位置与版本 | 自动化回归用例 | 截图证据 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | 阻断级 | 切换「极简 3 步」模式（1 选柜型 → 2 录货 → 3 看方案），步骤 1 点击底部「下一步」 | 正常推进至货物录入步骤 | 按钮文案仍为「下一步·选包装」，点击弹出「请按顺序完成当前步骤」卡死在步骤 1 | `components/packing-app.tsx`、`components/workflow-steps.tsx`（v1.7.x 修复，v2.1 锁定） | `tests/e2e/cargofit-regression.spec.ts` (`BUG-001`) | `docs/field-upgrades/evidence/v2.0.0-desktop-five-pillars.png` |
| **BUG-002** | 高优先级 | 步骤 7 开启深色模式，查看 4 张 KPI 卡片、策略栏与三视图 | 深色背景下浅色高对比度数字（`#F3F4F6` / `#161B22`） | 黑色字体配深灰底几乎不可见，部分面板反白 | `app/cargo-workbench.css`（v1.7.x 修复，v2.1 锁定） | `tests/e2e/cargofit-regression.spec.ts` (`BUG-002`) | 同上 |
| **BUG-003** | 高优先级 | WebGL 降级模式下查看步骤 1 40HQ 及托盘标尺预览 | 标尺仅绘制有效中间刻度 | 短边出现孤立 `0` 刻度与 `10000/0/0` 错标 | `lib/packing/scene-dimensions.ts`、`qa-round8-fixes.test.ts` | Vitest `qa-round8-fixes.test.ts` | 已通过单测与实机验证 |
| **BUG-004** | 高优先级 | 顶部切换全局单位制 `mm/kg` → `cm/kg` / `in/lb`，查看步骤 1 柜体尺寸输入框 | 柜体长宽高、门洞、载重及摘要实时换算 | 数值锁死 `12032×2350×2700 mm` 无变化 | `components/packing-app.tsx` | `tests/e2e/cargofit-regression.spec.ts` (`BUG-004`) | 已通过实机验证 |
| **BUG-005** | 中优先级 | 移动端 `390×844` 与 `320px` 视口打开 `/app` | 顶栏单行折叠加抽屉菜单，水平溢出 `0px` | 顶栏折成 4–6 行占近半屏，底栏遮挡卡片 | `components/packing-app.tsx`、`app/cargo-workbench.css` | `playwright.config.ts` (`firefox-mobile-390`) | `v2.1.0-mobile-390.png` |
| **BUG-006** | 中优先级 | 计算进入步骤 7 后，点击步骤条回看步骤 2 | 步骤 3–7 保持已解锁状态可直接跳回 | 步骤 3–7 重新置灰禁用，需连点 5 次下一步 | `components/packing-app.tsx`（`maxUnlockedStep`） | `tests/e2e/cargofit-regression.spec.ts` (`BUG-006`) | 已通过实机验证 |
| **BUG-007** | 细节优化 | 检查首屏按钮过渡动效、弹窗 `role="dialog"` 与 `/sitemap.xml` | 统一 `0.14s` 过渡、弹窗完整 ARIA、`/sitemap.xml` 返回 200 | 16 个按钮 `transition-duration: 0s`、`/sitemap.xml` 404 | `app/cargo-workbench.css`、`public/sitemap.xml`、`components/feature-dialog.tsx` | `tests/rendered-html.test.mjs` | 已通过 21/21 校验 |
| **BUG-008** | 高优先级 | 托盘化模式下进入步骤 7，点击「运行混合多算法增强」 | 正常返回增强方案对比与 Oracle 校验结果 | Firefox 实机点击触发 `Error: 打托配置无效` 异常 | `components/engineering-analytics-panel.tsx`、`lib/packing/hybrid-solver.ts`（v1.8/v2.0 修复） | `tests/e2e/cargofit-regression.spec.ts` (`BUG-008`) + `v20-five-pillars.test.ts` | `docs/field-upgrades/evidence/v2.0.0-desktop-five-pillars.png` |
| **BUG-009** | 阻断级 (P0) | 多 SKU 订单以 `standard` 模式（3000ms 预算）调用 `runHybridPackingOptimizer` | Beam/Exact/LNS 后正常进入 BRKGA 遗传进化（`brkgaGenerations >= 1`） | 前置阶段耗尽全部 3000ms 预算导致 BRKGA 饿死（`brkgaGenerations === 0`），`v20-five-pillars.test.ts` Pillar 1A 失败 | `lib/packing/hybrid-solver.ts`（v3.1.0 修复：为 BRKGA+SA 预留 40% 预算并设 G0 82% 上限） | `lib/packing/v20-five-pillars.test.ts` (`Pillar 1A`) | 单测实跑通过（6/6） |
| **BUG-010** | 中优先级 (P2) | 打开步骤 7 工程分析面板与 v3 工业套件检查标题文案 | 专业工业 SaaS 标题，无内部研发代号与路线编号 | 可见标题包含 `(D07)`–`(D23)` 研发代号及 `01.`–`24.` 路线编号前缀 | `components/engineering-analytics-panel.tsx`, `v3-visual-suites.tsx`, `v3-ops-enterprise-suites.tsx`, `v21-engineering-suites.tsx`（v3.1.0 修复） | React SSR 零泄露断言 | SSR 验证 0 泄露 |
| **BUG-011** | 中优先级 (P2) | 切换英文界面（EN）查看行业级测试体系 12 项记分卡与样本库分类 | 全英文指标标签与分类名称 | 记分卡摘要与样本库分类保留中文硬编码 | `components/v21-engineering-suites.tsx`（v3.1.0 修复） | React SSR EN 渲染验证 | SSR EN 验证通过 |
| **BUG-012** | 质量强化 (P0) | 运行 `independent-test-corpus.ts` 大规模样本库压力测试 | 公共标准池覆盖 BR1–BR7 全类，且套装/托盘/工程约束包含高满载溢出压力 | `public-standard` 仅循环 6 个基础学术例，套装/托盘均值利用率仅 8–10% | `lib/packing/independent-test-corpus.ts`（v3.1.0 升级） | 1,300 例高满载压力测试 | 1,300/1,300 零违规 |
