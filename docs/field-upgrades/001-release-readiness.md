# 计划 001 统一校验状态与交付投影

优先级 P0　工作量 M　修改风险中　证据信心高　依赖无

基线 2fc3e2c0b6cab37eef5313b8600e41a45b4ab056　2026 年 10 月 15 日

## 实施状态

v0.28.1 已实现统一复核与交付投影，软件验证见 [验收记录](../upgrade-v0.28.1.md)。真实 GPU 验收仍待完成。

为向离线导出传递原始产品资料，同时更新 components/planning-upgrades.tsx 的调用参数；版本与实施文档同步更新。用户后续明确授权同步 GitHub、Pages 与 Vercel。以下保留实施前的基线说明与原计划。

## 目标与当前事实

用户需要从方案顶端分清几何、承重、路径和运输固定的完成程度，并在客户报告、离线作业图和主视图看到相同货物外形。当前数据核对已经有 pass fail unverified；木箱与缺少上压数据被标记 unverified。但浏览器抽查仍能看到“独立校验 全部通过”与承重未核验同时出现。

lib/packing/result-audit.ts 第 12 行：

```ts
export type AuditState = "pass" | "fail" | "unverified";
```

lib/packing/field-report.ts 第 6 行：

```ts
export function planSvg(plan:PackingResult,view:"top"|"side"|"door"="top"){
```

该函数第 8 行逐件输出 rect，未使用货物真实投影。components/orthographic-views.tsx 已导入 cargoShapeProjections，并通过 shapePolygons 使用 orientationSigns 变换外形；同时使用 placedPackagingParts 表达包装。复用这条现有几何来源，避免另造形状定义。

## 修改范围

允许修改 lib/packing/field-report.ts、result-audit.ts、types.ts、cargo-shape-geometry.ts、packaging.ts、pdf-guide.ts、components/result-audit-panel.tsx、packing-app.tsx、orthographic-views.tsx；允许新增 lib/packing/plan-review.ts、plan-review.test.ts、field-report.test.ts、plan-projection.ts、plan-projection.test.ts。已有相应 tests 可以补充。

不得改变 pack 求解策略、默认经验利用率、碰撞和承重判定；不得扩大云端权限或新增发布动作。若需要修改这些范围，停止并重新审阅计划。

## 首先检查漂移

运行 git diff --stat 2fc3e2c0b6cab37eef5313b8600e41a45b4ab056..HEAD -- lib/packing/field-report.ts lib/packing/result-audit.ts components/packing-app.tsx components/orthographic-views.tsx。逐项比较上述事实；若接口已经变化，先刷新计划。

## 实施步骤

1. 新建统一的计划复核摘要，分别汇总数据、几何、承重、路径、固定。状态采用通过、不通过、未核验、不适用；从现有校验结果适配，不重新计算一套不同的真值。每项保存覆盖范围、算法和问题对象。固定尚未建模的场景为未核验。新增 plan-review.test.ts，运行 npm run test:unit -- lib/packing/plan-review.test.ts，断言几何通过但承重未知时总体不能写全部通过。
2. 抽取共用的二维投影生成器，输入完整 plan 与视角，输出投影轮廓和包装部件；尊重 signed orientation、孔洞、木箱围护与完整外高。实现与现有三视图对比的回归。运行 npm run test:unit -- lib/packing/plan-projection.test.ts，断言 U 槽、空心管、旋转木箱和普通箱四类均一致。
3. 接入 field-report 的客户报告和离线作业图，接入方案顶部摘要，导出带复核状态。保持隐藏、剖切和播放只影响查看范围。运行 npm run test:unit -- lib/packing/field-report.test.ts lib/packing/result-audit.test.ts，确认导出使用完整箱位与相同状态。
4. 运行 npm run verify，预期退出 0；发布候选运行 npm run build:pages，预期退出 0。记录真实 GPU 验收矩阵，覆盖透视、正交、透明度、全屏、剖切、拾取和截图。没有硬件验证时保留待验收，不把构建通过写成 GPU 通过。

## 完成条件

- 主页面与各导出包含相同复核状态；未核验承重或路径不再被顶部全部通过掩盖。
- 三视图、客户报告、离线作业图保留同一形体孔洞和木箱外高；包装自重只计入一次。
- 拟建用例 T20 T28 T32 T33 T34 T38 通过；T40 有可追溯的硬件记录或明确待验收。
- targeted tests、verify 和构建通过；git diff --name-only 不含范围外文件；索引状态更新。

## 停止条件与维护

真实投影不能保持孔洞语义、某导出拿不到完整 cargoDetails，或现有报告数据不一致时停止，不得退回外接框却标为真实外形。未来新增状态与导出都要走同一适配层。CI 测试只证明其覆盖的逻辑，不证明所有设备画面一致。
