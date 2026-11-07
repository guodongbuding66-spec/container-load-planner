# v0.81.2 带结构资料的单层包装重新设计

2026-11-07（Asia/Shanghai）。

用户新截图显示 1800 × 1800 × 180 mm 木箱，每托 3 箱、净高 125 mm、6 托共 18 箱。v0.81.1 对带有底座实测、叉具接口、支承件或木箱额定资料的规格，只允许现有尺寸预览，并在结果页隐藏自动打托入口。这是上次普通 ULD 案例验收遗漏的路径。

配置页和单层结果页现在均显示“按箱数设计新包装”。点击后以订单余量和每托承重预填新目标，生成可修改的尺寸、层数和俯视／侧视预览；预览阶段不改变原方案。采用后同时更新每托箱数和尺寸并重算，或带入配置页继续微调。

旧规格及原有结构资料完整保存在可用数量为 0 的规格中，其可用配额转入新规格，可用总数不增加。新设计不继承旧底座实测部件、托内支承件、叉具和承压核验，默认整托不叠放。尺寸、底座高、自重、额定载荷仍须对应新实物填写。已有实测整托包络和交付版本继续限制直接改动；8 个规格已满时说明需要腾出归档位置。

回归重建保留 596 箱、1640 × 545 × 120 mm、42 kg、40HQ、每托 1000 kg、30 mm 围板及箱盖。1800 mm 方形旧箱与每托 3 箱限制在两算法均复现 18 箱／906 kg；设计每托 20 箱后为 1700 × 1150 × 1255 mm，10 层、14 托、280 箱／12,110 kg。测试同时覆盖旧结构保留、配额守恒、副规格重设计、规格上限及中英文入口。原始工作区尚未取得，隐藏结构字段用合成资料复现锁定条件。

## 发布与线上验收

运行代码提交 [`d1aeaca`](https://github.com/guodongbuding66-spec/container-load-planner/commit/d1aeacaf112905fa153c2ca2e916fc1068c02171)。GitHub [verify 工作流](https://github.com/guodongbuding66-spec/container-load-planner/actions/runs/42347471058) 成功；Cloudflare 部署 `1428110b-c7a8-4a8a-a2aa-7d38f27a4cb6` 成功，Vercel 部署 `dpl_ExaQgMrMxycN7A8xo1XQSTqTBMHr` 为 READY，均对应上述提交。

`npm run build:pages` 通过：166 个测试文件、2152 个测试，21 个渲染 HTML 检查、类型检查、API bundle 路由检查和生产导出。ESLint 仅有两个已有警告。

原生页面操作验收：

- 主站从 18 箱结果页进入新包装设计，默认目标 23 箱，改为 20 后显示 1700 × 1150 × 1255 mm、10 层、865 kg 的单托预览。取消后恢复原每托 3 箱及 18 箱结果。
- 再次采用并重算，两算法均为 280 箱、14 托、12,110 kg；刷新后新尺寸、每托上限和 280 箱结果保持。
- 灰度站从配置页采用同一新设计，再开始计算，两算法同为 280 箱。
- 原生工作区导出经解析与独立坐标复核：6 份已发布算法方案通过，主站、刷新后主站、灰度站的输入及箱位一致。除打托规格外订单与计算输入不变，旧规格结构资料逐字段保留，可用总数仍为 50。

验收环境未启用 WebGL，使用真实坐标 SVG 及三视图；没有验证 GPU 三维渲染。布局校验通过，但页面执行复核仍报告装卸路径不通过及承重、固定资料未核验，本次不把几何可行解释为实际可出货。

证据：[验收清单](field-upgrades/evidence/v0.81.2-acceptance.json)、[新设计预览](field-upgrades/evidence/v0.81.2-main-new-design.png)、[280 箱多层结果](field-upgrades/evidence/v0.81.2-main-280-layers.png)。原生下载文件以 gzip 保存，解压后 SHA-256 见清单；[复核脚本](field-upgrades/evidence/v0.81.2-verify.mjs) 可在仓库根目录以 Node 24 运行：

```sh
node --experimental-transform-types --disable-warning=ExperimentalWarning docs/field-upgrades/evidence/v0.81.2-verify.mjs
```
