# CargoFit 装柜智算 v3.0.0 — 24 个核心升级方向与配图目标深度升级报告

**版本**：`v3.0.0`（`ENGINE_VERSION = "3.0.0"`）  
**升级依据**：逐项对照 [ChatGPT 分享文档：进一步升级的 24 个核心方向与全部配图要求](https://chatgpt.com/s/t_6b0a63b695748191b530836564ab117c)，彻底清除此前 v2.2.0 中存在的未接线模块、静态占位图及算法/预处理缺口。

## 一、v2.2.0 → v3.0.0 重点补齐的实质性缺口清单

1. **D01 装柜算法全面升级** (`lib/packing/hybrid-solver.ts` + `components/v3-visual-suites.tsx`)
   - 新增 **货物特征分析与动态算法调度器 (`analyzeCargoFeaturesAndDispatch`)**，按订单特征自动调度 6 大策略节点；
   - 补齐 **束搜索 (Beam Search)** 与 **小规模精确分支定界 (CP-SAT / Branch-and-Bound)** 最优性核验；
   - 新增 **异步流控 (`runHybridPackingOptimizerAsync`)**：支持实时进度、暂停、继续、随机种子复现，并按配图《下一代混合装载引擎》完整可视化 5 层架构。
2. **D02 真正的多目标装载优化** (`components/v3-visual-suites.tsx`)
   - 1:1 复刻配图《智能优化目标设置》：6 色滑块（最大装载数量/最少集装箱/最低运输成本/最少托盘/装载稳定性/现场操作便利性）、**横向分段彩色比例条**、恢复默认权重、localStorage 个人偏好保存与加载、硬约束不可绕过锁定标识及 Pareto 最稳定/最大数量/高利用率方案评估。
3. **D04 多级包装优化** (`components/v3-visual-suites.tsx`)
   - 复刻配图 **Level 1 → Level 6 六级抽象模型**（产品 → 内包装 → 外包装 → 运输包装 → 装载空间 → 整单运输），实时核算各层级件数与包材皮重占比。
4. **D05 真正的异形货物装载引擎** (`lib/packing/irregular-nesting-engine.ts` + `components/v3-visual-suites.tsx`)
   - 补齐 **U/T 型件 180° 凹槽互锁 (`solveUTProfileInterlock`)**、**型材/围栏/板材错位叠放 (`solveStaggeredSlatsAndProfiles`)**、**3D OBB + BVH SAT 零碰撞校验 (`verifyObbBvhZeroCollision`)** 及完整 **10 类异形策略注册表**，显式区分「真实模型显示 / 真实几何碰撞 / 真实材料变形」三级能力边界。
5. **D06 CAD、3D 模型及工程文件兼容** (`lib/packing/cad-mesh-import.ts` + `components/v3-visual-suites.tsx`)
   - 正式将此前未接线的 `cad-mesh-import.ts` 接入前端工作台；新增 **ASCII FBX 解析与二进制 FBX 检测 (`parseFbxMesh`)**，覆盖全部 7 类格式（GLB/glTF、OBJ、STL、FBX、STEP/STP、IGES、DXF）；新增 **CAD 工程预处理管线 (`preprocessCadMesh`)**，支持轴心校正、减面目标、重心偏移、6 面可承托面分析、允许嵌套凹腔识别及 3ds Max `.ms` 插件一键下载。
6. **D07 智能托盘与木箱设计系统** (`lib/packing/smart-pallet-designer.ts` + `components/v3-visual-suites.tsx`)
   - 解除此前写死 `products[0]` 的限制，支持全订单 SKU 切换、限高与悬挑量输入、**2D 俯视托盘排布 SVG 图**，并新增 **木箱 1–8 号零件工程结构 BOM (`designWoodenCrateBom`)** 与 ISPM-15/自重/木方成本核算。
7. **D08 包装结构承重与稳定性分析** (`components/v3-visual-suites.tsx`)
   - 完整呈现配图 **2×2 四类工程分析热力图**（1. 累计上压热力图、2. 地板载荷热力图、3. 稳定性风险分布、4. 承托面积分析），缺实测抗压数据时显式标注 **未核验**，绝不自动判定安全。
8. **D09 多柜全局联合优化** (`components/v3-visual-suites.tsx`)
   - 正式接线 `optimizeGlobalFleetWithLocks`，按配图呈现 **优化前（均质逐柜）vs 优化后（跨柜混配 + 柜型替换）进度条对比** 与已装柜锁定保护。
9. **D13 更全面的装载空间库** (`lib/packing/transport-library.ts` + `components/v3-ops-enterprise-suites.tsx`)
   - 为 `air-ld3-ake` 补齐 **45° 双阶梯下切角真实障碍区**，新增 `rail-boxcar-60`（铁路棚车）与 `bulk-cargo-hold`（散杂货船舱），并在前端提供 **3×3 九宫格装载空间库浏览器**。
10. **D14 车辆轴荷与动态配重** (`lib/packing/axle-load-estimator.ts` + `components/v3-ops-enterprise-suites.tsx`)
    - 新增 **三轴半挂车力学模型 (`estimateThreeAxleTractorTrailerLoad`)**，支持自定义轴距与皮重，并 1:1 复刻配图半挂车侧视剖面 SVG（含 2×5 彩色货箱、红色十字准星「货物重心」及 `前轴 / 驱动轴 / 挂车轴组` 实时利用率 + 分段卸货阶段切换）。
11. **D15 多目的地装载与卸货顺序** (`components/v3-ops-enterprise-suites.tsx`)
    - 彻底删除原静态写死 SVG，替换为 **实时数据驱动的多站 LIFO 卸货分区 SVG**，直接读取当前装载方案的站次、箱数、重量与卸货后残余承托风险。
12. **D16 运输安全与货物固定系统** (`lib/packing/securing-void-analyzer.ts` + `components/v3-ops-enterprise-suites.tsx`)
    - 新增 `estimateCtuSecuringAccessoryKit`，完整核算绑带、充气缓冲气袋、木方斜撑/垫木、挡货杆、防滑垫面积、护角、隔板与集装箱干燥剂挂袋，缺实测数据时显式告警。
13. **D18 仓库装柜现场移动端** (`app/crew/page.tsx`)
    - 新增 **100×150 mm 热敏箱托条码标签预览与打印**，与四账对账、扫码核验及 8 槽位水印照片 ZIP 形成现场闭环。
14. **D20–D24 角色工作台、企业治理、开发者中心、校准飞轮与 ROI 计算器** (`components/v21-engineering-suites.tsx` + `components/v3-ops-enterprise-suites.tsx`)
    - 新增 **3×2 六大角色工作台切换矩阵** 按角色隔离展示；正式接线 `enterprise-governance.ts`（草稿→待审→批准→签发不可变审批流 + 审计日志 + 4 级商业化方案）；正式接线 `api-contract.ts` & `cargofit-sdk.ts`（四层集成架构图 + 实时 API 输出三维坐标演练场）；新增 **五节点顺时针持续校准闭环飞轮 SVG 图**；升级 **装柜优化经济收益计算器 (ROI)** 支持一键同步当前实算装量。
