# CargoFit 装柜智算：24 项升级方向与历史未完成项目全量功能台账（v3.1.0）

> 本文档按「真实源码核查 + 严禁虚假宣称 + 明确外部阻塞」原则编制，统一覆盖《竞争力评估与 24 项升级路线》全部 24 项核心方向（`D01`–`D24`）及原未完成台账（`U01`–`U24`、`A1`–`A5`）。

## 一、版本标识与验证基线（v3.1.0）

- `lib/packing/engine.ts` (`ENGINE_VERSION`): **`3.1.0`**
- `package.json` (`version`): **`3.1.0`**
- `lib/packing/api-contract.ts` (`API_SCHEMA_VERSION`): **`cargo-fit-api-v3.1`**（向后兼容 `cargo-fit-api-v1.8`、`cargo-fit-api-v1.2`）
- 线上与仓库同步核查（2026-11-28）：
  - GitHub `main` 最新提交为 `36d3867`（2026-11-28T01:38:40Z），滞后于本地 `v3.1.0` 完整源码。
  - Cloudflare Pages (`https://container-load-planner.pages.dev/`) 与 Vercel (`https://container-load-planner-gray.vercel.app/`) 当前尚未同步 `v3.1.0`（且双站标题存在差异），需由持有仓库写权限的环境推送后触发双站同步构建。
- 本轮自动化验证基线（2026-11-28 实测）：
  - **TypeScript (`tsc --noEmit`)**: **0 errors**
  - **ESLint（全部改动与核心 v3.1 模块）**: **0 errors / 0 warnings**
  - **MCP Stdio Server (`npm run build:mcp`)**: 构建通过（`server-build/cargofit-mcp.mjs`, 657.6 KB）
  - **静态页面与结构校验 (`tests/rendered-html.test.mjs`)**: **21/21 通过**
  - **核心算法与 24 方向专项测试集**: `v30-all-24-directions.test.ts` (6/6)、`v22-24-directions.test.ts` (6/6)、`v21-industry-upgrade.test.ts` (8/8)、`v20-five-pillars.test.ts` (6/6)、`public-benchmarks.test.ts` (1/1, 含 37 场景)、`engineering-heatmaps-and-roi.test.ts` (3/3) **全部通过**
  - **公开学术基准（BR1–BR7 + 五大学术家族）**:
    - `BR1–BR7` 平均空间利用率 **88.51%**（BR3 达 **91.74%**），**37/37 零违规**；
    - 五大学术家族（Bischoff-Ratcliff 94.62%、OR-Library 92.92%、ESICUP、Q4RealBPP、PackingSolver）**6/6 零违规**；
    - `v2.0` 112 例综合基准 **112/112 通过（0 物理违规，BR 均值 88.51%，P50=84.78ms）**。
  - **独立样本库大规模压力测试 (`independent-test-corpus.ts`)**:
    - 1,000 例标准混合批次：**1,000/1,000 通过，0 物理违规**（P50=41.2ms / P95=241.4ms / P99=318.7ms）；
    - 300 例高满载/溢出压力批次（含 BR1–BR7 公共池与 50% 高满载套装/托盘/工程约束）：**300/300 通过，0 物理违规**（P50=127.07ms / P95=989.06ms / P99=1462.56ms）。
  - **React SSR 组件与国际化验证**: `V21EngineeringSuites`（ZH/EN）、`V3OpsEnterpriseSuites`（EN/developer）、`CrewPage` 全部零异常渲染，**0 处内部研发代号泄露**，**0 处编号前缀残留**。

## 二、24 项核心升级方向全量状态台账（D01–D24）

状态定义：`DONE` 软件核心能力已完整实现并通过实测验证；`PARTIAL` 核心软件能力已落地，高阶物理/外部资料待深化；`BLOCKED` 受限于外部硬件/工厂实测/商业授权/正式云凭据，严禁以假数据或模拟结果冒充完成。

| 编号 | 升级方向 | 优先级 | 当前状态 | 核心代码模块 | 明确缺口 / 外部阻塞 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| D01 | 装柜算法全面升级与公开基准 | P0 | **DONE（软件基石）** | `engine.ts`, `hybrid-solver.ts`（6 节点特征调度 + Beam Search + 小规模精确分支定界 + BRKGA 预算预留修复 + SA + LNS + 异步暂停/继续）, `academic-benchmarks.ts`, `public-benchmarks.ts`, `independent-test-corpus.ts` | 10,000 例离线集群全量跑分与商业竞品正版授权同单实测待外部资源 |
| D02 | 真正的多目标装载优化 | P0 | **DONE** | `multi-objective-roi.ts`, `hybrid-solver.ts`（Pareto 前沿：最大数量/最高利用/最平衡/最稳定）, `v3-visual-suites.tsx`（6 色滑块 + 分段比例条 + 偏好保存 + 硬约束不可绕过） | 无软件缺口 |
| D03 | 反向优化产品与包装尺寸 | P1 | **DONE** | `reverse-packaging-optimizer.ts`, `kit-dimension-optimizer.ts`, `trade-optimizers.ts` | 全部基于真实求解器逐候选计算，零体积比例估猜 |
| D04 | 多级包装优化（Level 1–6） | P1 | **DONE（软件核心）** | `packaging-bom.ts`, `packaging.ts`, `pallet-specifications.ts`, `v3-visual-suites.tsx`（6 级层级图与皮重占比） | 多仓库循环周转资产回收调度属企业 ERP/WMS 联调扩展 |
| D05 | 真正的异形货物装载引擎 | P1 | **PARTIAL** | `irregular-nesting-engine.ts`（10 类策略注册表、圆柱六角密排、圆锥套叠、L/U/T 180° 互锁、板材型材错位、柔性压缩、3D OBB/BVH SAT 零碰撞校验）, `cargo-shape.ts`, `solid-model.ts` | 通用非凸网格精确嵌套与真实材料非线性变形依赖实测模型（界面已显式区分三级能力边界） |
| D06 | CAD / 3D 模型及工程文件兼容 | P1 | **DONE（多格式）** | `cad-mesh-import.ts`（GLB/glTF、OBJ、Binary/ASCII STL、ASCII FBX/二进制检测、DXF 拉伸 + 轴心/减面/重心/6 面承托/凹腔预处理）, `cad-step-iges-bridge.ts`（STEP/IGES 包络 + 3ds Max `.ms` 桥接脚本） | 完整 B-Rep STEP/IGES 曲面解析内核与 3ds Max 原生 C++ 插件待后续扩展 |
| D07 | 智能托盘与木箱设计系统 | P1 | **DONE（软件核心）** | `smart-pallet-designer.ts`（多 SKU 经济托盘选型 + 8 零件木箱结构 BOM）, `palletize.ts`, `pallet-repack.ts`, `pallet-consolidation.ts`, `v3-visual-suites.tsx`（2D 俯视码垛 SVG） | 木箱实际静载/动载/货架载荷认证须以工厂铭牌与第三方测试报告为准 |
| D08 | 包装结构承重与稳定性分析 | P1 | **PARTIAL** | `bct-estimator.ts`, `bearing.ts`, `crate-bearing.ts`, `engineering-heatmaps.ts`（2×2 四类热力图：上压/地板/稳定性/承托面积） | 缺少纸箱厂实验室实测 ECT/BCT 曲线时界面显式标注「未核验」（外部数据阻塞） |
| D09 | 多柜全局联合优化 | P1 | **DONE（有界全局）** | `global-fleet-optimizer.ts`（`optimizeGlobalFleetWithLocks` 含已装柜锁定保护）, `fleet.ts`, `fleet-optimization.ts`, `fleet-tail.ts`, `v3-visual-suites.tsx`（优化前后对比） | 超大规模（>64 组合）全网联运排期属 P4 扩展 |
| D10 | 智能空隙利用与补货推荐 | P2 | **DONE** | `free-space.ts`, `fleet-gap-fill.ts`, `pallet-refill.ts`, `catalog-gap-recommender.ts` | 全链路基于真实 3D 残余空隙长方体与载重上限，严禁按剩余总 CBM 估猜 |
| D11 | 订单智能导入与数据纠错 | P2 | **DONE（结构化）** | `csv.ts`, `spreadsheet.ts`, `smart-import.ts`, `order-data-auditor.ts`（7 类高发异常自动体检） | 扫描件 PDF / 纸质照片 OCR 需对接外部商用 OCR 服务 |
| D12 | AI 智能装柜助手 | P2 | **DONE（确定性引擎版）** | `copilot-assistant.ts`（自然语言意图识别 + 100% 确定性装载与校验引擎计算，零 LLM 坐标臆造） | 开放式多轮对话需按需接入外部 LLM API 网关 |
| D13 | 更全面的装载空间库 | P4 | **PARTIAL** | `transport-library.ts`（3×3 九宫格含海运干柜/开顶/框架/冷柜/阶梯车/航空 LD3 AKE 45° 双阶梯切角/铁路棚车/笼车/散杂货船舱）, `presets.ts` | 航空全系列 ULD 异形轮廓与散杂货船舱压载稳性属 P4 专业模块 |
| D14 | 车辆轴荷与动态配重 | P1 | **PARTIAL** | `axle-load-estimator.ts`（三轴半挂车力学平衡 + 分段卸货演进）, `vehicle-engineering.ts`, `vgm-cog.ts`, `v3-ops-enterprise-suites.tsx`（侧视剖面 SVG） | 各国道路法规轴限校核与实车皮重/轴距铭牌属外部资料阻塞 |
| D15 | 多目的地装载与卸货顺序 | P1 | **DONE（核心）** | `multi-stop-auditor.ts`（3D LIFO 阻挡检测 + 逐站 CoG 偏移 + 卸货后残余承托稳定性）, `v3-ops-enterprise-suites.tsx`（实时数据驱动多站 SVG） | 卸货途中临时支撑人工操作策略待现场样本验证 |
| D16 | 运输安全与货物固定系统 | P1 | **PARTIAL** | `securing-void-analyzer.ts`（CTU Code 绑带/气袋/木方斜撑/挡杆/防滑垫/护角/隔板/干燥剂全套清单）, `container-accessories.ts` | 绑带额定破断力（LC）与实际摩擦系数需实测耗材资料 |
| D17 | 危险品、易碎品与特殊货物 | P2 | **PARTIAL** | `special-cargo-rules.ts`（8 类特殊货物规则 + IMDG 7.2.4 隔离矩阵）, `trade-advisory.ts`, `trade-compliance.ts` | 正式危险品海运出运须对接权威可更新 IMDG 法规库并由合规专员审核 |
| D18 | 仓库装柜现场移动端 | P2 | **PARTIAL** | `app/crew/page.tsx`（四账对账 + 扫码防超扫 + 100×150mm 热敏标签预览打印 + 异常拍照）, `crew-scanner.ts`, `field-calibration.ts` | 实机蓝牙扫码枪、热敏打印机与云端多端实时同步属真机阻塞（U15） |
| D19 | 3D 可视化与建模体验升级 | P2 | **PARTIAL** | `container-scene.tsx`, `scene-workbench.tsx`, `plan-comparator.ts` | 真实物理 GPU WebGL 帧率、高并发大模型渲染与真机触控手势验收属硬件阻塞（U01） |
| D20 | UI/UX 专业化重构 | P2 | **DONE（核心）** | `packing-app.tsx`, `command-palette.tsx`（Ctrl+K）, `v21-engineering-suites.tsx`（3×2 六大角色工作台矩阵）, 本轮已清除所有可见内部研发代号并补齐双语切换 | 需在 Node ≥22 本地/CI 环境中执行 Playwright 全浏览器视觉回归 |
| D21 | 企业级数据管理与商业化 | P3 | **BLOCKED（生产配置）** | `enterprise-governance.ts`（审批流/不可变审计日志/版本对比/4 级方案）, `cloud-account.tsx`, `cloud-membership.tsx`, `cloud-org-workspace.tsx`, `db/`, `api/` | 正式 PostgreSQL、SMTP 发信、Stripe 商户与 SSO 生产凭据属外部阻塞（A1–A5） |
| D22 | API、SDK、MCP 与外部集成 | P3 | **DONE（首阶段）** | `api-contract.ts`（`cargo-fit-api-v3.1` 兼容 v1.8/v1.2）, `lib/sdk/cargofit-sdk.ts`, `scripts/cargofit-mcp-server.ts`（657.6KB 可执行 MCP Server）, `v3-ops-enterprise-suites.tsx`（4 层集成架构与在线演练） | 托管 REST 网关与独立 npm/PyPI 发包随生产环境推进 |
| D23 | 历史数据与持续自我校准 | P2 | **PARTIAL** | `field-calibration.ts`, `field-records.ts`, `quality-history.ts`, `v3-ops-enterprise-suites.tsx`（5 节点校准闭环飞轮 SVG） | 独立 ≥100 组真实工厂实装样本（校准集与验收集严格隔离）属外部工厂数据阻塞 |
| D24 | 智能物流成本与 ROI 分析 | P1 | **DONE** | `multi-objective-roi.ts`, `landed-cost.ts`, `packaging-bom.ts`, `v3-ops-enterprise-suites.tsx`（实时联动装量与运费 ROI 计算器） | 无软件缺口 |

## 三、历史未完成项目（U01–U24 / A1–A5）与外部阻塞汇总

- **已按用户要求移出范围（EXCLUDED）**：`U03`（具体叉具接口与进出预检）、`U05`（具体设备搬运与转向模拟）。
- **明确外部/环境阻塞项（严禁虚假宣称完成）**：
  1. **U01 真实物理 GPU、多浏览器与真机移动设备验收**：当前沙箱无独立物理显卡，且系统 Node 为 `v18.20.4`（Next 16 / Vitest 4 要求 Node `>=22.13.0`）、容器 Chromium 受企业策略限制拦截本地 HTTP/`file://` 导航。完整的 `npm run build:pages`、240 文件 Vitest 全跑与 Playwright 真实浏览器多视口截图验收须在 Node ≥22 环境执行。
  2. **U08 / U12 / U13 / U16 / U24 额定结构与实验室抗压资料**：纸箱空箱抗压仪（BCT/ECT）实测曲线、木箱静/动载认证、实车轴距/皮重铭牌、固缚耗材额定破断力及非凸柔性材料实测数据，软件在缺失数据时统一显式标注「未核验」。
  3. **U15 / U21 / U23 实机外设与独立工厂样本**：真实蓝牙扫码枪、热敏打印机、电子地磅接口以及 ≥100 组含原始箱规与现场照片的独立工厂实装样本。
  4. **商业竞品同单实测**：EasyCargo / Goodloading / CargoWiz / Cargo-Planner / Cape Pack 同输入同预算对照需正版商业授权账号。
  5. **A1–A5 托管云生产配置与 GitHub / 双站同步部署**：当前沙箱无 GitHub 写权限 Token 及 Cloudflare Pages / Vercel / PostgreSQL / Stripe 生产凭据，已交付完整验证源码包 `container-load-planner-v3.1.0.zip`，推送至 `main` 即可触发双站自动部署。
