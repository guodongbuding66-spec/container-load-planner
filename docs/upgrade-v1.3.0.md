# CargoFit v1.3.0 升级记录

发布日期：2026-11-28

## 核心升级项

### 1. D01（P0）：浏览器内一键运行 BR1–BR7 公开学术基准与极端压力看板
- 在 `components/quality-benchmarks.tsx` 中集成 **公开学术基准与极端压力校验看板**（覆盖 Bischoff–Ratcliff (1995) 标准 20 英尺柜 `BR1–BR7` 异构集 + 5 组极端边界压力案例，共 12 组）。
- 采用异步分步执行（逐案更新进度与结果表，不阻塞 UI 主线程），支持切换「高密度（学术对照）」与「现场实用（95% 上限）」两种策略。
- 实时输出零信任 3D 物理校验结果（碰撞数 / 越界数 / 悬空数 / 载重超限 / 数量守恒）、BR1–BR7 平均体积利用率、P50 / P95 / P99 求解耗时，并支持一键导出完整 JSON 报告（`cargofit-br-benchmark-v1.3.0.json`）。

### 2. D06（P1）：原生 Binary STL / ASCII STL / Wavefront OBJ 工业三维网格解析
- 新增 `lib/packing/cad-mesh-import.ts`：
  - 支持 **Binary STL**（80 字节头 + little-endian 三角面数与长度严格校验）、**ASCII STL**（支持多 `solid` 分块）与 **Wavefront OBJ**（支持 `o/g` 子网格分组、四边形/多边形扇形三角化、负索引解析）。
  - 实现精准包围盒提取、单位换算（`mm / cm / m / in`）、朝上轴重映射（`X / Y / Z`）及有符号四面体法精确体积计算（`computeSignedMeshVolumeMm3`）。
- 将 `.stl` 与 `.obj` 无缝接入 `lib/packing/model-import.ts` 统一 `importCargoModel` 管线与 `components/solid-model-editor.tsx` 文件导入界面，共享凸包碰撞代理、减面优化、承托面检查与 3D 装载渲染。
- 新增 `lib/packing/cad-mesh-import.test.ts`（6 组单元测试与端到端导入验证）。

### 3. D20（P2）：四类角色工作台预设快捷切换
- 在 `components/packing-app.tsx` 与 `components/command-palette.tsx` 中新增 4 类工业角色工作台预设：
  - **快速测算**：切换至极简 3 步 + 散箱直装，适合外贸业务员快速报价测算。
  - **专业装柜**：切换至专家 7 步 + 先打托再装柜，适合高级物流工程师精细配载。
  - **包装工程**：切换至专家 7 步并直达步骤 2（包装/托盘与整托优化），适合包装工程师。
  - **现场执行**：直达步骤 7 装柜作业指导书（无结果时自动触发测算），适合仓库与现场监装人员。
- 支持顶部角色工作台快捷条与 `Ctrl+K` / `⌘K` 全局命令面板双向一键切换，完整适配浅色/深色模式及移动端窄屏。

## 显式阻塞项声明（不虚假宣称完成）
- **GPU / WebGPU 物理与大规模加速（D04 硬件项）**：当前静态构建与普通用户浏览器环境无统一独立 GPU 算力，需在真实支持 WebGPU 的终端硬件上进一步实测。
- **工厂实装纸箱抗压与称重标定数据（D07/D08/D23 实测项）**：需真实工厂纸箱 ECT/BCT 实测值与现场装柜称重回传，软件侧已严格标示未标定数据警告，不伪造实测系数。
- **商业竞品同单对比实测**：需商用正版软件授权（EasyCargo / Cube-IQ / Cape Pack / PackAssistant），当前仅对公开学术基准（BR1–BR7）给出可复现数据。
- **GitHub 远端仓库推送**：当前沙盒无 GitHub 推送凭据，已完整提交至本地 Git 仓库并提供标准源码压缩包（`container-load-planner-v1.3.0.zip`）。
