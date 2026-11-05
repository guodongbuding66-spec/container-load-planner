# v0.77.0 自动装载与多柜优化（第 1／5 轮）

2026-11-05（Asia/Shanghai）。第一轮已交付，范围及剩余四轮见 [五轮交付计划](five-release-plan.md)。

新增自动多组配额与包装比较、已装柜前缀保留、原箱托不动的现有柜散箱补入、实际拆托／重打计费及完整报告。小网格完整枚举，大搜索域每批最多复核 64 个候选，支持最多 64 个源行或完整套装组。旧备份兼容、固定箱位及采用校验详见 [013R](field-upgrades/013r-automatic-fleet-optimization.md)。

## 双站原生验收

受控订单五行各 5 箱，共 25 箱。整单基线为 10 柜、10 托、配置费用 1,050 元。每次拆托报价 2 元，每次重打报价 3 元，均记录来源。

| 场景 | 独立复算候选 | 实际采用结果 | 配置费用 |
| --- | ---: | --- | ---: |
| 主站重排 | 39 | 5 柜，25 箱全部散装，五个源行各 5 箱 | 520 元，含 10 托拆托费 20 元 |
| Vercel 保留首柜 | 37 | 5 柜，首柜原箱托及 ID 完整保留，25 箱全部装入 | 523 元，含其余 9 托拆托费 18 元 |
| 主站原位补货 | 33 | 保持 1 柜 1 托，锁定箱托原位不动，4 箱增至 6 箱，80 kg | 105 元，拆托与重打均为 0 |

主站未报价预览完成 44 个候选，工作费及完整配置费用保持未知。三个采用场景的 JSON 候选均按原调度独立重算，CSV 覆盖每候选五个源行和 31 列。两站均恢复了 v0.76.0 的版本 1 基线。Vercel 采用后的版本 2 多柜备份在主站恢复，坐标 CSV 逐字节一致。刷新后主站采用的输入及配额保持一致。两站各运行 20 次固定基准并通过校验，恢复验收前的订单及两种策略，均为 116 箱、3,842 kg。

## 发布与证据

本地生产构建通过，包含 2,099 项单元测试（159 个文件，其中新增 51 项专项测试）、21 项页面检查、类型检查及 ESLint（0 错误、2 项既有警告）。双站 23 项界面断言、20 项文件复核全部通过。37 份原件、截图及构建和校验记录已归档，下载文件保留原始字节。[哈希索引](field-upgrades/evidence/v0.77.0-acceptance-index.json) · [界面断言](field-upgrades/evidence/v0.77.0-native-ui-checks.json) · [文件复核](field-upgrades/evidence/v0.77.0-native-file-checks.json)

运行提交 `6c426fb0b6fa5797821750129ded1cdf495c211f` 的 GitHub CI 成功。Cloudflare Pages 发布 `be030966-2d8e-4304-8408-3ae01faba2d3` 成功，Vercel 发布 `dpl_8bHdVqTZd4avpsLBZsY67MTepsJf` READY。[GitHub CI](https://github.com/guodongbuding66-spec/container-load-planner/actions/runs/41970057625) · [主站](https://container-load-planner.pages.dev/) · [Vercel](https://container-load-planner-gray.vercel.app/) · [发布状态](field-upgrades/evidence/v0.77.0-release-state.json)

首次归档 CI 的五组高密度完整搜索回归用时 7.4 秒，超过 Vitest 默认的 5 秒。为两种策略的完整搜索回归单独设定 30 秒测试时限，保留原有断言。[首次归档 CI](https://github.com/guodongbuding66-spec/container-load-planner/actions/runs/41973182264)

U09、U10、U11、U20 的本轮子项已验收，整托补货、跨方式承托、实物身份与税务结算继续按后续轮次处理。原用户 596→16 工作区、真实 GPU 与多浏览器、工厂原始数据、额定资料和现场试装仍待实际证据。账号和收费服务待第 4 轮，正式收款需要可用商户配置。U03、U05 具体叉车操作已移出范围。[剩余台账](field-upgrades/unfinished-roadmap.md)
