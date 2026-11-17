type Localized = readonly [zh: string, en: string];

export const guideCategories = {
  cargo: ["货物与订单", "Cargo & orders"],
  setup: ["柜型与打托", "Spaces & pallets"],
  review: ["看图与复核", "Views & review"],
  optimize: ["编辑与优化", "Editing & optimization"],
  delivery: ["交付与现场", "Delivery & field work"],
  project: ["备份与项目", "Backups & projects"],
} as const;

export type GuideCategory = keyof typeof guideCategories;
export type GuideTarget =
  | "products" | "setup" | "recipe" | "packaging" | "pallet-preview" | "rules"
  | "review" | "checks" | "pallets" | "coordinates"
  | "projects" | "loading" | "delivery" | "files" | "account";

export type GuideTopic = {
  id: string;
  category: GuideCategory;
  title: Localized;
  path: Localized;
  keywords: string;
  steps: readonly Localized[];
  tip?: Localized;
  target: GuideTarget;
};

export const guideTopics: readonly GuideTopic[] = [
  {
    id: "start", category: "cargo", target: "products",
    title: ["第一次做装柜方案", "Create your first load plan"],
    path: ["选柜型 → 选包装 → 货物与布置 → 查看方案", "Container → Packaging → Cargo & layout → Results"],
    keywords: "入门 快速开始 新手 新建 计算流程 使用流程 quick start getting started",
    steps: [
      ["在「选柜型」选择集装箱或车辆，核对柜内尺寸、柜门和净载重。只做打托可跳过选柜。", "Choose a container or vehicle under Container, then check interior dimensions, doorway and net payload. Skip vehicle selection for pallet-only work."],
      ["在「选包装」选择托盘、封板木箱或框架。随后在「货物与布置」录入箱规、毛重和数量，按需打开「包装与托内预览」。", "Choose a pallet, closed crate or frame under Packaging. Enter carton sizes, weights and quantities under Cargo & layout, then open Packaging & pallet preview if needed."],
      ["在「装箱方案」确认已装箱数、余货和校验结果。用 3D 和三视图复核后，下载 PDF 或导出坐标。", "On Loading plan, check loaded cartons, remainder and validation. Review the 3D and orthographic views, then download the PDF or export coordinates."],
    ],
  },
  {
    id: "import", category: "cargo", target: "products",
    title: ["录入 SKU、导入 Excel 或 CSV", "Add SKUs and import Excel or CSV"],
    path: ["货物清单 → 表格文件 / 导入 CSV / Excel", "Cargo manifest → Spreadsheet files / Import CSV / Excel"],
    keywords: "导入产品 批量导入 箱规 导入模板 xlsx csv spreadsheet 毛重 尺寸单位 CBM 数量",
    steps: [
      ["少量箱规可直接填写清单。批量录入时在「表格文件」下载 Excel 模板，填写外箱尺寸、单箱毛重和需求数量。", "Enter a few carton types directly. For bulk entry, download the Excel template under Spreadsheet files and enter dimensions, unit gross weights and quantities."],
      ["核对尺寸和重量单位。选择替换、追加或按 ID 更新数量，再点「导入 CSV / Excel」。导入后检查行数、套装比例和总重量。", "Check length and weight units. Choose replace, append or update quantities by ID, then use Import CSV / Excel. Review row count, kit ratios and total weight."],
      ["修改一组长宽高时可连续录入，离开尺寸输入区后提交。准备好再进下一步配置。", "Enter related dimensions together. They commit when you leave the dimension fields. Continue to setup when ready."],
    ],
  },
  {
    id: "kits", category: "cargo", target: "products",
    title: ["多箱套装与套内比例", "Multi-carton kits and pack ratios"],
    path: ["货物清单 → 多箱套装 / 套装编码和套内数量", "Cargo manifest → Multi-carton kit / Set code and cartons per set"],
    keywords: "成套 组套 组合装箱 一套三箱 1套3箱 多箱套装 套号 1:2:2 整套回滚 kit set ratio",
    steps: [
      ["用套装助手生成箱规，或让同一产品的各组成行使用相同「套装编码」。", "Use the kit builder to create carton rows, or assign the same set code to each component line."],
      ["为每种组成箱填「套内数量」。例如 A 每套 1 箱、B 每套 2 箱，订 50 套就填 A 50 箱和 B 100 箱。", "Enter cartons per set for each component. For 50 kits with one A and two Bs, enter 50 cartons of A and 100 of B."],
      ["确认清单显示的可组成套数，计算后在「完整套数校验」核对已装、未装及各组成箱明细。", "Check the number of complete kits in the manifest. After calculation, use the complete-set check to review loaded and remaining kits and component quantities."],
    ],
    tip: ["打托、散箱预留和托内编辑都会核对套装完整性。", "Palletizing, loose reservations and pallet edits all check kit completeness."],
  },
  {
    id: "order-rows", category: "cargo", target: "products",
    title: ["订单行、客户批次与必装优先级", "Order lines, customer lots and priority"],
    path: ["货物清单 → 订单行 / 优先级与必须底置", "Cargo manifest → Order row / Priority and floor-only"],
    keywords: "订单号 批次号 PO 行号 稳定ID 数量更新 必装 优先装 底置 order line batch priority",
    steps: [
      ["在 SKU 行点「订单行」，填写客户、批次和行参考号。同 SKU 的不同批次可以保留为独立订单行。", "Open Order row for the SKU and enter customer, batch and line reference. Keep different lots of a SKU on separate lines."],
      ["按真实作业要求标明必装、优先级或必须底置。较少的可用位置可能限制这些行的完成量。", "Set required status, priority or floor-only when the operation calls for them. Eligible positions can limit fulfillment."],
      ["需要批量更新需求时，先导出订单行 CSV，保留订单行 ID 后再按页面提示导入数量更新。", "For bulk quantity changes, export order-row CSV, preserve line IDs and follow the quantity update import prompts."],
    ],
  },
  {
    id: "orientation", category: "cargo", target: "products",
    title: ["箱体朝向、异型建模与承重", "Orientations, cargo models and bearing limits"],
    path: ["货物清单 → 朝向与规则", "Cargo manifest → Orientation & rules"],
    keywords: "侧翻 旋转 平放 禁倒 禁止上压 堆码 不可堆叠 圆柱 圆管 倾角 异形件 建模 实体模型 orientation tilt stackable",
    steps: [
      ["打开该 SKU 的「朝向与规则」，选货物类型和实际外形。录入圆柱或规则型件时，用预览核对轴向和外包络。", "Open Orientation & rules for the SKU. Choose the cargo type and shape. For a cylinder or modeled item, check its axes and envelope in the preview."],
      ["勾选允许的摆放方向。只能正放时保存对应方向；允许水平旋转时再增加相应方向。", "Select the allowed orientations. For upright-only cargo, retain the corresponding orientations and add rotations only if allowed."],
      ["核对可承托、纸箱层数和累计上压上限。保存后重新计算。", "Check stackability, carton layer cap and cumulative top load. Save, then recalculate."],
    ],
  },
  {
    id: "marks", category: "cargo", target: "products",
    title: ["自定义箱标图片和唛头文字", "Customize carton labels and shipping marks"],
    path: ["货物清单 → 朝向与规则 → 自定义箱标与唛头", "Cargo manifest → Orientation & rules → Custom carton label and shipping mark"],
    keywords: "唛头 码头 箱标 箱唛 箱贴 自定义图片 logo 标贴贴纸 png jpg webp 客户标识 shipping mark label artwork",
    steps: [
      ["在要修改的 SKU 行打开「朝向与规则」，展开「自定义箱标与唛头」。", "Open Orientation & rules for the SKU, then expand Custom carton label and shipping mark."],
      ["填写唛头文字，可上传不超过 8 MB 的 PNG、JPG 或 WebP。核对箱标预览后保存。", "Enter mark text and optionally upload a PNG, JPG or WebP up to 8 MB. Check the preview and save."],
      ["重新计算，在方案的 3D 工具条开启「箱标」。想还原时回到同一 SKU，点「恢复默认箱标」并保存。", "Recalculate and turn Labels on in the 3D toolbar. To undo, return to the SKU, restore its default label and save."],
    ],
    tip: ["箱面显示的客户唛头与交付版本的箱托编号、现场二维码分别设置。", "Carton-face marks, delivery identifiers and field QR codes have separate settings."],
  },
  {
    id: "space", category: "setup", target: "setup",
    title: ["选柜型、核对门洞和自定义装载空间", "Choose a vehicle, check the door and save a custom space"],
    path: ["选柜型 → 装载空间库", "Container → Space library"],
    keywords: "40HQ 40GP 20GP 货车 柜门 门宽 门高 安全间隙 净高 内尺寸 浏览装载空间库 container dimensions clearance door",
    steps: [
      ["选常用预设，或打开「装载空间库」选择货车、集装箱及已有自定义空间。", "Choose a common preset or open Space library to select a truck, container or saved custom space."],
      ["按实测填写柜内长、宽、高，门宽、门高和最大载重，设置安全间隙。展开「柜体模型与尺寸」核对方向。", "Enter measured interior and door dimensions and maximum payload. Set clearance and expand Container model and dimensions to check orientation."],
      ["以后重复使用时点「另存为自定义柜型」，填写可识别的名称。", "If you will reuse the dimensions, choose Save as custom space and enter a recognizable name."],
    ],
  },
  {
    id: "workflow", category: "setup", target: "setup",
    title: ["选择直接装箱、只打托或先打托后装箱", "Choose direct loading, pallet-only or palletize then load"],
    path: ["选柜型 → 装载方式", "Container → Loading method"],
    keywords: "装载方式 装载模式 底层铺托 落地托盘 只打托不装箱 先打托后装箱 单品最大装柜 direct load floor pallet",
    steps: [
      ["只需散箱入柜时选「直接装箱」。需要固定的底层托盘时，在第二步配置这些底座。", "Choose Direct load for loose cartons. Configure floor pallets in step two if the load needs fixed bases."],
      ["要先形成可搬运的整托、木箱再入柜时选「先打托后装箱」。只需要打托清单时选「只打托不装箱」并为启用规格填写货物限高。", "Choose Palletize then load to build complete units and load them into a vehicle. Choose Palletize only for a pallet manifest and set height limits for active specs."],
      ["单一箱型容量测算可选「单品单箱测算」。只打托结果里的整体坐标供编组查看，现场作业使用托内坐标和清单。", "Choose Single product capacity for a single carton type. Pallet-only global coordinates group units for viewing; use local pallet coordinates and the manifest in the field."],
    ],
  },
  {
    id: "auto-pallet", category: "setup", target: "recipe",
    title: ["几箱一托、自动尺寸与微调预览", "Size a pallet by carton count and fine-tune the preview"],
    path: ["货物与托内布置 → 按箱数自动打托", "Cargo & layout → Pallet sizing by carton count"],
    keywords: "自动打托 几箱一托 多少箱一托 每托箱数 每托装几箱 自动生成打托尺寸 推荐尺寸 重新建议尺寸 打托预览 微调 cartons per pallet recipe pallet sizing",
    steps: [
      ["在「装载空间」选「先打托后装柜」或「只打托」。选好打托包装后，在「货物与托内布置」选择要预览的 SKU 或整套货物。", "Choose Palletize then load or Palletize only under Load space. Pick the packaging, then choose the SKU or kit to preview under Cargo & layout."],
      ["填「每托箱数」，查看自动生成的整托外尺寸、箱数、层数和毛重，再比对底层俯视与堆码侧视。", "Enter Cartons per pallet. Review the suggested loaded dimensions, carton count, layers, gross weight, bottom plan and elevation."],
      ["实际规格不同就点「微调打托尺寸」，输入长宽、底座高和托内净高。达到目标箱数后点「采用打托方案」，再开始计算。", "Use Fine-tune pallet dimensions to enter measured length, width, deck and cargo height. When the target fits, apply the design and calculate."],
    ],
    tip: ["成套货物按完整套数打托。只改预览时，先采用或取消本次调整再计算。", "Kits are palletized whole. Apply or cancel the preview draft before calculating."],
  },
  {
    id: "whole-preview", category: "setup", target: "pallet-preview",
    title: ["整体打托预览与装柜前 3D 托内编辑", "Preview all pallets and edit them in 3D before loading"],
    path: ["货物与托内布置 → 打托预览与编辑", "Cargo & layout → Pallet preview & edits"],
    keywords: "生成整体打托预览 木箱对比 空木箱 整托预览 实装预览 托盘清单 尾托 3D托内编辑 装柜前移动 拖拽 人工摆放 应用托内布置 prepared manifest preview drag move cartons complete pallet loads manual layout",
    steps: [
      ["先采用自动打托方案，或填好实际包装尺寸、承重及库存。对照右侧模型的外尺寸和可用内部尺寸。", "Apply the pallet design or enter actual packaging dimensions, payload and stock. Check exterior and interior dimensions beside the empty model."],
      ["打开「包装与托内预览」，查看自动试排的箱数、托数和待打托箱数。修改尺寸后，右侧自动更新。", "Open Packaging & pallet preview to review prepared cartons, total units and remaining cartons. The preview refreshes after size changes."],
      ["从「预览托盘」切换托号，点「3D 托内编辑」。在模型中选箱拖动手柄，或输入 X/Y/Z 偏移再验证移动。需要查某箱时展开「托内箱号与坐标」。", "Choose a pallet and open Edit pallet in 3D. Select a carton and drag its handles, or enter and validate an X/Y/Z offset. Expand Carton identifiers and coordinates to find a specific carton."],
      ["点「应用托内布置」，然后点「开始计算」。两个算法均沿用已确认的托内位置。要重新自动摆箱，点「恢复自动打托」。", "Apply the pallet layout and start calculation. Both solvers keep approved positions inside each pallet. Use Return to automatic palletizing to regenerate positions."],
    ],
    tip: ["整体预览按已采用规格和预留散箱生成。整托最终能入柜多少还要看门洞、占地、堆叠和载重。", "The preview uses saved specs and loose reservations. Vehicle capacity also depends on door clearance, footprint, stacking and payload."],
  },
  {
    id: "stack-pallets", category: "setup", target: "packaging",
    title: ["整托上下堆叠与只装一层排查", "Stack complete pallets and diagnose a single tier"],
    path: ["货物与托内布置 → 已采用规格的整托堆叠 / 装箱方案 → 装载诊断与补货试算", "Cargo & layout → Stacking for the saved specification / Loading plan → Loading diagnosis and replenishment trials"],
    keywords: "只装底下一层 货只在底下一层 只装一层 装一层 装柜只有一层 柜里明明有空间却放不进第二层 怎么叠托 堆叠不上 托不能上下叠 整托上下堆叠 托内限高 18箱 16箱 上压 pallet stacking tiers one layer",
    steps: [
      ["区分托内纸箱层数和柜内整托层数。先在打托侧视确认每托箱数与托内净高，再展开「已采用规格的整托堆叠」。", "Separate carton layers inside a pallet from whole-pallet tiers in the vehicle. Check the pallet elevation and cargo ceiling, then open the saved stacking settings."],
      ["实物允许整托叠放时勾选「允许整托上下堆叠」，填写层数上限（0 按可用高度）和实际累计上压上限。自动打托预览里的同类设置需随该预览一起采用。", "If the units are stackable, allow loaded pallets to stack. Enter the tier cap (0 uses available height) and actual cumulative top load. Apply any draft stacking settings with the recipe."],
      ["重新计算后，在整托清单检查各托底座 Z。若仍只有一层，展开「托内限高与纸箱层数」，核对柜门、整托总高、可承托顶面、承重和规格数量。", "Recalculate and check every base Z in the manifest. For a single tier, expand Cargo ceilings and carton layers and check the door, loaded height, top contact, bearing limits and stock."],
    ],
    tip: ["录入实测额定资料后复核木箱角脚或托面承托路径。上压未填时，方案会提示哪些承重资料待核验。", "Review corner feet or deck load paths using measured ratings. If top-load data is missing, check the result for unverified bearing information."],
  },
  {
    id: "multiple-specs", category: "setup", target: "packaging",
    title: ["多规格包装、库存和尾托选择", "Multiple packaging specs, inventory and tail units"],
    path: ["打托包装 → 选择包装规格", "Packaging → Choose packaging specifications"],
    keywords: "新增包装规格 包装比选 包装库存 生成托盘上限 适用货物 SKU priority stock compact packaging mixed pallet",
    steps: [
      ["新增规格后命名，填每种可用数量，展开「适用货物」核对可用 SKU。0 个可用表示保留规格供查看。", "Name each new spec and enter its stock. Check Eligible products. A spec with zero availability remains visible for reference."],
      ["按列表顺序尝试包装，或选「自动比选：同货量优先小包装」，让尾量可以选小规格。", "Use list order or Compare candidates: compact at equal load, which lets smaller packaging compete for tails."],
      ["设置单 SKU／完整套装或允许多 SKU 混托，核对所有规格合计的生成上限。打开实时打托预览检查规格使用量。", "Set one SKU/whole kits or mixed SKU packing, and check the total unit limit. Open the live pallet preview to see spec usage."],
    ],
  },
  {
    id: "crate", category: "setup", target: "packaging",
    title: ["木箱、箱盖、外尺寸与包装模板", "Configure a crate, lid, exterior dimensions and templates"],
    path: ["货物与托内布置 → 包装规格与堆叠规则 → 包装结构", "Cargo & layout → Packaging specifications and stacking rules → Packaging structure"],
    keywords: "定制木箱 框架木箱 条板 封板 围板 箱盖 内部净高 外部总高 木箱模板 pallet crate lid frame",
    steps: [
      ["选底座和围护预设。按实物填写外长、外宽、围板或横档高度、底座高度以及独立盖板厚度。", "Choose base and enclosure presets. Enter actual exterior dimensions, collar or rail height, base height and independent lid thickness."],
      ["录入「木箱内部净高」或实际外部总高。对照右侧模型及可用内部尺寸，核对底座、货物和箱盖总高。", "Enter interior clear height or measured total exterior height. Check the model and usable interior, including deck, cargo and lid."],
      ["按实物填写包装总自重和每托承重。常用结构可填写模板名并「保存模板」。", "Enter actual packaging tare and payload. Name and save a template for frequently reused structures."],
    ],
  },
  {
    id: "feet", category: "setup", target: "packaging",
    title: ["托脚、无底板、进叉净空与托内支承件", "Pallet feet, open undersides, fork clearance and supports"],
    path: ["货物与托内布置 → 包装规格 → 底座实测与托盘载荷资料 / 托内实心支承件", "Cargo & layout → Packaging specs → Measured base and pallet load data / Solid supports inside packaging"],
    keywords: "托脚 托盘脚 四角脚 四角承压脚 叉车 进叉 叉孔 叉槽 底梁 无底板 单面托 垫木 支撑条 长条箱 bearing fork interface feet deck supports",
    steps: [
      ["选择符合实物的墩式、纵梁、实心底板或四角承压脚。按实物设置托盘底板结构和面板、底梁数量。", "Choose the actual block, stringer, solid base or four-foot design. Set the underside and board/runner counts to match the real pallet."],
      ["展开「底座实测与托盘载荷资料」，录入底座部件、额定载荷和进叉尺寸，核对有效通道与承压区域。", "Open Measured base and pallet load data. Record component dimensions, ratings and fork dimensions, then check clearance and load paths."],
      ["货物放在托内的额外垫木或实心支承上时，在「托内实心支承件」录入位置、尺寸、自重与承重。预览后核对真实货物支点。", "For blocking or solid supports inside a unit, enter positions, dimensions, weight and ratings under Solid supports inside packaging. Check the actual contact points."],
    ],
  },
  {
    id: "crate-bearing", category: "setup", target: "packaging",
    title: ["木箱额定资料、四角承压与叠放预检", "Crate ratings, corner contact and stacking preflight"],
    path: ["货物与托内布置 → 木箱额定资料与支承区 / 方案工具 → 装载优化 → 木箱叠放预检", "Cargo & layout → Crate ratings and bearing zones / Plan tools → Load optimization → Crate stack preflight"],
    keywords: "木箱叠放 角脚 四角路径 联合承托 上压承重 额定来源 木箱额定 匹配支承面 crate stack bearing preflight",
    steps: [
      ["在包装规格展开「木箱额定资料与支承区」。以实测资料填写承重区域、额定上压和来源，并核对允许的叠放规则。", "Open Crate ratings and bearing zones for the specification. Enter actual bearing areas, rated load and its source, and review permitted stacking."],
      ["生成方案后，在「木箱叠放预检（独立试算）」选要比较的完整木箱，核对各层的角区接触、受力路径和上压。", "After calculating, select complete units in Crate stack preflight. Review each tier's corner contact, load paths and top load."],
      ["用「查看叠放结构与路径」查看结构，必要时导出预检依据 JSON。若实际尺寸变化，更新资料后重做预检。", "Open the structural path view and export preflight evidence if needed. Update the data and rerun it when measured dimensions change."],
    ],
  },
  {
    id: "loose", category: "setup", target: "packaging",
    title: ["整托与散箱混装、预留整套尾数", "Mix complete pallet loads and reserved loose cartons"],
    path: ["货物与托内布置 → 包装规格与堆叠规则 → 整托与散箱混装", "Cargo & layout → Packaging specifications and stacking rules → Complete units and loose cartons"],
    keywords: "散装预留 散货 零散箱 拆托 尾数 尾箱 混装 loose cartons reservation",
    steps: [
      ["选「先打托后装箱」并展开「整托与散箱混装」。按 SKU 填写计划留作散装的箱数。", "Choose Palletize then load and expand Complete units and loose cartons. Enter the loose reservation per SKU."],
      ["套装的各组成 SKU 按相同完整套数预留。生成打托预览后，确认剩余货物进入整托，再计算装柜。", "Reserve the same whole-kit count across all components. Check the prepared-pallet preview for the remaining cargo, then calculate loading."],
      ["在结果的散箱混装清单中核对数量和坐标。散箱需有合适的独立位置和承托。", "Review quantities and coordinates in the loose manifest. Loose cartons need their own valid space and support."],
    ],
  },
  {
    id: "obstacles", category: "setup", target: "setup",
    title: ["柜内障碍、禁占区与固定附件", "Vehicle obstacles, keep-clear zones and securing accessories"],
    path: ["装载空间 → 柜内障碍与禁占区 / 整柜附件与固定预留", "Load space → Obstacles and keep-clear regions / Container accessories and securing reservations"],
    keywords: "轮包 冷机 台阶 障碍 禁占区 绑扎 气袋 干燥剂 挡木 垫料 防潮 实心支承 静载上限 安装依赖 obstacle securing dunnage desiccant floor support",
    steps: [
      ["按柜头、左壁、地板为原点，录入轮包或其他柜内障碍及必须留空区域的尺寸与坐标。", "Record obstacle and keep-clear dimensions from the container nose, left wall and floor."],
      ["展开「整柜附件与固定预留」，点「新增实体附件」或「新增安装预留」。在同一张卡填写计划重量、位置、长宽高及安装阶段。", "Open Container accessories and securing reservations. Add a physical accessory or installation reservation. Enter planned mass, position, dimensions and installation phase."],
      ["需要承托时勾选实心平顶支承并填写已知静载。展开「资料、货物关联与安装依赖」，录入资料来源、版本、关联货物或依赖。", "For a solid floor support, enable the declaration and enter the known static load. Open Source, associated cargo and dependencies for the source, revision and installation links."],
      ["重新计算，在结果的附件清单核对空间与重量，随后在现场作业核对中登记实际安装。", "Recalculate and review space and mass in the accessory manifest. Record actual installation in the field operation checks."],
    ],
  },
  {
    id: "rules", category: "setup", target: "rules",
    title: ["填充布局、搜索深度与底部承托比例", "Filling layout, search depth and bottom support"],
    path: ["货物与托内布置 → 装载规则", "Cargo & layout → Loading rules"],
    keywords: "承托面积 承托比例 深度搜索 纵深优先 逐层填充 大件优先 小件优先 现场易执行 高密度参考 support ratio search depth",
    steps: [
      ["通常先用自动布局和智能搜索。需要对比纵向或逐层装载时，选择相应布局后分别计算。", "Begin with automatic layout and smart search. To compare longitudinal or layer filling, select the layout and calculate each option."],
      ["按货物类型启用承托比例规则。按实际底部接触与包装资料设置，长条货物还需核对支点和悬空。", "Set bottom support ratios for the applicable cargo types. Use actual contact and packaging data, and verify long cargo contact and unsupported spans."],
      ["在结果切换「现场易执行」与「高密度参考」，对比同一订单的箱数、方向组合、重心和复核状态。", "Compare Field execution and High-density reference on the same order, including count, orientations, center of gravity and review status."],
    ],
  },
  {
    id: "long-support", category: "setup", target: "products",
    title: ["长条箱承托、实际支点与悬跨", "Set actual contacts and spans for long cartons"],
    path: ["货物清单 → 朝向与规则 → 长条箱承托与悬跨资料", "Cargo manifest → Orientation & rules → Long-carton support and span data"],
    keywords: "长条箱承托 长条货物 超长货物 支点 悬空 悬跨 长件 承托梁 long cargo span support",
    steps: [
      ["打开该箱型的货物设置，展开「长条箱承托与悬跨资料」，按实测填写允许支点和悬跨要求。", "Open the carton settings and use Long-carton support and span data to enter measured contact and span limits."],
      ["根据实际底座、托内垫木或柜内支承件录入支承尺寸和承重。重新计算，让模型核对箱底接触。", "Record actual base, deck blocking or vehicle supports and their ratings. Recalculate to check contact with the carton base."],
      ["展开方案复核中的「长条箱承托预检」，检查支点、悬空段和资料待核验项。", "Open Long-carton support preflight in the result review and inspect contacts, spans and outstanding evidence."],
    ],
  },
  {
    id: "targets", category: "setup", target: "setup",
    title: ["按体积和载重目标倒推数量", "Estimate order quantities from volume and payload targets"],
    path: ["货物与托内布置 → 计算偏好与计划目标", "Cargo & layout → Solver preferences and planning targets"],
    keywords: "目标利用率 体积倒推 载重倒推 计划量 经验装载率 单品最大量 统一建议 算术数量 target utilization arithmetic plan",
    steps: [
      ["展开「计算偏好与计划目标」，录入目标体积利用率和目标载重利用率，比较两个倒推值。", "Expand Solver preferences and planning targets. Enter target volume and payload utilization and compare the estimates."],
      ["混合订单可采用「将算术数量填入订单（随后计算）」，先核对各 SKU 和整套比例，再开始计算。", "For a mixed order, use Fill arithmetic quantities into order (calculate next). Review SKU/unit ratios before calculating."],
      ["实际可装量以所选方案通过独立校验的坐标为准，查看原目标、装箱结果和未装数量。", "Use checked positions in the selected plan as the actual feasible count. Compare target, loaded and remainder quantities."],
    ],
  },
  {
    id: "scene", category: "review", target: "review",
    title: ["3D 视角、三视图与逐箱播放", "3D cameras, orthographic views and sequence playback"],
    path: ["装箱方案 → 三维装载视图 / 三视图同步复核", "Loading plan → 3D loading view / Synchronized orthographic views"],
    keywords: "三维看图 3d 2d 正视 侧视 箱门视图 正交 透视 等轴测 全屏 播放 显示全部 保存图片 camera playback screenshot",
    steps: [
      ["用「透视投影」「正交投影」和视角快捷键查看柜内摆放。点下方俯视、侧视或箱门图可切换对应正交方向。", "Use perspective, orthographic projection and camera shortcuts. Click a top, side or door diagram to align the 3D camera."],
      ["用播放条逐箱查看当前箱号和坐标，或点「显示全部」检查各层和完整布局。", "Use playback to inspect current carton IDs and positions, or Show all to check the complete layout."],
      ["用「显示设置」调整模型与标注，在工具条可「保存图片」或进入「全屏」。", "Adjust model and annotation settings under Display settings, then use Save image or Fullscreen."],
    ],
  },
  {
    id: "isolate", category: "review", target: "review",
    title: ["选箱、选整托与孤立单箱／整托／同套", "Select and isolate a carton, pallet or kit"],
    path: ["装箱方案 → 三维装载视图 → 货物栏旁的选择与孤立按钮", "Loading plan → 3D loading view → Selection and isolation beside Cargo panel"],
    keywords: "隔离 单独显示 单独查看 孤立单箱 孤立整托 孤立同套 整托选中 恢复整柜 取消选择 pallet isolation isolate set carton",
    steps: [
      ["在「货物栏」旁选「选箱」或「选整托」，再点模型或左侧列表中的对象。", "Choose Cartons or Pallet loads beside Cargo panel, then select an object in the view or list."],
      ["按需要点「孤立单箱」「孤立整托」或「孤立同套」。在「属性与测量」核对当前对象的尺寸和归属。", "Choose Isolate carton, Isolate pallet load or Isolate product set. Check dimensions and membership in Inspect & measure."],
      ["点「恢复整柜」返回完整装柜视图。点「取消选择」清除当前选中对象。", "Click Show full load to restore the vehicle view. Use Clear selection to deselect the current object."],
    ],
    tip: ["视图内过滤和孤立仅改变查看范围，完整清单与导出仍按整个方案统计。", "View filtering and isolation only change what you see. Counts and exports use the complete plan."],
  },
  {
    id: "measure", category: "review", target: "review",
    title: ["显示尺寸、量净距、剖切与保存测量", "Show dimensions, measure clearance and section the view"],
    path: ["装箱方案 → 三维装载视图 → 尺寸 / 属性与测量", "Loading plan → 3D loading view → Dimensions / Inspect & measure"],
    keywords: "尺寸标注 尺寸线 标尺 mm 单位 线色 量尺 测量备份 最短距离 两点 实体净距 剖切 截面 measurement clearance ruler section",
    steps: [
      ["开「尺寸」显示柜体尺寸。选择货物后也会显示对象尺寸。工具栏可调整单位、字号、颜色和模型外观，窄窗口从「显示设置」展开。", "Turn on Dimensions for container dimensions. Selecting cargo adds its dimensions. Adjust units, text size, colors and appearance in the toolbar or open Display settings in a narrow window."],
      ["在「属性与测量」选测量方式，再按提示点模型上的点或对象。需要观察内部时在「剖切与隔离」设置方向和位置。", "Select a measurement mode in Inspect & measure, then pick points or objects as instructed. To inspect the interior, choose a section direction and position."],
      ["需要保留时命名并「保存当前测量」。用测量 JSON 备份或 PDF 交接已保存的测量。", "Name and save measurements you need to retain. Share saved measurements with their JSON backup or PDF."],
    ],
  },
  {
    id: "checks", category: "review", target: "checks",
    title: ["复核数量、重心、承重和装卸路径", "Review counts, center of gravity, bearing and access"],
    path: ["装箱方案 → SKU 装载明细 / 校验与提示 / 方案复核", "Loading plan → SKU breakdown / Checks & alerts / Plan review"],
    keywords: "校验不通过 未核验 数据一致性 重心偏移 运输固定 静态上压 装卸路径 复核数量 套数 仓库 validation center of gravity checks",
    steps: [
      ["先核对 SKU 已装、订单量和未装量，成套货物再核对「完整套数校验」。在「校验与提示」检查重心。", "Check loaded, ordered and remaining cartons per SKU, then review complete kits. Check center of gravity under Checks & alerts."],
      ["展开下方「方案复核」和「方案数据一致性」，查看数据、摆放限制、承重、装卸路径和固定各项的状态及受影响箱托。", "Expand Plan review and Plan data consistency below. Check status and affected units for data, geometry, bearing, access and securing."],
      ["按明细修正尺寸、位置或资料并重新计算。交付前逐项复核仍待确认的现场条件。", "Correct dimensions, positions or source data and recalculate. Review remaining field conditions before issuing the plan."],
    ],
  },
  {
    id: "handling", category: "review", target: "review",
    title: ["装卸顺序与设备搬运路径预检", "Preflight loading sequence and equipment paths"],
    path: ["装箱方案 → 属性与测量 → 装卸 → 装卸顺序与路径", "Loading plan → Inspect & measure → Access → Loading and unloading access"],
    keywords: "搬运动作 搬运路径 装卸顺序 叉车抬升 横移 转向 90度 进门 净空 设备动作 maneuver lift turn",
    steps: [
      ["选「装卸」，检查当前顺序和需要关注的箱托，核对柜门与前置承托关系。", "Select Access and inspect the order and flagged units, door clearance and support sequence."],
      ["展开「搬运路径条件」，按设备实际能力启用抬升、横移或水平转向，并填可用行程。", "Open Maneuver conditions and set lifting, lateral travel or horizontal turns and travel limits to match the equipment."],
      ["复核路径提示和受影响对象。应用可采用的顺序后复查现场实际设备和操作空间。", "Review path messages and affected units. After adopting an available sequence, check the actual equipment and working space."],
    ],
  },
  {
    id: "capacity", category: "review", target: "review",
    title: ["排查未装和零装载、试算还能补多少", "Diagnose unloaded cargo or zero loads and trial replenishment"],
    path: ["装箱方案 → 未装原因 → 查看详细诊断", "Loading plan → Unloaded cargo diagnosis → View detailed diagnosis"],
    keywords: "剩余容积 为什么装不下 零装载 少装 装不满 没装满 未装入原因 未装原因 每托箱数改了装柜数量没有变 每托箱数改了装柜数量没变 改了每托箱数还是18箱 补货 试算增加货量 CBM nonloaded remaining capacity trial",
    steps: [
      ["先看结果首屏的未装箱数和已确认限制，区分备托上限、已备未入柜、托内纸箱净高和整托层数。点「查看详细诊断」核对其他限制。", "Start with the remaining count and confirmed limits at the top of the results. Check preparation limits, pallets awaiting loading, carton clearance and pallet tiers. Open View detailed diagnosis for other constraints."],
      ["需要试算同类货物时，展开「装载诊断与补货试算」，点「试算增加货量（不改订单）」，查看候选及限制项。", "For similar cargo, open Loading diagnosis and replenishment trials and run Trial additional cargo (keep order). Review the candidate and its limiting constraints."],
      ["查看试算新增量和各 SKU 变化。在需要调整订单或包装时才采用候选并重新计算。", "Review additional quantities and SKU changes. Apply a candidate and recalculate when you need those order or packaging changes."],
    ],
  },
  {
    id: "edit-pallet", category: "optimize", target: "pallets",
    title: ["整托查看、托内移箱、转托和复制层", "Inspect and edit pallet contents and copy layers"],
    path: ["装箱方案 → 整托入柜与货物基准 → 点击托盘编号", "Loading plan → Pallet placement and cargo basis → Select a pallet ID"],
    keywords: "托内编辑 移动箱子 旋转箱子 精细调整 复制此层 实体层 转移托盘 余量 本托 选择整托 整托表 折叠整托清单 搜索整托 分页 pallet editor transfer copy layer search pallet manifest",
    steps: [
      ["点结果页上方「整托清单」直接展开明细，可按托号、包装规格、SKU 或套装搜索。点托号，勾选「启用托内编辑」。", "Open Pallet manifest from the results shortcuts. Search by pallet ID, packaging, SKU or kit, then open a pallet ID and enable editing."],
      ["在模型中选箱，或展开「托内箱号与坐标」勾选。可拖动手柄，或在「调整所选货物」输入 X/Y/Z 偏移后验证。这里也能水平旋转和复制层。", "Select cartons in the model or in Carton identifiers and coordinates. Drag the handles or enter and validate an X/Y/Z offset under Adjust selected cargo. Rotation and layer copying are available there too."],
      ["在「添加或转移货物」输入接收托盘的托内坐标。选择 SKU 从订单余量添加，或选目标托盘转移所选箱组。", "In Add or transfer cargo, enter coordinates local to the receiving pallet. Choose a SKU and add from the pool, or select a destination and transfer the selection."],
      ["核对预览及校验状态，点底部「采用托内调整」。需要恢复时在采用前点撤销或放弃调整。", "Review the preview and validation, then click Apply pallet edits in the footer. Use Undo or Discard before applying to revert changes."],
    ],
    tip: ["Z 从托面起算。涉及整套时一并移动、退回或复制套内组件。", "Z starts at the cargo deck. Kit operations account for all components."],
  },
  {
    id: "copy-pallet-layout", category: "optimize", target: "pallet-preview",
    title: ["批量套用托内摆放", "Copy pallet layout in bulk"],
    path: ["货物与托内布置 → 打托预览与编辑 → 3D 托内编辑", "Cargo & layout → Pallet preview & edits → Edit pallet in 3D"],
    keywords: "批量套用托内摆放 批量复制托内布局 整托复制 同规格套用 多托同步 一托复制多托 copy pallet layout duplicate pallet positions bulk pallet",
    steps: [
      ["打开一托，移动或旋转箱体并验证。展开「批量套用托内摆放」。", "Open a pallet, move or rotate its cartons and validate the edits. Expand Copy pallet layout in bulk."],
      ["按托号搜索、逐托勾选，或点「全选可套用托盘」。目标需要相同包装规格、订单行和套装构成。", "Search by pallet ID and select individual targets, or select all eligible pallets. Targets must match packaging, order rows and kit contents."],
      ["点「套用到已选托盘」。校验通过后，可用弹窗上方的「查看托盘」核对目标。撤销一次可回到批量套用前。", "Choose Copy to selected pallets. After validation, use View pallet to check any target. One undo restores the pre-copy draft."],
      ["点「应用托内布置」保存，再开始计算。也可在装箱方案的整托编辑器中套用，确认时点「采用托内调整」。", "Apply the pallet layout before calculating. You can also copy layouts in the results pallet editor, then choose Apply pallet edits."],
    ],
    tip: ["每托原有箱号、套号和货量保留。已锁定或已录入实测包络的目标会标示原因。", "Targets keep their carton and kit IDs and quantities. Locked targets and those with measured envelopes show their status."],
  },
  {
    id: "refill-pallet", category: "optimize", target: "pallet-preview",
    title: ["单托自动补货与新增箱位预览", "Automatic pallet refill and placement preview"],
    path: ["货物与托内布置 → 打托预览与编辑 → 3D 托内编辑；或装箱方案 → 整托清单 → 托盘编号", "Cargo & layout → Pallet preview & edits → Edit pallet in 3D, or Loading plan → Pallet manifest → Pallet ID"],
    keywords: "单托自动补货 托内自动补货 订单余量补箱 自动找箱位 余货 自动补一套 托盘空位 pallet refill top up unassigned stock complete kit",
    steps: [
      ["选择要补货的托盘，启用托内编辑，点「预览本托自动补货」。系统按包装规格和剩余箱数搜索订单余量，套装按整套补入。", "Select the pallet, enable editing and choose Preview automatic pallet refill. The search respects packaging and carton allowances and only adds complete kits."],
      ["查看可补箱数、整托高度和毛重，展开「查看新增箱位」核对托内 X/Y/Z。已有箱位与锁定状态会保留。", "Review the carton count, unit height and gross weight. Open View new carton positions to check local X/Y/Z. Existing positions and locks are preserved."],
      ["点「将补货结果写入草稿」，可用撤销／重做核对。装柜前点「应用托内布置」再计算，装柜后点「采用托内调整」更新方案。", "Use the refill in the draft. Undo and redo are available. Apply pallet layout before calculating, or Apply pallet edits to update an existing result."],
    ],
    tip: ["散箱预留保留。搜索会核对承托、载重、限高及其他托盘，已锁定或录入实测包络的托盘暂停自动补货。", "Loose reservations are preserved. The search checks support, loads, height and neighbouring pallets. Locked pallets and units with measured envelopes pause automatic refill."],
  },
  {
    id: "order-pallet-reduction", category: "optimize", target: "pallet-preview",
    title: ["全单自动减托与已入柜减托", "Consolidate order pallets or loaded pallets"],
    path: ["货物与托内布置 → 整体打托预览 → 全单自动减托；或装箱方案 → 已入柜减托", "Cargo & layout → Complete pallet preview → Consolidate order pallets, or Loading plan → Consolidate loaded pallets"],
    keywords: "全单自动减托 整单减托 自动合并尾托 托盘减重 已入柜减托 释放多托 pallet reduction order consolidation fewer pallets",
    steps: [
      ["实时打托预览出现后，点「全单自动减托」。装柜计算后，在「清单与导出」可对已入柜托盘试排减托。", "Once the live preview is ready, choose Consolidate order pallets. After calculating, open Manifests & exports to consolidate loaded pallets."],
      ["点「预览减托建议」，核对前后托数、保留箱数与减少的包装自重。展开「查看受影响托盘」，查看被释放的托号以及留用托盘的新毛重和高度。", "Preview pallet reduction and review the unit count, retained cartons and tare saved. Open Review affected pallets to see released IDs and remaining units' new weights and heights."],
      ["写入草稿后，可一次撤销整批试排。确认后应用托内布置再计算，或采用托内调整更新已入柜清单和导出。", "Use the reduction in the draft. One undo restores the batch. Apply pallet layout before calculating, or apply pallet edits to update the loaded manifest and exports."],
    ],
    tip: ["每轮最多释放 6 托。完整套装、锁定箱位和实测包络受保护。若还有候选，可再次试排。", "Each run releases up to six units. Complete kits, locked cargo and measured envelopes are protected. Run another search to check for further reductions."],
  },
  {
    id: "consolidate-pallets", category: "optimize", target: "pallet-preview",
    title: ["跨托联合重排与尾托合并", "Consolidate selected pallets and combine partial loads"],
    path: ["货物与托内布置 → 3D 托内编辑；或装箱方案 → 整托清单 → 托盘编号", "Cargo & layout → Edit pallet in 3D, or Loading plan → Pallet manifest → Pallet ID"],
    keywords: "跨托联合重排 跨托重排 尾托合并 减少托盘 释放一托 合并余托 重新分配托内货物 multi pallet consolidation combine partial pallets reduce pallet count",
    steps: [
      ["打开「跨托联合重排」，勾选 1–5 张要与当前托一起试排的托盘。可以按托号、SKU 或包装名称搜索。", "Open Consolidate selected pallets. Select one to five pallets to trial alongside the current unit. Search by pallet ID, SKU or packaging name."],
      ["点「预览联合重排」，核对拟释放的托盘、各托前后箱数和减少的包装自重。展开「查看调整箱位」检查转移和移动的箱号与坐标。", "Preview consolidation. Review the pallet to be released, before and after quantities and tare savings. Open View changed positions to check moved cartons and coordinates."],
      ["将通过校验的候选写入草稿，确认后应用托内布置或采用托内调整。一次撤销可恢复托盘及其原箱位。", "Use a validated candidate in the draft, then apply the pallet layout or pallet edits. One undo restores the released pallet and original carton positions."],
    ],
    tip: ["每次最多 6 托、240 箱，尝试释放一托。货量、箱号、整套和锁定箱位会保留；装柜后也会复核上层托盘的承托。", "Each trial considers up to six pallets and 240 cartons and tries to release one pallet. Quantities, carton IDs, complete kits and locked positions are preserved. Loaded tiers are checked for support."],
  },
  {
    id: "layers", category: "optimize", target: "pallets",
    title: ["层型模板、批量叠层和单托局部重排", "Layer templates, batch layers and local pallet repacking"],
    path: ["整托查看与托内编辑 → 层型模板与批量叠层 / 单托局部自动重排", "Pallet contents editor → Layer templates and batch stacking / Local pallet repacking"],
    keywords: "层型模板 模板叠层 批量复制层 异型层型 局部自动重排 重打托 单托 layer template local repack",
    steps: [
      ["启用托内编辑后，展开「层型模板与批量叠层」。选要保存的物理层或箱组，核对模板的货物和托面基准。", "Enable editing and open Layer templates and batch stacking. Choose a physical layer or cargo group, then check its item list and deck reference."],
      ["选择适用模板和层数，试排并检查余量、上方空位和承重。需要修整现有单托时，使用「单托局部自动重排」生成候选。", "Choose an applicable template and layer count, then trial and review remaining stock, vertical space and load checks. For an existing unit, generate candidates with Local pallet repacking."],
      ["只采用通过复核的候选，最后用「采用托内调整」更新装柜方案。", "Choose a reviewed candidate, then apply pallet edits to update the vehicle plan."],
    ],
  },
  {
    id: "edit-load", category: "optimize", target: "loading",
    title: ["手动调整箱位、锁定与空隙分析", "Edit and lock positions and inspect gaps"],
    path: ["三维属性栏 → 编辑 / 空隙 / 承重 / 装卸；方案工具 → 装载优化", "3D inspector → Edit / Gaps / Loads / Access; Plan tools → Load optimization"],
    keywords: "手动编辑 框选 多选 拖拽 网格 吸附 移箱 锁定箱位 空隙分析 试装搬运 承托热区 manual edit lock void gaps",
    steps: [
      ["计算方案后，打开属性栏的「编辑」并启用箱位编辑。选箱或多选，用坐标、旋转或手柄调整。", "After calculation, enable placement editing under Edit in the inspector. Select cargo and adjust offsets, rotation or handles."],
      ["查看验证结果并锁定必须保留的位置。切换「空隙」「承重」「装卸」检查候选空间、上压和作业路径。", "Check validation and lock positions that must stay fixed. Inspect Gaps, Loads and Access for candidate space, top loading and routes."],
      ["复核草稿后采用方案。需要继续比较时，到「手动调整箱位与锁定」查看同一草稿和相关试算。", "Review the draft and apply it. Use Manual placement and locks to access that draft and related trials."],
    ],
  },
  {
    id: "tail", category: "optimize", target: "review",
    title: ["尾数散箱与整托混装试算", "Trial loose tails alongside loaded pallets"],
    path: ["装箱方案 → 装载诊断与补货试算 → 尾数散箱与整托混装试算", "Loading plan → Loading diagnosis and replenishment trials → Trial loose tails alongside loaded pallets"],
    keywords: "尾数联合 尾数费用 尾数试算 新增散装 尾箱报表 loose tail trial",
    steps: [
      ["用现有方案展开尾数试算，选择订单行或完整套装和允许预留的数量，再选择搜索范围。", "Open the tail trial on the current plan. Select order rows or whole kits, the permitted quantities and a search range."],
      ["点「保持本单数量，比较尾数混装」，核对候选增量、包装用量、费用和五项复核。", "Compare loose tails for this order. Review added cargo, packaging use, costs and plan checks."],
      ["先保存候选报告，再决定是否采用。已发布或已锁定的方案按界面允许的实物保留与版本流程操作。", "Save the candidate report before choosing to adopt. Follow the available physical-retention and revision workflow for issued or locked plans."],
    ],
  },
  {
    id: "tolerances", category: "optimize", target: "loading",
    title: ["标称和保守尺寸、实测外包络", "Compare nominal, conservative and measured dimensions"],
    path: ["方案工具 → 装载优化 → 标称尺寸与保守尺寸对比", "Plan tools → Load optimization → Nominal and conservative dimensions"],
    keywords: "尺寸公差 实测偏差 保守包络 实测整托转向 名义尺寸 余量 安全尺寸 dimension tolerance measured envelope",
    steps: [
      ["在货物设置录入实测尺寸或允许偏差。计算后打开「标称尺寸与保守尺寸对比」。", "Enter measured dimensions or tolerances in cargo settings. After calculation open Nominal and conservative dimensions."],
      ["生成比较方案，逐项查看箱数、余量、姿态和限制变化。涉及整托实测时，在交付工具的实测整托复核中记录外包络。", "Run the comparison and check changes in quantity, remainder, orientation and constraints. For a measured pallet, record the envelope in the delivery engineering review."],
      ["选定业务口径后使用对应已校验方案，保留实测依据供出货复核。", "Use the reviewed plan for your chosen dimension basis and retain the measurement evidence."],
    ],
  },
  {
    id: "fleet", category: "optimize", target: "loading",
    title: ["整单多柜分配、自动优化与费用比较", "Allocate a full order across vehicles and compare costs"],
    path: ["方案工具 → 装载优化 → 整单多柜分配与费用比较", "Plan tools → Load optimization → Fleet allocation and cost comparison"],
    keywords: "多柜 拼柜 多车 分柜 整单优化 共享库存 运费 同币种 费用比较 柜型组合 已装柜前缀 fleet multi-container cost",
    steps: [
      ["为混合订单选择候选柜型、可用数量和统一币种的费用。有共用包装库存时填可用数量与相关费用。", "For a mixed order, enter candidate vehicle types, availability and costs in one currency, plus any shared packaging stock and costs."],
      ["生成比较或自动整单优化，检查每柜分配、完整套装、未装数量和费用。已有封存柜时通过自动优化保留已装前缀。", "Run a comparison or automatic optimization. Check per-vehicle allocation, kit completeness, remainder and costs. Preserve committed containers with automatic optimization."],
      ["采用已复核的分配并下载多柜备份。需要微调尾数时在对应试算入口查看柜间配额与新增费用。", "Apply the reviewed allocation and download a fleet backup. Use the applicable tail trial to compare quotas and additional costs."],
    ],
  },
  {
    id: "fleet-fill", category: "optimize", target: "loading",
    title: ["原柜补入散箱或整托，保留已装箱位", "Fill existing vehicle gaps with cartons or pallet loads"],
    path: ["方案工具 → 装载优化 → 整单多柜分配与费用比较 → 自动整单优化", "Plan tools → Load optimization → Fleet allocation and cost comparison → Automatic fleet optimization"],
    keywords: "余箱补位 原柜整托补入 原箱托不动 保留坐标 新增木箱 新增打托费 gap filling retain positions unit fill",
    steps: [
      ["生成当前整单多柜分配后，展开自动整单优化。在「优化方式」选择只补现有柜散箱或整托。", "Run fleet allocation, then open automatic fleet optimization and select loose or complete-unit gap filling."],
      ["核对要保留的前缀、余货与剩余包装，按需填写新增打托报价。预览后检查新增箱数、费用和入柜路径。", "Review the committed prefix, order remainder and packaging stock. Add preparation quotes as needed, then preview counts, costs and insertion paths."],
      ["采用通过复核的候选并保存多柜备份，核对原箱托及新增箱托的位置。", "Apply a reviewed candidate and save a fleet backup. Check both retained and newly placed units."],
    ],
  },
  {
    id: "fleet-handoff", category: "delivery", target: "loading",
    title: ["跨柜实物台账、逐件称重和交接备份", "Fleet unit ledger, unit weighing and handoff backup"],
    path: ["方案工具 → 装载优化 → 整单多柜分配与费用比较 → 跨柜实物台账与现场交接", "Plan tools → Load optimization → Fleet allocation → Fleet unit ledger and field handoff"],
    keywords: "跨柜实物身份 跨柜扫码 跨柜编号 跨柜台账 多柜交接 逐件核重 逐件实称 跨站恢复 fleet handoff unit weighing ledger",
    steps: [
      ["在已生成的多柜结果选要交付的柜，点「登记此柜交付版本」。导出跨柜实物台账 CSV，用柜号、版本和箱托编号交接。", "Select the vehicle in the fleet result and issue its revision. Export the fleet ledger and hand over vehicle IDs, revisions and unit IDs."],
      ["扫码定位柜和版本后逐件确认，按实物登记核重及作业记录。核对缺测或并行读数。", "Scan to find the vehicle and revision, then confirm units and record actual weights and operations. Review missing or concurrent readings."],
      ["下载多柜交接备份。另一设备用「恢复多柜交接备份」，确认原柜版本与同版本记录的合并结果。", "Download the fleet handoff backup. Restore it on the receiving device and review issued revisions and merged records."],
    ],
  },
  {
    id: "fleet-replace", category: "optimize", target: "loading",
    title: ["换柜与缺货包装替代", "Replace vehicles or unavailable packaging for the remainder"],
    path: ["方案工具 → 装载优化 → 跨柜实物台账与现场交接 → 换柜与缺货包装替代", "Plan tools → Load optimization → Fleet unit ledger and field handoff → Vehicle and packaging replacement"],
    keywords: "余货替代 换柜 缺货包装 少托 缺托 替代柜型 封存柜 已登记柜 replacement stock shortage",
    steps: [
      ["在当前多柜方案打开「换柜与缺货包装替代」。核对已登记、锁定或实测的保留前缀。", "Open Vehicle and packaging replacement in the fleet plan. Review the prefix covering issued, locked or measured loads."],
      ["选择后续余货可用的候选柜型，或指定本轮缺货包装，点「预览余货替代」。", "Choose a vehicle type for the remainder or identify unavailable packaging, then preview replacement."],
      ["比较逐订单行装载、库存、价格与校验。可采用时确认替代，并下载新的多柜交接备份。", "Compare per-line quantities, stock, cost and validation. Adopt when eligible and download the updated fleet handoff backup."],
    ],
  },
  {
    id: "export", category: "delivery", target: "coordinates",
    title: ["导出 PDF、装载坐标 CSV 或方案 JSON", "Export a PDF, placement CSV or plan JSON"],
    path: ["装箱方案 → 下载 PDF / 三维坐标与装载清单", "Loading plan → Download PDF / 3D coordinates and load manifest"],
    keywords: "下载 下载方案 打印指导书 输出坐标 excel PDF CSV JSON 导出灰色 折叠坐标清单 搜索箱位 查箱号 坐标分页 print export coordinates search carton positions",
    steps: [
      ["先选需要交付的算法结果，并确认计算完成、当前输入与已校验方案一致。", "Select the result you intend to share. Make sure calculation is complete and the inputs match the checked plan."],
      ["点「坐标与导出」展开箱位明细。输入 # 加序号可查某行，也可按 SKU、托号、套装或批次搜索。", "Open Coordinates & exports to view carton positions. Search by # and row number, SKU, pallet, kit or batch."],
      ["可在清单收起时下载完整坐标 CSV 和方案 JSON，也可下载 PDF 或打印指导书。", "Download the full CSV or plan JSON with the list collapsed. PDF and the print guide are also available."],
      ["要跨设备继续编辑，用顶部「文件与备份 → 备份工作区」。现场交接还可在「交付与现场」生成对应版本和指导书。", "Use Files & backups → Back up workspace to continue editing on another device. For field handover, generate the corresponding revision and guide under Delivery & field work."],
    ],
  },
  {
    id: "version", category: "delivery", target: "delivery",
    title: ["发布交付版本、箱托编号与二维码", "Issue delivery revisions, carton/pallet IDs and QR codes"],
    path: ["方案工具 → 交付与现场 → 交付版本与箱托编号", "Plan tools → Delivery & field work → Delivery versions and unit IDs"],
    keywords: "箱号 托号 交付版本 二维码 QR 追踪 跨柜实物身份 编号 标签 离线装柜指导 unit ID revision qr",
    steps: [
      ["确认当前方案通过必要复核，展开「交付版本与箱托编号」，登记方案并下载版本备份。", "Once required checks are complete, open Delivery versions and unit IDs, issue the plan and download its revision backup."],
      ["按该版本生成现场指导书及箱托资料。现场用对应版本和二维码核对实物身份。", "Generate the field guide and unit labels for the issued revision. Use that revision and its QR data to identify the physical units."],
      ["后续变更时发布下一版，保留旧编号、现场记录迁移依据和交接备份。", "When the plan changes, issue the next revision and retain previous identifiers, field migration evidence and backups."],
    ],
  },
  {
    id: "scan", category: "delivery", target: "delivery",
    title: ["扫码装货、异常登记与离线交接", "Scan loads, log exceptions and hand over offline"],
    path: ["方案工具 → 交付与现场 → 扫码与实际装载登记", "Plan tools → Delivery & field work → Scanning and field registration"],
    keywords: "扫码 二维码 确认已装 锁定已装 缺箱 照片 撤回 并行冲突 合并 离线事件 版本迁移 scan field events handover",
    steps: [
      ["打开已登记的交付版本，扫描或粘贴箱托二维码内容，核对当前单元及其明细。", "Open the issued revision, scan or paste unit QR content and check the selected unit and manifest."],
      ["登记确认已装、缺箱、损伤或撤回，必要时写明原因和证据。现场实物保留时，按工具入口锁定已装位置。", "Record loading, missing units, damage or reversals with reasons and evidence as needed. Lock loaded positions when the physical load must remain."],
      ["导出现场事件 JSON 或完整现场备份，换设备按同一方案版本导入合并。先核实冲突和迁移来源再确认。", "Export field-event JSON or a full field backup. Merge into the same revision on another device, checking conflicts and migration evidence first."],
    ],
  },
  {
    id: "engineering", category: "delivery", target: "delivery",
    title: ["地板载荷、配重、静态轴荷和整托实测", "Floor load, balance, static axle loads and measured units"],
    path: ["货物与托内布置 → 地板载荷与配重约束 / 方案工具 → 交付与现场 → 整托实测与静态轴荷复核", "Cargo & layout → Floor load and balance limits / Plan tools → Delivery & field work → Measured units and static axle review"],
    keywords: "轴荷 铰接 车辆轴组 分轴载荷 地板承重 偏载 重心 配重 实测整托 外包络 static axle floor load",
    steps: [
      ["按实测或车辆额定资料录入地板载荷与配重限制，生成方案后核对异常区域。", "Enter floor load and balance limits from measured or rated vehicle data, then check affected zones after calculation."],
      ["交付时打开「整托实测与静态轴荷复核」，记录整托外包络、车组空载和静态额定数据；需要时补充分轴实测分配。", "Open Measured units and static axle review for delivery. Record pallet envelopes, tare and static ratings, and measured per-axle shares if available."],
      ["复核超限和待核验状态后，保留本版本工程记录。用同一交付版本导出、导入工程复核备份。", "Check exceeded limits and outstanding reviews. Export and import engineering backups against the same delivery revision."],
    ],
  },
  {
    id: "weighing", category: "delivery", target: "delivery",
    title: ["实际核重、防潮与装卸作业登记", "Record weighing, moisture protection and operation checks"],
    path: ["方案工具 → 交付与现场 → 计划重量与实际核重 / 防潮、唛头与作业核对", "Plan tools → Delivery & field work → Planned weight and actual weighing / Moisture, marks and operation checks"],
    keywords: "核重 实称 实际重量 磅单 防潮 湿度 干燥剂 作业确认 安装拆除 核对记录 shipment weighing moisture operations",
    steps: [
      ["在核重面板分别核对计划货物、包装和附件重量，再按实称填写重量、来源和差额，追加核重记录。", "Review planned cargo, packaging and accessories separately, then append a weighing entry with actual weight, source and difference."],
      ["在作业核对面板按本版本附件顺序确认安装、拆除、唛头与防潮资料，记录异常或撤回原因。", "In operation checks, confirm installation, removal, marks and moisture evidence in the revision's accessory order. Record exceptions or reversal reasons."],
      ["交班时导出对应版本的核重和作业记录备份。遇并行分支时先核实原始记录再处理。", "Export weighing and operation backups for the revision when handing over. Review the original records before resolving concurrent changes."],
    ],
  },
  {
    id: "customer-report", category: "delivery", target: "delivery",
    title: ["生成客户中英文报告与现场指导书", "Create a customer report and field loading guide"],
    path: ["方案工具 → 交付与现场 → 客户中英文报告 / 现场装柜指导", "Plan tools → Delivery & field work → Customer report / Field loading guide"],
    keywords: "客户报告 中英文报告 客户报价 抬头 现场作业指导 打印 开柜 离线指导书 customer quote field guide",
    steps: [
      ["完成方案复核后打开「客户中英文报告」，选择语言，填写客户和报价资料。", "After reviewing the plan, open the customer report, select a language and enter customer and quote details."],
      ["预览并打印要交给客户的报告。给仓库用现场指导，核对对应算法、坐标顺序和当前交付版本。", "Preview and print the customer report. For warehouse work, use the field guide and check the strategy, positions, order and revision."],
      ["下载对应版本的交付文件，现场使用同一版的箱托编号与装载指令。", "Download the corresponding delivery files and use that revision's unit IDs and instructions on site."],
    ],
  },
  {
    id: "backup", category: "project", target: "files",
    title: ["备份工作区、恢复方案与迁移设备", "Back up, restore and move your workspace"],
    path: ["顶部 → 文件与备份", "Top bar → Files & backups"],
    keywords: "保存 本机草稿 备份 恢复 导入json 换电脑 迁移 文件 浏览器缓存 workspace backup restore local",
    steps: [
      ["在「文件与备份」点「备份工作区」并保存 JSON，保留箱规、柜型、包装、计算设置及可备份方案。", "Choose Back up workspace under Files & backups and save the JSON with carton data, vehicles, packaging, settings and eligible plans."],
      ["在另一设备打开「恢复工作区」，选择原备份。若提示确认，核对预览后点击确认恢复。", "On another device, choose Restore workspace and select the original backup. Review the preview before confirming when prompted."],
      ["检查恢复的输入和已校验结果。仅有输入时确认配置后重新计算。现场测量和作业记录可在各自工具单独备份。", "Check restored inputs and validated results. If you restored inputs only, confirm setup and recalculate. Back up measurement and field records from their own tools."],
    ],
  },
  {
    id: "library", category: "project", target: "projects",
    title: ["归档方案、产品包装版本与实装校准", "Archive plans, manage packaging versions and record field validation"],
    path: ["方案工具 → 项目与资料", "Plan tools → Projects & data"],
    keywords: "项目归档 产品库 历史方案 包装版本 标定 校准 固定业务基准 质量 现场验收 catalog archive benchmarking",
    steps: [
      ["在「方案归档与产品版本库」按批次或客户保存可重用方案；恢复前核对当前项目和候选版本。", "Save reusable work by customer or batch in the archive. Check the current project and the candidate version before restoring."],
      ["先计算通过校验的方案，再到「产品包装档案与实装验收」录入实装数量和条件。修正参考只匹配相同柜门、载重、货物、包装与算法设置。", "Calculate a validated plan, then record observed quantities and conditions under product packaging and field verification. Forecast adjustments match door clearance, payload, cargo, packaging and solver settings."],
      ["需要比较算法时运行「固定业务基准与算法质量」，查看同一案例的数量、耗时与复核状态。", "Run fixed business benchmarks to compare counts, times and review status for the same case."],
    ],
  },
  {
    id: "cloud", category: "project", target: "account",
    title: ["登录、私有云项目、版本和协作权限", "Sign in and manage private cloud projects and access"],
    path: ["顶部 → 账号与云项目", "Top bar → Account and cloud projects"],
    keywords: "登录 邮箱验证码 密码 私有项目 云存档 团队 组织 权限 会员 沙箱 share cloud sign in org",
    steps: [
      ["打开「账号与云项目」，按服务状态选择邮箱验证码或密码登录。云端功能依赖当前部署的账号服务。", "Open Account and cloud projects. When service is available, sign in by email code or password."],
      ["在有权限的组织内保存当前工作区的项目版本。恢复或打开共享版本时先查看内容再确认。", "Save a workspace revision in an organization where you have access. Review a restored or shared revision before confirming."],
      ["依角色管理协作和版本。云端服务未启用时可继续计算，并通过「文件与备份」保存与迁移。", "Manage access and revisions using assigned roles. If cloud service is disabled, use Files & backups to save and transfer your work."],
    ],
  },
];
