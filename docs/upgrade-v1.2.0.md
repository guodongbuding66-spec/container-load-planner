# CargoFit v1.2.0 升级记录（P1/P2 深化推进）

发布日期：2026-11-27

## 本轮新增真实工程能力（零占位、零假数据）

1. **D03 深化 · 多箱套装 / SKU 联合反向尺寸优化引擎**（`lib/packing/kit-dimension-optimizer.ts`、`components/engineering-analytics-panel.tsx`）：
   - 针对 2–5 箱多箱套装与主力单品，在 `±5 / ±10 / -20 mm` 窗口内调用真实 `packLoadingWorkflow` 求解器逐候选计算单柜最大整套/整箱装量与利用率，彻底杜绝体积比例估猜。
   - 已接入步骤七「清单与导出 → 热力图 · 多目标 & ROI」底部，支持一键点击「搜索改箱增容方案」并查看完整候选收益对比表。
2. **D11 深化 · 订单数据健康体检与 7 类异常纠错引擎**（`lib/packing/order-data-auditor.ts`、`components/packing-app.tsx`）：
   - 实时检测 `mm / cm / inch` 单位混淆、长宽顺序异常、体积密度极端偏轻/偏重（防 `g/kg` 混淆）、重复 SKU、套装比例不整除尾箱、超柜体净空尺寸、总货重超单柜限载 7 类业务高发错误。
   - 已接入步骤三「录入货物」实时体检横幅，浅色/深色模式自适应。
3. **D20 深化 · 全局 `Ctrl+K` / `⌘K` 命令搜索面板**（`components/command-palette.tsx`、`components/packing-app.tsx`、`app/cargo-workbench.css`）：
   - 顶栏新增 `⌘K` 入口并监听全局 `Ctrl+K` / `⌘K` 快捷键，支持中英文模糊检索与纯键盘（`↑↓ / Enter / Esc`）执行步骤跳转、一键示例、主题切换、极简/专家模式切换、单位切换、空间库、方案工具与 JSON 导出。
4. **D22 基石 · 标准化 REST / SDK / MCP 装柜计算接口契约**（`lib/packing/api-contract.ts`）：
   - 提供确定性执行入口 `executeCargoFitApiV1`（`cargo-fit-api-v1.2`）与 `CARGOFIT_MCP_TOOL_DESCRIPTOR`，为后续 REST API、Python/JS SDK 及 AI Agent MCP 集成奠定强类型契约。
