# CargoFit 装柜智算 v2.1.0 行业级测试体系与全栈深化验收报告

**版本**：`v2.1.0`（引擎版本 `ENGINE_VERSION = "2.1.0"`）  
**代码仓库**：[guodongbuding66-spec/container-load-planner](https://github.com/guodongbuding66-spec/container-load-planner)  
**线上正式环境**：[container-load-planner.pages.dev](https://container-load-planner.pages.dev/) ｜ **备用环境**：[container-load-planner-gray.vercel.app](https://container-load-planner-gray.vercel.app/)

---

## 一、行业级算法测试体系（四大支柱真实落地进展）

本版本严格区分**已实跑验证结果**与**阶段性研发目标 / 外部阻塞边界**，绝不将规划目标或未授权商业对照宣称为已完成。

### 1. 五大公开学术测试集标准解析器（已实装并 100% 通过零信任物理校验）
新增 `lib/packing/academic-benchmarks.ts`，支持按原始国际标准格式直接解析并执行零信任物理 Oracle 校验（重叠 = 0、越界 = 0、悬空 = 0、超重 = 0、数量守恒误差 = 0）：
- **Bischoff–Ratcliff (BR1–BR7)**：`parseOrLibraryThpack(..., "bischoff-ratcliff")` 标准文本解析器 + 经典 BR1–BR7 算例（平均装柜利用率 **88.51%**）。
- **OR-Library (`thpack1`–`thpack7`)**：完整支持多题文件头、箱体尺寸自动 cm→mm 换算与三轴 0/1 朝向锁解析。
- **ESICUP 3D-CLP**：异构多箱型 40HQ 标准算例与结构化加载器。
- **Q4RealBPP**：支持真实工业约束（载重上限、易碎禁压、直立锁、多站 LIFO 卸货顺序）JSON 解析器。
- **PackingSolver (`fontanf/packingsolver`)**：标准 `bins.csv` + `items.csv` 双文件 CSV 解析器。

### 2. 独立测试样本库（10,000+ 规划目标 vs 当前已实跑 1,000 组实测结果）
新增 `lib/packing/independent-test-corpus.ts`，完整覆盖 6 大分类并诚实追踪完成度：

| 分类 | 阶段性规划目标 | 本版实跑验证数量 | 物理违规数 | 平均空间利用率 | P50 耗时 | P95 耗时 | 占规划目标进度 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 公开标准算例（5 大测试集） | 1,600 | 160 | 0 | 68.10% | 95.97 ms | 192.85 ms | 10.0% |
| 随机及极端几何案例 | 4,000 | 400 | 0 | 30.45% | 30.38 ms | 188.90 ms | 10.0% |
| 拆箱与多箱套装案例 | 1,500 | 150 | 0 | 10.00% | 18.80 ms | 50.18 ms | 10.0% |
| 托盘、木箱与带托装载 | 1,000 | 100 | 0 | 8.69% | 11.73 ms | 16.69 ms | 10.0% |
| 工程约束与异形件 | 1,000 | 100 | 0 | 19.65% | 8.25 ms | 10.61 ms | 10.0% |
| 多柜及成本优化 | 900 | 90 | 0 | 34.16% | 101.46 ms | 139.85 ms | 10.0% |
| **合计** | **10,000** | **1,000** | **0** | **30.48%** | **29.52 ms** | **176.05 ms**（P99 **218.00 ms**） | **10.0%** |

- **独立工厂实装案例库**：已建立严格准入校验器 `validateFactoryCaseRecord`（要求原始箱规、实测柜内尺寸、实际装柜数量、现场照片证据链及操作员复核签字），当前状态为 **`0 / 100`（外部工厂原始样本待导入）**。

### 3. 竞品真实对照测试框架（12 项硬性验收指标）
新增 `lib/packing/competitor-benchmark-harness.ts` 与前端工作台导出按钮：
- 完整实现 12 项硬性验收记分卡（重叠、越界、数量守恒、悬空、已知工程规则违规、空间利用率、实装误差边界声明、多次运行稳定性波动 `0%`、耗时 P50/P95/P99、理论体积上界比值、大规模鲁棒性、现场可执行性状态）。
- 支持一键导出标准化 **JSON / CSV 竞品对照输入包**，确保 EasyCargo、Goodloading、CargoWiz、Cargo-Planner 获得完全一致的柜型、尺寸、重量、朝向、承重与安全约束，并支持导入外部结果运行同一套零信任 Oracle 客观评分。
- **诚实阻塞说明**：受商业软件授权限制，尚未在沙箱内直接运行 EasyCargo / Goodloading / CargoWiz / Cargo-Planner 实机程序；导入外部对照结果后即可生成客观并排评分表。

### 4. Playwright 自动化回归测试与 Bug 台账
- 新增 `playwright.config.ts`（覆盖 `1440×900`、`1280×720`、`390×844` 多视口）与 `tests/e2e/cargofit-regression.spec.ts`。
- 新增 `docs/qa/bug-regression-ledger.md`，完整记录 **BUG-001 至 BUG-008** 的复现路径、原始输入、预期结果、实际结果、修复位置与自动化回归用例映射。

---

## 二、核心工程功能深化清单（对照路线图 09–24）

1. **#09 多柜全局联合优化 — 已装柜货物锁定保护**：`lib/packing/global-fleet-optimizer.ts` 新增 `optimizeGlobalFleetWithLocks`，冻结已装柜货物并仅对剩余未锁货物进行 3D 重算与成本寻优，自动验证数量守恒。
2. **#11 订单智能导入与 7 项完整数据纠错**：`lib/packing/order-data-auditor.ts` 新增 `auditExtendedOrderRows`，补齐**净重大于毛重**、**CBM 与几何尺寸偏差 >5%**、**装箱数量超过单柜物理上限**，连同原有单位混淆、长宽高异常、套装比例错配、重复 SKU 实现全部 7 类规则校验。
3. **#13 更全面的装载空间库（真实内部障碍边界）**：`lib/packing/transport-library.ts` 为 `20RF` / `40RH` / `45RH` 内置前壁冷机回风通道与顶部 130mm 通风红线障碍区，新增 **13.6 米阶梯式高低板挂车（Step-Deck，内置前端 3800×450mm 鹅颈阶梯不可占障碍区）**与 **标准仓储物流笼车（Roll Cage 800×700）**，并同步完善英文词典（共 12 集装箱 / 12 货车 / 15 托盘与笼车）。
4. **#14 / #15 车辆轴荷动态配重 & 多站卸货残余承托复核**：`lib/packing/axle-load-estimator.ts` 新增自定义轴距、空车皮重分布与 `estimateProgressiveUnloadingAxleLoads`（逐站卸货后重算剩余货物重心与前/后轴荷，防止中途超轴）；`lib/packing/multi-stop-auditor.ts` 新增 `auditPostUnloadSupportStability` 识别卸货后下方支撑缺失引起的途中塌垛风险。
5. **#16 IMO/ILO/UNECE CTU Code 运输固缚力学**：`lib/packing/securing-void-analyzer.ts` 新增 `analyzeCtuSecuring`，支持海运 Area C/B、公路、铁路加速度系数、摩擦系数 $\mu$、滑移残余力（daN）、倾覆高宽比风险（$H/B$）、建议绑带数、防滑垫面积、护角与隔板估算，并在缺少实测摩擦/绑扎点额定资料时强制输出未认证告警。
6. **#17 8 类特殊货物与 IMDG Code 7.2.4 危品隔离规则引擎**：新增 `lib/packing/special-cargo-rules.ts`，纯确定性规则库覆盖易碎品、精密仪器、液体、食品、冷链、防潮（含干燥剂 BOM）、超限 OOG 及危险品 IMDG 7.2.4 隔离矩阵（绝不依赖大模型猜测）。
7. **#20 6 大角色工作台重构**：`components/packing-app.tsx` 补齐全部 6 大角色工作台（**快速测算 / 专业装柜 / 包装工程 / 现场执行 / 企业管理 / 开发者中心**）及 `Ctrl+K` 快捷命令。
8. **#24 装柜优化经济收益计算器 & 全栈 UI 集成**：新增 `components/v21-engineering-suites.tsx` 挂载于工程分析面板，提供与实算装柜量联动的交互式经济收益计算器（含原方案 vs 优化后年度柜数条形对比、年度运费节省额、运费下降比例、单柜容量提升、减少柜数与简化模型边界说明），并同步集成 CTU Code、特殊货物/IMDG、分段卸货轴荷与行业测试体系面板。

---

## 三、全量质量门禁验证结果

- **TypeScript 静态检查 (`npm run typecheck`)**：**0 错误**
- **ESLint 检查（全部新增与修改文件）**：**0 错误**
- **Vitest 全量单元与集成测试**：**229 / 229 测试文件，2,510 / 2,510 用例全部通过（0 回归）**
- **静态 HTML 与安全头校验 (`tests/rendered-html.test.mjs`)**：**21 / 21 全部通过**
- **1,000 组独立样本库实跑**：**1,000 / 1,000 通过，0 物理违规，P50=29.52ms / P95=176.05ms / P99=218.00ms**
- **生产静态构建 (`CF_PAGES=1 npx next build --webpack`)**：**6 / 6 静态路由编译通过**；**MCP Server (`npm run build:mcp`)**：**645.5 kb**
- **真实浏览器验收（Mozilla Firefox 153.8.0esr）**：桌面端 `1440×900`、移动端 `390×844` 与 `/crew.html` 均 **0 运行时报错**、**0px 水平溢出**，6 大角色工作台全部渲染可交互，工程分析与行业测试按钮响应正常。

---

## 四、诚实阻塞边界（需外部实体条件配合）

1. **真实工厂 ≥100 份原始实装样本与纸箱实验室 BCT/ECT 曲线**：需由工厂与包装实验室提供真实尺寸、地磅净重、装柜照片与抗压数据导入校准。
2. **商业竞品实机对照**：EasyCargo、Goodloading、CargoWiz、Cargo-Planner 需有效商业账号与授权；当前已提供标准化导出输入包与导入 Oracle 评估器。
3. **实体 GPU 设备与跨端矩阵**：Windows / macOS / Android / iOS 真机 GPU WebGL 帧率、触控手势与扫码枪/热敏打印机/地磅硬件联调需在实体设备上执行。
4. **GitHub 远端推送**：沙箱未配置远端写入凭据，请解压源码包后合入本地仓库推送至 GitHub 触发 Cloudflare Pages / Vercel 自动部署。
