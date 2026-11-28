# CargoFit 装柜智算 v3.1.0 升级与质量验收说明

**发布版本**：`v3.1.0`（`ENGINE_VERSION = "3.1.0"`，`API_SCHEMA_VERSION = "cargo-fit-api-v3.1"`）  
**升级日期**：2026-11-28  

## 一、本轮核心缺陷修复与技术升级

1. **修复混合求解器 BRKGA 预算饿死缺陷（P0 · `BUG-009`）**
   - **根因**：`lib/packing/hybrid-solver.ts` 在 v3.0.0 新增 Beam Search 与小规模精确分支定界后，高复杂度多 SKU 订单在 `standard`（3000ms）预算下被前置阶段耗尽时间，导致 BRKGA 遗传进化阶段 `brkgaGenerations === 0` 未执行。
   - **修复**：对多 SKU 启用 BRKGA 时为遗传进化与模拟退火预留 40% 时间预算（前置阶段上限 `budgetMs * 0.60`），并将 BRKGA G0 初始种群采样限制在 `budgetMs * 0.82` 内，确保多代演化稳定执行。
   - **验证**：`lib/packing/v20-five-pillars.test.ts` Pillar 1A 与 112 例综合基准（`zeroViolations=true`, `BR_mean=88.51%`, `P50=84.78ms`）全部通过。

2. **升级独立测试样本库覆盖 BR1–BR7 与高满载溢出压力（P0 · `BUG-012`）**
   - **升级**：`lib/packing/independent-test-corpus.ts` 的 `public-standard` 池整合五大学术家族与 `buildPublicBenchmarkSuite` 全部 BR1–BR7 异构基准；在 `unpack-kit`、`pallet-crate` 与 `engineering-irregular` 三类样本中引入 50% 高满载/溢出压力订单（验证容量上限与整套原子回滚）。
   - **验证**：累计执行 1,000 例标准样本 + 300 例高满载压力样本共 **1,300/1,300 全部通过，0 物理违规**（0 重叠、0 越界、0 悬空、0 数量守恒错、0 超重）。

3. **工业 SaaS 界面去研发代号化与双语完善（P2 · `BUG-010` / `BUG-011`）**
   - 清除 `components/engineering-analytics-panel.tsx` 中暴露给终端用户的 `(D07)`–`(D23)` 内部研发代号。
   - 清除 `components/v3-visual-suites.tsx`、`components/v3-ops-enterprise-suites.tsx`、`components/v21-engineering-suites.tsx` 标题中的路线编号前缀（`01.`–`24.`）。
   - 补齐 `components/v21-engineering-suites.tsx` 中 12 项硬性验收记分卡与独立样本库分类名称的英文双语切换。
   - React SSR 全链路验证确认 **0 处内部代号泄露、0 处运行时异常**。

4. **API 契约与文档体系全面同步（P3）**
   - `lib/packing/api-contract.ts` 升级至 `cargo-fit-api-v3.1`，同时在 `LEGACY_API_SCHEMA_VERSIONS` 保持对 `cargo-fit-api-v1.8` 与 `cargo-fit-api-v1.2` 的 100% 向后兼容。
   - 同步更新 `docs/COMPETITIVENESS_LEDGER_AND_PLAN.md`、`docs/qa/bug-regression-ledger.md`、`docs/USER_GUIDE_v3.1.md` 及 `server-build/cargofit-mcp.mjs`。

## 二、验证结果与诚实边界声明

| 检查项 | 结果 | 说明 |
| :--- | :--- | :--- |
| TypeScript (`tsc --noEmit`) | **PASS (0 errors)** | 全仓库严格类型检查 |
| ESLint（全部修改模块） | **PASS (0 errors / 0 warnings)** | 无规范告警 |
| MCP Server (`npm run build:mcp`) | **PASS (657.6 KB)** | `server-build/cargofit-mcp.mjs` |
| 静态 HTML 结构测试 (`tests/rendered-html.test.mjs`) | **PASS (21/21)** | 全通过 |
| 6 大核心算法与 24 方向单元测试集 | **PASS (100%)** | `v30`(6/6), `v22`(6/6), `v21`(8/8), `v20`(6/6), `public-benchmarks`(37/37), `heatmaps-roi`(3/3) |
| 独立样本库（1,000 标准 + 300 高满载） | **PASS (1,300/1,300)** | **0 物理违规**，BR1–BR7 均值 **88.51%** |
| React SSR 组件与 EN/ZH 渲染验证 | **PASS** | 0 异常，0 研发代号泄露 |
| 完整 240 文件 Vitest + `next build` + Playwright 真机 E2E | **PENDING（环境阻塞）** | 沙箱系统为 Node 18（需 Node ≥22.13.0）且无物理 GPU、Chromium 策略拦截本地 URL |
| GitHub 推送 & Cloudflare Pages / Vercel 双站同步 | **PENDING（凭据阻塞）** | 沙箱无写权限凭据，交付 `container-load-planner-v3.1.0.zip` 供本地同步发布 |

## 三、本地同步 GitHub 与双站部署步骤（Node ≥ 22 环境）

```bash
# 1. 解压覆盖至本地仓库并安装依赖
npm ci

# 2. 执行完整校验、构建与 Playwright 真实浏览器回归
npm run verify
npm run build:pages
npm run build:mcp
npx playwright test

# 3. 推送至 GitHub main 分支（自动触发 Cloudflare Pages 与 Vercel 双站同步）
git add -A
git commit -m "release: CargoFit v3.1.0 - BRKGA budget fix, high-fill corpus, bilingual SaaS polish & API v3.1"
git push origin main
```
