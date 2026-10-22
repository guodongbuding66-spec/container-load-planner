# v0.54.0 费用、工程复核与业务基准

日期：2026-10-22。发布状态：GitHub CI、Vercel 及 Cloudflare 同源发布与本轮实际验收通过。

## 本轮范围

- [013C](field-upgrades/013c-delivery-charges.md)：多柜增加材料、人工、返工、其他费用与手工报价汇率，同步单位成本、备份与 CSV。
- [015A](field-upgrades/015a-engineering-review.md)：当前已登记交付版本的整托实测保守包络／附件增重试算，以及独立刚性两支点静态反力与超限检查。
- [017](field-upgrades/017-business-benchmarks.md)：版本化 6×2 固定案例，独立 Worker、停止／超时、质量与数量差距及 JSON 报告。

## 验证与发布

`npm run build:pages` 完整通过：1,462 项单元测试（110 文件）、21 项页面结构检查、TypeScript 和静态生产构建；lint 0 错误，2 项既有警告。新增 47 项核心与界面检查通过；夹具准备及清理的临时检查不计入正式数量。

运行提交 `7409f0ca294d6214c933cced3829ee0fe5940b6f`，树 `6d3081b798d938f118688b635ccadbc9ddf0c37e`。[GitHub verify](https://github.com/guodongbuding66-spec/container-load-planner/actions/runs/39706423513/job/119587410962) SUCCESS。Vercel 生产部署 `dpl_Bcr4QGr2VnkKJc47z64o41bJYoZj` READY，对应 https://container-load-planner-gray.vercel.app/；Cloudflare `87767317-32bf-4ed7-be5a-a44743fd4d7c` 部署成功，对应 https://container-load-planner.pages.dev/。Cloudflare 此次自动同步恢复，没有重试上轮已拒绝的登录。

## 正式站实际验收

- 使用明确合成的 [8 箱、2 托工作区](field-upgrades/evidence/v0.54.0-workspace.json)：货物 80 kg、托盘 40 kg、总载重 120 kg。额定资料是验收参数，不能作为实车能力资料。
- 前／后空载 100／200 kg，载荷重心距柜头 250 mm、轴距 1000 mm，结果前 190、后 230、总重 420 kg；前支点额定 180 时超出 10 kg，额定留空保持未核验。恢复有效额定后显示“模型范围内未见超限”。
- 两托均未实测时保持未核验。首托长度从 500 增加至 501 mm 后，双方明确报告与另一托相交；恢复后双托外包络均为 500×500×300 mm，主方案仍为 8 箱、120 kg。[实测截图](field-upgrades/evidence/v0.54.0-engineering-zh.jpg)。
- [工程 JSON](field-upgrades/evidence/v0.54.0-engineering.json) 原生下载与公开文本逐字节一致；错修订文件拒绝且现存资料保留；切换面板、刷新并恢复同一交付版本后，记录逐字节不变。跨站导入需先审阅替换，Cloudflare 重新计算相同反力和实测状态，导出内容一致。
- 外币人工报价 USD 10：缺少汇率时费用和单位成本未知。补齐来源、日期和汇率 7 后，运费 100、两托包装 10、人工 70，总计 CNY 180，按 8 箱分摊每箱 22.50。更换本位币确实清除原运费、包装价和汇率；[JSON](field-upgrades/evidence/v0.54.0-fleet.json) 与 [CSV](field-upgrades/evidence/v0.54.0-costs.csv) 原生下载通过。费用方案从 Vercel 导入 Cloudflare 并重新导出，跨站内容逐字节一致，[英文截图](field-upgrades/evidence/v0.54.0-costs-en.jpg)。
- 两站均实际运行 12 组 Worker 基准，全部模型校验通过，箱数／套数／重量／差距一致。现场整格为 22 箱、高密度 24；现场套装为 21 箱／7 套、高密度 24 箱／8 套。两种策略有不同限制，不能把现场差距判作装载校验失败。[Vercel 报告](field-upgrades/evidence/v0.54.0-benchmarks.json)、[Cloudflare 报告](field-upgrades/evidence/v0.54.0-benchmarks-cloudflare.json)及[截图](field-upgrades/evidence/v0.54.0-benchmarks-zh.jpg)。
- 基准如实暴露一项待优化差距：整托散箱案例现场 32 箱、高密度 31 箱，两者均可行。未修改夹具、策略边界或数字来掩盖差距；该有界启发式的更广联合搜索仍未完成。
- 两站恢复默认三 SKU、清除合成柜型并重新运行双算法；均为现场／高密度 116 箱、3842 kg、算法 0.54.0，当前现场方案、中文。最近 200 条浏览器日志中应用错误及警告均为 0，Vercel 本部署最近 30 分钟 error/fatal 运行日志未见记录。浏览器无 WebGL，仍使用真实坐标俯视图，真实 GPU 继续 PENDING。

详细检查与文件摘要见[验收 JSON](field-upgrades/evidence/v0.54.0-acceptance.json)。后续文档证据提交不修改上述运行代码。

## 保留限制

具体叉车操作仍按用户要求 EXCLUDED。U13、U17、U20、U23 的深化和全部其他未完项目见[未完成清单](field-upgrades/unfinished-roadmap.md)，本轮不把它们整体改为 DONE。GPU／多浏览器／实机试装、承重及设备资料仍需实际证据；账号、会员和付费接入仍为后续独立范围。Cloudflare 上轮发布缺口由本次自动部署恢复；未重试已拒绝的登录。
