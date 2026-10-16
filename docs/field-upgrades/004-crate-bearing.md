# 计划 004 有证据的木箱支承与叠放

优先级 P1　工作量 L　修改风险高　证据信心高　依赖计划 001 与 003

基线 2fc3e2c0b6cab37eef5313b8600e41a45b4ab056　2026 年 10 月 15 日

## 实施状态

v0.31.0 已实现额定资料、四角承压脚模型、独立多层预检、资料状态可视化与报告。详见 [升级记录](../upgrade-v0.31.0.md)。通用承托尚未表达立柱与箱盖角部，因此依照本计划停止条件保留所有木箱底置；自动叠放、实际结构额定资料与 GPU 验收仍待完成。下文保留原始计划作为需求基线，不表示所有步骤已经完成。

## 目标与当前事实

只有在额定顶载和接触位置都有资料时，木箱才参与整件叠放。默认底置必须保持，不能仅填写木材或总载重就自动解锁叠箱。

lib/packing/palletize.ts 第 16 行：

```ts
if (packagingInterior(config).crate || options.stackLayers === 1 || options.maxTopLoadKg <= 0) return 0;
```

当前单位构造把木箱设置为 bottomOnly；result-audit.ts 第 132 行明确木箱框架承重未核验。bearing.ts 第 9 至 27 行按接触面积分配静态累计质量。这个静态模型不能自行证明木箱板件强度或立柱支承。

## 修改范围

允许修改 lib/packing/types.ts、packaging.ts、palletize.ts、prebuilt-pallets.ts、bearing.ts、result-audit.ts、workspace-file.ts、load-analysis.ts；components/packaging-editor.tsx、pallet-build-settings.tsx、scene-load-panel.tsx；对应已有测试。新增 lib/packing/crate-bearing.ts、crate-bearing.test.ts 与 components/crate-bearing-settings.test.tsx。

不实现有限元，不按材质推断额定值，不修改其他货物默认朝向，不把地板集中载荷或运输固定标成通过。若需要改引擎通用碰撞或放宽套装规则，停止并另立计划。

## 首先检查漂移

运行 git diff --stat 2fc3e2c0b6cab37eef5313b8600e41a45b4ab056..HEAD -- lib/packing/packaging.ts lib/packing/palletize.ts lib/packing/prebuilt-pallets.ts lib/packing/bearing.ts。核对 001 和 003 的复核与结构版本字段。

## 实施步骤

1. 增加可选额定资料：结构 revision、允许朝向、额定顶载、许可接触区、传力部件关联、支承条件、来源与有效条件。资料缺失、明确禁止与不适用分别处理。运行 npm run test:unit -- lib/packing/crate-bearing.test.ts，断言旧备份和无额定资料木箱仍然底置。
2. 先支持参数化的离散承压区。将上箱底梁或托脚投影到下箱许可区域，核对覆盖与对应关系；静态总质量沿确认的传力关联累计。拒绝仅靠封板中部接触或未知传力路径。运行 targeted tests，覆盖四角对齐、错位、缺一区、超顶载与多层累计。
3. 把只有通过新支承规则的候选接入 palletize 与 validatePalletizedCargo。默认底置保持，资料变更后已有布局需重新验证。不得先让引擎堆叠再把未核验警告当成功。运行 npm run test:unit -- lib/packing/crate-bearing.test.ts lib/packing/multi-packaging.test.ts lib/packing/packaging.test.ts，确保木箱净空、自重与规格库存回归通过。
4. 界面与热力图显示额定来源、支承区域、累计负荷和未知项，导出和备份保存相同资料。运行 npm run test:unit -- components/crate-bearing-settings.test.tsx lib/packing/result-audit.test.ts lib/packing/workspace-file.test.ts，确认缺少资料仍未核验。
5. 运行 npm run verify 和 npm run build:pages，预期退出 0。用实际木箱结构及额定资料完成一次人工复核；示例输入只用于测试，不代替实物证据。

## 完成条件

- 拟建 T17 T18 T19 T20 T33 T38 通过。
- 木箱默认行为向后兼容；无资料不能参与已核验叠放。
- 对位置错位、超额与资料缺失分别给出可定位原因，所有端使用同一结果。
- 所有验证命令通过，范围外无修改；生产额定资料和适用条件已复核，或保持功能未启用；索引状态更新。

## 停止条件与维护

真实结构不能由首版离散支承区表达、传力分配需材料挠曲才能成立，或没有明确额定资料时停止启用生产叠放。未来任何木箱结构修改都应产生新 revision，旧证据不能无提示继承。
