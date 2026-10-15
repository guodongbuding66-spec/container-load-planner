# 计划 002 单托编辑与订单数量守恒

优先级 P1　工作量 L　修改风险高　证据信心高　依赖计划 001

基线 2fc3e2c0b6cab37eef5313b8600e41a45b4ab056　2026 年 10 月 15 日

## 目标与当前事实

单托页面应支持移动、旋转、增删、层复制和跨托转移；每次操作维护订单箱数、完整套数、重量和其他锁定托盘。当前单托页是只读查看，主三维已有统一移动事务与 20 步历史。

components/pallet-unit-viewer.tsx 第 12 行：

```ts
const plan=useMemo(()=>isolatePalletPlan(result,id),[result,id]);
```

lib/packing/plan-edit.ts 第 6 行：

```ts
export type EditGroup="selection"|"set"|"pallet"|"stack";
```

components/use-plan-editor.ts 的 commit 保存 undo、清空 redo，move 调用 editPlan，最终调用 revisePackingResult。复用这个事务边界。不能编辑 isolatePalletPlan 的摘要后直接当成全柜方案，因为其重置原点并筛选了汇总。

## 修改范围

允许修改 components/pallet-unit-viewer.tsx、pallet-manifest.tsx、scene-edit-panel.tsx、use-plan-editor.ts、packing-app.tsx；lib/packing/plan-edit.ts、pallet-inspection.ts、prebuilt-pallets.ts、types.ts、workspace-file.ts、result-audit.ts；对应已有测试。新增 lib/packing/pallet-edit.ts、pallet-edit.test.ts 与 components/pallet-editor.test.tsx。

本计划不改变多规格候选算法、不允许任意角度、不改变套装默认同托约束、不实现设备仿真或二维码服务。全局快照以现有 schema 兼容方式扩展，不能移除旧备份恢复。

## 首先检查漂移

运行 git diff --stat 2fc3e2c0b6cab37eef5313b8600e41a45b4ab056..HEAD -- components/pallet-unit-viewer.tsx components/use-plan-editor.ts lib/packing/plan-edit.ts lib/packing/prebuilt-pallets.ts。依赖 001 已合并时，比较其修改后的适配接口并更新受影响摘录。

## 实施步骤

1. 设计 pallet-edit 纯函数事务，显式接收完整方案、原始订单、托盘 ID 和操作。建立局部坐标到柜内坐标的可逆变换，正确处理 WLH 和底座高度。测试仿照 operations.test.ts 中 shared atomic editing。运行 npm run test:unit -- lib/packing/pallet-edit.test.ts，断言平移和九十度变换前后尺寸身份守恒。
2. 初步实现移动、旋转、同托层复制。层定义为托内高度段与箱位集合；不以全柜 layer 序号直接复制混合箱高。复制仅从未分配池取箱，禁止超订单。运行同一 targeted test，覆盖限高、围护净空、累计承重和悬空失败全部回滚。
3. 增加增删箱与跨托转移。删除归还未分配池；套装操作采用整套事务。单托和全柜两级验证都通过后才更新，全局其他 locked 单元保持不变。运行 targeted test，覆盖 A B 双箱 24 套、跨托转移、库存与尾数，验证总箱级毛重为 1296 kg 加实际包装自重。
4. 单托页接入编辑，采用同一 undo redo 和采用手动方案流程。预览不改主方案；采用后生成新 revision，同时更新所有派生指标和旧现场进度失效提示。运行 npm run test:unit -- components/pallet-editor.test.tsx lib/packing/workspace-file.test.ts，覆盖撤销、取消、采用与备份恢复。
5. 运行 npm run verify；预期退出 0。构建候选运行 npm run build:pages；预期退出 0。在真实 GPU 中人工操作三种托盘朝向和混合箱高案例，记录结果。

## 完成条件

- 拟建 T07 至 T13 与 T38 的数量、套号、局部和全局坐标及重量断言通过。
- 无效候选不留下部分变化；撤销与重做恢复订单池、箱位和包装记录。
- 锁定托盘坐标和身份不变，重新排布不复用已确认现场版本。
- 所有验证命令通过，范围外无修改；索引状态更新。

## 停止条件与维护

现有实体校验器无法校验一个操作后的完整方案、需要拆散套装才能“成功”、或锁定托需要移动时停止并报告。不要临时放宽承托比例或静默增加订单。未来尾数重打、二维码与现场回填都应复用单元稳定身份及该事务日志。
