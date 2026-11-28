# CargoFit 装柜智算 v3.2.0 深度闭环升级与配图目标全量验收说明

**发布版本**：`v3.2.0`（`ENGINE_VERSION = "3.2.0"`，`API_SCHEMA_VERSION = "cargo-fit-api-v3.2"`，向后兼容 `v3.1` / `v1.8` / `v1.2`）  
**升级依据**：逐项对照 [ChatGPT 分享文档：CargoFit 竞争力评估、24 项升级方向与 26 组配图/原型目标](https://chatgpt.com/s/t_6b0a63b695748191b530836564ab117c) 对 `v3.1.0` 代码库执行逐文件深度审计，彻底消除重复堆砌、只读展示断链与硬编码占位，完成全链路闭环升级。

## 一、v3.1.0 → v3.2.0 实质性深度升级清单

1. **消除 8 组重复面板并贯通六大角色工作台复杂度隔离（D20 + 配图 #21）**
   - 将六大角色工作台（快速测算 / 专业装柜 / 包装工程 / 现场执行 / 企业管理 / 开发者中心）提升至 `EngineeringAnalyticsPanel` 顶层作为全局唯一控制中枢，支持 `localStorage` 记忆岗位视角。
   - 清除旧版 `engineering-analytics-panel.tsx` 中与 `V3VisualSuites` / `V3OpsEnterpriseSuites` 重复的 8 组旧卡片（旧热力图、旧权重、旧 ROI、旧轴荷、旧固缚、旧混合求解、旧异形、旧多柜），实现零重复渲染。
2. **打通主工作台全链路闭环操作（看得到 → 一键用得到）**
   - `packing-app.tsx` → `trade-pro-workbench.tsx` → `engineering-analytics-panel.tsx` → `v21-engineering-suites.tsx` → `v3-visual-suites.tsx` / `v3-ops-enterprise-suites.tsx` 全面接通 `onAdoptPlan`、`onApplyQuantities`、`onReplaceProducts`、`onSelectContainerPreset`：
     - **D01 下一代混合求解器**：Pareto 前沿三解（最大数量 / 最高利用率 / 最稳重心）均提供「采用到 3D 视图」一键写回主视图；
     - **D03 多轴反向包装优化**：支持自由选择目标 SKU，候选改箱方案提供「采用箱规」一键更新订单尺寸；
     - **D06 CAD / 3D 模型预处理**：上传 OBJ/STL/FBX/STEP/IGES/DXF 或示例件后提供「一键导入为新货物行」直接写入订单；
     - **D10 3D 残余空隙补货**：提供「一键补货」按钮直接增量应用到订单行数量；
     - **D11 订单数据智能体检与安全纠错**：新增 `autoFixOrderInputs`（`cm→mm` ×10 换算、宽>长自动互换并输出明文变更清单），顶部体检横幅提供「一键安全修正」；
     - **D13 3×3 装载空间库**：9 类海陆空/仓配载具卡片升级为真实可点击按钮，一键切换当前装载空间及内置真实障碍/切角边界。
3. **100% 真实数据驱动，彻底清除硬编码假数据**
   - **D05 异形货物引擎**：替换全部写死示例尺寸，新增可编辑参数输入（圆筒直径/长度/单重/轴向、圆锥/花盆上下径与步距、U/T 型外廓与壁厚、板材/围栏长宽厚与搭接、柔性压缩率）、「同步首项 SKU 尺寸」按钮与实时 2D 六角密排截面图。
   - **D07 智能托盘 2D 码垛俯视图**：`smart-pallet-designer.ts` 升级返回真实 `layerLayout`（`x, y, dx, dy, rotated`）零重叠坐标，SVG 按真实比例绘制 Block / Brick 砖式交错 / Pinwheel 风车型锁边 / Interlocking 排布，并支持 5 种国际标准托盘（EUR1/EUR2/GMA/Asia/ISO）一键切换对比。
   - **D09 多柜锁定保护**：改用当前方案真实单柜实装 SKU 数量扣减已装锁定柜，移除旧版写死 `Math.min(5, ...)`。
   - **D12 CargoFit AI Copilot（配图 #14）**：补齐第 4 个经典快捷意图 `reduce-pallets`（「保持原订单数量，尽可能减少托盘。」），全部 4 个 `↗` 快捷提问均由确定性引擎实时算得。
   - **D14 三轴半挂车侧视剖面 SVG（配图 #16）**：移除写死 2×5 装饰色块，改为真实投影 `result.placements` 剩余未卸货箱坐标，切换分段卸货阶段时尾部货箱实时消失、红色十字准星「货物重心」与三轴利用率同步联动。
4. **补齐全部平台与测试体系配图目标**
   - 新增 **配图 #26 CargoFit 八大模块化平台架构蓝图**（企业管理/专业装柜视图）；
   - 新增 **配图 #2 CargoFit 12 项综合能力 5 格分段成熟度评分卡**（企业管理视图，诚实标注外部边界）；
   - 升级 **配图 #25 10,000+ 独立测试样本库横向蓝色进度分布条 + 2×5 Playwright 真实浏览器自动化验收覆盖清单**（开发者中心/专业装柜视图）。

## 二、本轮实测验证结果与诚实边界

| 检查项 | 实测结果 | 说明 |
| :--- | :--- | :--- |
| TypeScript (`tsc --noEmit`) | **PASS (0 errors)** | 全仓库严格类型检查 |
| ESLint（全部改动模块） | **PASS (0 errors)** | 零错误 |
| `v3.2.0` 闭环与真实数据专项验证 | **PASS (6/6)** | API v3.2 兼容 v3.1/v1.8、5 种托盘 `layerLayout` 0 重叠、Copilot `reduce-pallets`、单据安全自动纠错 |
| 独立 6 类样本库实跑 | **PASS (60/60, 0 物理违规)** | `P50=77.35ms / P95=644.41ms` |
| React 19 SSR 6 角色 × 中英文验证 | **PASS (12/12)** | 0 运行时异常、0 内部代号泄露、0 重复面板 |
| MCP Server (`npm run build:mcp`) | **PASS (657.7 KB)** | `server-build/cargofit-mcp.mjs` |
| 静态 HTML 结构测试 (`tests/rendered-html.test.mjs`) | **PASS (21/21)** | 全通过 |
| 完整 Vitest 全跑 / `next build` / Playwright 真机多视口截图 / 物理 GPU / 双站同步推送 | **PENDING（外部环境阻塞）** | 当前沙箱为 Node `v18.20.4`（需 `>=22.13.0`）、无独立物理 GPU、无 GitHub/Cloudflare/Vercel 写凭据；真实硬件/工厂实测/托管云凭据项继续诚实保留 `PENDING/BLOCKED` |
