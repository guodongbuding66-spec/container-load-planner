# 计划 003 标称与保守尺寸双方案

优先级 P1　工作量 M 至 L　修改风险中高　证据信心高　依赖计划 001

基线 2fc3e2c0b6cab37eef5313b8600e41a45b4ab056　2026 年 10 月 15 日

## 目标与当前事实

用户需要知道外箱鼓包、实测偏差和包装附件对装柜数量与位置的影响。当前 ProductInput 保存一组三围，另有 protectionGap；它们不能表达标称与批次实测两种来源，也不能代替各面加厚。

lib/packing/types.ts 第 88 至 89 行与第 109 至 112 行：

```ts
/** Required separation from other cargo, in canonical mm. */
protectionGap?: number;
length: number;
width: number;
height: number;
weight: number;
```

lib/packing/result-audit.ts 第 63 行把当前输入与箱位朝向尺寸核对；新增派生输入必须让该核对读取正确的求解快照，不能让标称 SKU 与保守坐标互相误报。

## 修改范围

允许修改 lib/packing/types.ts、workspace-file.ts、calculation-state.ts、packing.worker.ts、result-audit.ts、csv.ts、pdf-guide.ts、field-report.ts；components/cargo-settings.tsx、planning-upgrades.tsx、packing-app.tsx；对应已有测试。新增 lib/packing/dimension-scenarios.ts、dimension-scenarios.test.ts、components/dimension-scenarios.test.tsx。

不修改产品主数据来模拟增量，不改变默认求解器和经验装载率，不自动推导概率分布，不改价格币种或发布策略。CSV 和备份增加可选字段并兼容旧文件。

## 首先检查漂移

运行 git diff --stat 2fc3e2c0b6cab37eef5313b8600e41a45b4ab056..HEAD -- lib/packing/types.ts lib/packing/calculation-state.ts lib/packing/result-audit.ts components/packing-app.tsx。核对依赖 001 引入的统一复核接口。

## 实施步骤

1. 设计独立 scenario：来源、实测三围、各尺寸总增量或各面增量、批次、日期、附件来源 ID。内部统一换算 mm；拒绝负后尺寸、非有限值与重复附件来源。运行 npm run test:unit -- lib/packing/dimension-scenarios.test.ts，断言两侧各 3 mm 得到总加 6 mm。
2. 创建不可变派生请求。对普通纸箱使用保守包络；实体模型默认以明示的保守碰撞代理处理偏差，不把尺寸增量未经说明地缩放成某种材料变形。保护间隙保持独立语义。若精确实体膨胀尚不支持，显示保守包络模式，不能声称真实表面公差。运行 targeted tests，验证原始请求不变和重量不重复。
3. 分别执行原方案原位复核与保守请求重新求解；存储双请求指纹和结果，不沿用过期坐标。输出箱位差异、数量、套数、门洞和最小余量。运行 targeted tests，固定净宽 2330、四列宽 580、总增量 3 的原位失败案例；重新求解数量由算法结果给出，不硬写减少比例。
4. 接入对比界面、备份与导出。每个报告带 scenarioId、求解版本与输入来源；旧备份默认标称。运行 npm run test:unit -- lib/packing/dimension-scenarios.test.ts lib/packing/workspace-file.test.ts lib/packing/result-audit.test.ts，验证恢复后每套输入与坐标对应。
5. 运行 npm run verify 与 npm run build:pages，均应退出 0。浏览器切换标称与保守结果，检查指标、三视图、主图和导出同步。

## 完成条件

- 拟建 T03 T04 T05 T06 T24 T34 T38 通过。
- 公差来源与每面或总尺寸口径可见；输入单位切换不改变物理尺寸。
- 原方案与保守方案独立保存；标称主数据不被覆盖；不虚构成功率或固定少装比例。
- 无新错误、构建通过且未改范围外文件；索引状态更新。

## 停止条件与维护

发现实体模型尺寸变化会使碰撞代理不能保证覆盖、既有快照无法区分两种输入，或附件被重复加厚时停止。所有未来包装更新和实测回填都通过该派生层，避免在界面临时加几毫米但算法仍用旧尺寸。
