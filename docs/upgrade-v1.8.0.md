# CargoFit v1.8.0 升级记录、测试与实机验收报告

发布日期：2026-11-28

## 一、本轮核心升级项（全部真实可运行、零占位、零假数据）

1. **D01 / D02 · 四计算模式混合求解器与 Pareto 前沿提取（`lib/packing/hybrid-solver.ts`）**
   - 实现 `fast`（极速 1–3s）、`standard`（标准 3–15s）、`deep`（深度 15–60s）、`extreme`（自定义时间预算）四档计算模式。
   - 在时间预算内执行双策略基准 + 确定性种子 LNS（大邻域重排：大体积/大底面积/重货优先/未装 SKU 优先/种子扰动），每组候选均经独立物理校验，自动输出 `maxQuantity`、`maxUtilization`、`mostBalanced` Pareto 前沿。
2. **D04 · 六级包装 BOM、自重占比与循环周转摊销引擎（`lib/packing/packaging-bom.ts`）**
   - 完整实现 `L1 产品单件 → L2 内包装 → L3 外包装纸箱 → L4 运输单元（托盘/循环周转 ÷N 次） → L5 集装箱与加固耗材 → L6 整单多柜含运费汇总`。
   - 实时计算包材自重占比（%）、单柜/单箱/单件包装成本与整单落地物流总成本，支持一键导出 CSV。
3. **D06 · 原生 ASCII DXF 二维截面解析与 3D 拉伸（`lib/packing/cad-mesh-import.ts`、`lib/packing/model-import.ts`、`components/solid-model-editor.tsx`）**
   - 新增 `parseDxfProfile`，原生解析 ASCII DXF 中的 `LWPOLYLINE` 与 `CIRCLE` 轮廓并拉伸为闭合水密 3D 三角网格，计算包围盒尺寸与精确体积，接入统一三维模型导入管线（`.glb/.gltf/.stl/.obj/.dxf`）。
4. **D10 · 3D 残余空隙 SKU 智能补货推荐引擎（`lib/packing/catalog-gap-recommender.ts`）**
   - 直接读取 `analyzeEmptySpaces` 拆分出的真实互不重叠 3D 残余空隙长方体，结合剩余载重裕量与允许朝向执行精确几何适配，杜绝按剩余总 CBM 比例估猜补货量。
5. **D12 · 100% 确定性引擎驱动的离线智能装柜诊断助手（`lib/packing/copilot-assistant.ts`）**
   - 支持中英文自然语言查询 6 类高频工程意图（未装原因诊断、需柜数与 ROI、纸箱改箱增容、轴荷/BCT 压溃/LIFO/充气袋四维安全体检、双策略对比、3D 空隙补货推荐）。
   - 所有数字均由确定性求解与物理校验引擎实时算得并注明出处模块，零大模型臆造坐标或装量。
6. **D22 · API v1.8 契约升级与可运行 MCP Stdio Server（`lib/packing/api-contract.ts`、`scripts/cargofit-mcp-server.ts`）**
   - 升级 `executeCargoFitApiV1` 至 `cargo-fit-api-v1.8`（向后兼容 `cargo-fit-api-v1.2`），支持传入 `computeMode`、`seed` 与 `includeEngineeringAudit`。
   - 新增 `npm run build:mcp` 打包生成 `server-build/cargofit-mcp.mjs`，可直接作为标准 JSON-RPC 2.0 MCP Stdio Server 供外部 AI Agent 与 ERP/WMS 调用。

## 二、自动化与真实浏览器验收记录

| 验收项目 | 执行命令 / 环境 | 实测结果 |
| :--- | :--- | :--- |
| TypeScript 严格检查 | `npm run typecheck` (Node v22.14.0) | **通过（0 errors）** |
| ESLint 代码规范 | `npx eslint` 全部新增与修改模块 | **通过（0 errors）** |
| 全量 Vitest 单元测试 | `npx vitest run --config vitest.config.ts` | **227/227 文件，2,496/2,496 项通过** |
| 公开学术与压力基准 | `public-benchmarks.test.ts` (BR1–BR7 + 极端 + 随机) | **37/37 通过，0 物理违规，BR 均值 88.51%，P50=94.44ms / P95=447.16ms / P99=728.53ms** |
| HTML 结构与渲染回归 | `node --test tests/rendered-html.test.mjs` | **21/21 通过** |
| MCP Server 协议实测 | `npm run build:mcp` + `initialize` / `tools/list` | **通过（返回 `cargofit-mcp-server@1.8.0` 及完整 Schema）** |
| 生产静态构建 | `CF_PAGES=1 npx next build --webpack` | **通过（6/6 静态路由导出）** |
| 真实浏览器端到端验收 | **Mozilla Firefox 153.8.0esr**（桌面 1440×900 + 移动 390×844） | **0 页面错误，0px 水平溢出**，浅/深色模式、现场执行预设、步骤 7 四大新面板与 `/crew` 全部实测通过 |

## 三、真实浏览器测试发现并主动修复的缺陷记录

1. **缺陷 #1（混合求解器打托模式崩溃）**：首次在真实 Firefox 中点击「现场执行 → 热力图 · 多目标 & ROI → 启动混合搜索」时，捕获到页面错误 `Error: 打托配置无效`。
   - **根因**：默认方案处于 `palletized`（先打托再装柜）模式，UI 调用 `runHybridPackingOptimizer` 时未透传 `plan.palletBuild` / `plan.floorPallets` / `plan.loadingRules` / `plan.delivery`。
   - **修复**：在 `components/engineering-analytics-panel.tsx` 完整透传 `plan` 上下文，并在 `lib/packing/hybrid-solver.ts` 增加缺失 `palletBuild` 时的安全降级保护。重新构建并在 Firefox 复测后 `page_errors: []`，候选方案表正常渲染。
2. **缺陷 #2（MCP Server 直接 ESM 解析路径）**：直接以 Node 原生运行 `.mjs` 时因内部 TypeScript 导入省略 `.ts` 扩展名导致 `ERR_MODULE_NOT_FOUND`。
   - **修复**：改为 `scripts/cargofit-mcp-server.ts` 并新增 `npm run build:mcp`（`esbuild --bundle --packages=external`）输出 `server-build/cargofit-mcp.mjs`，实测 `initialize` 与 `tools/list` 响应正常。

## 四、实机验收截图归档

- `docs/field-upgrades/evidence/v1.8.0-desktop-app.png`（桌面端主工作台）
- `docs/field-upgrades/evidence/v1.8.0-desktop-analytics.png`（步骤 7 浅色模式实测）
- `docs/field-upgrades/evidence/v1.8.0-desktop-dark.png`（步骤 7 深色模式实测）
- `docs/field-upgrades/evidence/v1.8.0-desktop-crew.png`（`/crew` 仓库现场端）
- `docs/field-upgrades/evidence/v1.8.0-mobile-app.png`（390×844 移动端窄屏适配）
