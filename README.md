# 外贸装柜智算

面向外贸报价与出货计划的浏览器端装柜测算工具。当前 v0.5 支持单品最大装柜量、多 SKU 拼柜、完整套装原子装载、目标利用率倒推、真正的透视/正交投影、三视图控制三维相机、逐箱码垛导航、现场指导书、重心提示、独立合法性校验和坐标导出。

## 当前功能

- 20GP、40GP、40HQ 柜型预设；可修改参数、命名并在本机保存多个自定义柜型
- 自定义目标体积利用率与载重利用率，分别倒推箱数，并按当前 SKU 比例生成综合建议
- 一键把倒推数量应用到订单，再执行真实门洞、几何空间、堆叠与载重验证
- 相同套装编码的多个 SKU 可定义每套箱数；任一组成箱放不下即回滚整套，结果只输出完整套数
- 倒推箱数会自动对齐套装比例，结果区单独展示需求套数、已装套数、未装套数和组成箱明细
- 单品最大装柜：遍历允许方向，联合体积、门洞和载重约束计算规则排布
- 多 SKU 拼柜：按数量与优先级执行极点启发式装箱
- 每个 SKU 可设置固定方向、仅平面旋转或任意旋转
- 每个 SKU 可设置是否允许上方承托，以及最大堆叠层级
- 自动计算长向、横向和高度重心，并提示是否位于建议区间
- Web Worker 本机计算，订单和产品数据默认不上传
- WebGL 交互式三维视图；WebGL 不可用时自动切换为真实坐标俯视图
- 俯视、侧视、箱门三视图位于 3D 上方；点击任意视图，三维相机会切换到真正的正交投影并平滑旋转到精确轴向
- 3D 可独立切换透视投影/正交投影，并提供等轴测、俯视、侧视、箱门快捷方向；手动拖动后自动进入自由视角
- 逐箱上一步/下一步、1×/2×/4× 播放、拖动进度与当前箱坐标提示
- 多 SKU 可区分“必装货物”和普通塞货；支持必须底置，并将两项规则纳入独立校验
- SKU 显隐、体积/载重利用率、未装数量、告警和独立校验报告
- 产品 CSV 导入、坐标 CSV 导出、完整方案 JSON 导出，以及适合打印或另存 PDF 的现场装柜指导书
- 内置用户测试尺寸和“1 套 2 箱”一键数据；同时显示尺寸换算 CBM、标称 CBM 和差异，几何计算始终以真实外箱尺寸为准
- 本机草稿自动保存

## 约束模型

当前几何最小装载单元是“运输外箱”；配置套装后，业务最小装载单元升级为由多个外箱组成的原子套装。算法考虑：

- 柜内有效边界与安全间隙
- 箱门宽高
- 外箱旋转／禁倒置规则
- 必装优先与必须底置
- 套装编码、每套箱数、整套回滚和完整套数独立校验
- 是否可承托与最大堆叠层级
- 集装箱最大载重
- 箱体碰撞
- 非地面箱体至少 68% 的底面支撑

当前版本尚未模拟单箱顶部承重上限、目的地卸货空间顺序、托盘二次装柜、绑扎和道路轴荷；重心目前作为测算与告警指标，不作为强制淘汰条件。正式出货前仍需复核实际柜型与包装数据。

参考产品功能覆盖、差距与后续算法路线见 [`docs/feature-benchmark.md`](docs/feature-benchmark.md)。

## 技术结构

- React 19 + TypeScript
- Vinext / Vite
- Three.js + React Three Fiber
- 纯 TypeScript 装箱引擎与 Web Worker
- Cloudflare 兼容构建产物

核心目录：

- `components/packing-app.tsx`：工作台与业务交互
- `components/container-scene.tsx`：三维视图和 WebGL 降级视图
- `components/orthographic-views.tsx`：Canvas 三视图与码垛进度投影
- `lib/packing/engine.ts`：装箱、指标计算与独立校验
- `lib/packing/packing.worker.ts`：计算线程
- `lib/packing/engine.test.ts`：核心算法测试

## 本地验证

```bash
npm install
npm run lint
npm run test:unit
npm test
```

`npm test` 会生成并验证 Cloudflare 兼容构建产物。

## GitHub → Cloudflare Pages 自动部署

仓库已同时保留两条构建路径：

- `npm run build`：生成当前完整 Worker/Sites 构建产物。
- `npm run build:pages`：生成纯静态 Cloudflare Pages 产物到 `out`，装柜计算、Web Worker、三视图和 3D 都继续在浏览器本机运行。

Cloudflare Pages 连接 GitHub 时使用：

- Production branch：`main`
- Build command：`npm run build:pages`
- Build output directory：`out`
- Root directory：`/`
- Node.js：由 `.node-version` 固定为 `22.16.0`

`wrangler.jsonc` 已将 Pages 项目名和输出目录纳入版本控制。Cloudflare Pages 会注入 `CF_PAGES=1`，因此 `next.config.ts` 只在 Pages 构建时启用静态导出，不影响现有完整构建。Pages 构建固定使用 Webpack，确保装柜计算 Worker 被编译为可直接在浏览器运行的独立脚本。
