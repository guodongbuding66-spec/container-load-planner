# CargoFit v2.0.0 升级记录：五大核心竞争力深度突破与 112 场景基准验收

发布日期：2026-11-28

## 一、五大核心突破支柱实现详情（零占位、零假数据、全独立物理校验）

### 1. 行业级混合装载求解器与独立验证体系
- **核心引擎（`lib/packing/hybrid-solver.ts`）**：
  - 在原有双策略基准与 LNS（大邻域重排）基础上，正式集成 **BRKGA 偏置随机键遗传算法**（精英保留 35%、偏置交叉率 `ρ=0.7`、随机变异注入）与 **模拟退火（SA）局部邻域跳出**，覆盖 `fast` / `standard` / `deep` / `extreme` 四档计算模式与可复现随机种子。
  - 每一组候选方案均经 **零信任独立 3D 物理 Oracle（`verifyPackingOracle`）** 校验碰撞、越界、超重与数量守恒，自动提取 `maxQuantity`、`maxUtilization`、`mostBalanced` Pareto 前沿。
- **112 场景综合基准套件（`lib/packing/benchmark-suite-v2.ts`）**：
  - 覆盖 Bischoff–Ratcliff (1995) `BR1–BR7` 学术集（7 组）+ 极端几何压力（5 组）+ 种子随机异构（60 组）+ 多箱成套外贸订单（20 组）+ 重载/底置混装（20 组），合计 **112 场景**。
  - **实测结果**：**112/112 通过（0 物理违规）**，BR1–BR7 平均体积利用率 **88.51%**，全量求解耗时 **P50 = 40.13 ms / P95 = 357.88 ms / P99 = 449.04 ms**。

### 2. 反向产品与包装尺寸多轴联合优化
- **核心引擎（`lib/packing/reverse-packaging-optimizer.ts`）**：
  - 在长/宽/高允许公差区间内自动执行「单轴灵敏度扫描 + 多轴联合组合」两阶段搜索，每组候选全部调用真实 `packLoadingWorkflow` 3D 求解器（严禁按 CBM 比例估猜）。
  - 同步计算标准 RSC 瓦楞纸箱展开面积变化（`m²`）、单箱包材成本增减（`USD`）、年度省柜数与扣除包材差价后的 **年度净经济收益（`netAnnualBenefitUsd`）**。

### 3. 真实异形几何及嵌套装载引擎
- **核心引擎（`lib/packing/irregular-nesting-engine.ts`）**：
  - **圆柱/圆筒六角密排（HCP）**：按行距 $\Delta = D \cdot \frac{\sqrt{3}}{2}$ 生成精确 `(cx, cy, cz)` 坐标，内置同层圆心距 $\ge D - \epsilon$ 独立零穿透验证，并与常规矩形排列实测对比增容率。
  - **圆锥/花盆/桶类套叠装载**：按单件高度与套叠步进 $\Delta H$ 计算每摞件数、摞高与六角底面排列总件数，同时受容器最大净载重约束。
  - **L 型/阶梯异形件 180° 凹槽交错咬合**：在满足 $2 t_H \le H$ 时实现零增高紧凑配对（`pairL = L + tL, pairH = H`），并对两件实体子长方体逐对执行精确零重叠数学证明。

### 4. 包装、托盘、集装箱、整单落地成本全局联合优化
- **核心引擎（`lib/packing/global-fleet-optimizer.ts`）**：
  - 针对整单货量自动生成并逐柜调用真实 3D 求解器评估 5 类运力组合：`纯 40HQ`、`40HQ + 20GP 尾柜混配`、`40HQ + 40GP 尾柜混配`、`40HQ 整柜 + LCL 拼箱尾货`、`纯 20GP`。
  - 综合海运费、LCL 计费吨（W/M 取大）、每箱包装费与每柜港杂/报关费，按 **整单落地总成本（`USD`）** 排名并直接输出相对纯 40HQ 的真实节省额。

### 5. 真实工厂数据与持续实装校准闭环（防过拟合）
- **核心引擎（`lib/packing/field-calibration.ts` v2.0 升级）**：
  - 严格执行 **70% 校准集 / 30% 独立验收集（Holdout）隔离**，绝不用同一批样本既校准又自证精度。
  - 内置 **IQR 四分位距异常值检测**（自动隔离录错的极端样本）、按 **产品类别（`category`）与包装版本（`packagingVersion`）** 分组误差建模、**95% 置信区间** 及独立验收集 **MAE / P90 / Max 误差回测**。
  - 当有效样本 `<10` 条时诚实标示 `calibrating / insufficient-data`，绝不虚假宣称满足 `≤3%` 工业精度目标。

## 二、全量回归与真实浏览器验收汇总

- **TypeScript (`npm run typecheck`)**: 0 errors
- **ESLint（全部新增与改动文件）**: 0 errors
- **Vitest 全量单元测试**: 228/228 文件全部通过（含 112 场景零违规基准）
- **HTML 结构校验 (`tests/rendered-html.test.mjs`)**: 21/21 通过
- **MCP Stdio Server (`npm run build:mcp`)**: 打包通过（`645.5 kb`）
- **静态生产构建 (`CF_PAGES=1 npx next build --webpack`)**: 6/6 静态路由导出通过
- **真实浏览器验收（Mozilla Firefox 153.8.0esr）**：步骤 7 五大核心突破面板逐一点击实测渲染通过，桌面 1440×900 与移动 390×844 均 **0 页面错误、0px 水平溢出**，截图归档于 `docs/field-upgrades/evidence/v2.0.0-desktop-five-pillars.png`。

## 三、诚实外部阻塞边界（未假装完成）

- 实体独立 GPU WebGL 帧率与真机多端手势验收（U01）
- 真实工厂 ≥100 组独立原始箱规/照片/地磅单及纸箱厂实验室 BCT/ECT 实测曲线（U08/U21/U23）
- 商业竞品（EasyCargo / Goodloading / Cape Pack / PackAssistant）正版授权同单对照实测
- GitHub 远端推送凭据与托管云数据库/发信配置（A1–A5）
