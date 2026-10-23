import {deliveryPlanSignature} from "./delivery-identity";
import {SHAPE_LABELS} from "./cargo-shape";
import {formatMeasure,type Point3} from "./inspection";
import {parseMeasurements,serializeMeasurements,savedMeasureCurrent,savedMeasureValue,sectionedMeasurement,type SavedMeasurement} from "./saved-measurements";
import type {DimensionUnit} from "./scene-dimensions";
import type {PackingResult} from "./types";

export type MeasurementReportOptions={language:"zh"|"en";unit:DimensionUnit;precision:number;generatedAt?:string};
export type ReportField={text:string;emphasis?:boolean};
export type MeasurementReportEntry={record:SavedMeasurement;number:number;current:boolean;title:string;status:string;distance:string;value:ReturnType<typeof savedMeasureValue>;fields:ReportField[]};
export type MeasurementReport={language:"zh"|"en";unit:DimensionUnit;precision:number;generatedAt:string;scope:string;context:string[];notes:string[];entries:MeasurementReportEntry[];currentCount:number;staleCount:number};
/** Synchronous click-time snapshot. Subsequent edits, filters and language changes cannot alter it. */
export function createMeasurementReport(plan:PackingResult,items:SavedMeasurement[],options:MeasurementReportOptions):MeasurementReport {
  if(!["zh","en"].includes(options.language)||!["mm","cm","m"].includes(options.unit)||!Number.isInteger(options.precision)||options.precision<0||options.precision>3)throw Error("Invalid measurement report options");
  const generatedAt=options.generatedAt??new Date().toISOString();if(!Number.isFinite(Date.parse(generatedAt))||new Date(generatedAt).toISOString()!==generatedAt)throw Error("Invalid report time");
  const records=parseMeasurements(serializeMeasurements(items));if(!records.length)throw Error("No saved measurements");
  const en=options.language==="en",t=(zh:string,english:string)=>en?english:zh,scope=deliveryPlanSignature(plan),fmt=(n:number)=>formatMeasure(n,options.unit,options.precision),point=(p:Point3)=>p.map(fmt).join(" / ");
  const entries=records.map((m,i):MeasurementReportEntry=>{
    const value=savedMeasureValue(m),current=savedMeasureCurrent(m,plan,scope),basis=m.surface?t("规则实体直线距","Regular solid point distance"):sectionedMeasurement(m)?t("剖切外包络","Section envelope"):t("完整外包络","Full envelope"),mode=m.mode==="points"?t("两点距离","Point distance"):m.mode==="gap"?t("两箱间距","Carton gap"):t("柜壁距离","Wall clearance");
    const fields:ReportField[]=[
      {text:`${mode} | ${basis}`,emphasis:true},
      {text:`A (X / Y / Z): ${point(value.a)}`},{text:`B (X / Y / Z): ${point(value.b)}`},
      {text:`${t("分量","Components")} X / Y / Z: ${point(value.deltas)}`},
      {text:`${t("原始数值 mm","Raw values mm")}: A ${JSON.stringify(value.a)}; B ${JSON.stringify(value.b)}; d ${value.distance}`},
      {text:`${t("记录时间 UTC","Recorded UTC")}: ${m.createdAt}`},
      {text:`${t("记录编号","Record ID")}: ${m.id}`},
      {text:`${t("记录范围检测码","Recorded change marker")}: ${m.scope}`},
      {text:`${t("记录空间 L / W / H；壁间隙","Recorded space L / W / H; wall clearance")}: ${[m.space.length,m.space.width,m.space.height,m.space.clearance].map(fmt).join(" / ")}`},
      {text:`${t("视图显隐","View visibility")}: ${m.visible?t("显示","Shown"):t("隐藏；仍包含在报告","Hidden; included in this report")}`},
    ];
    if(m.snaps)fields.push({text:`${t("端点捕捉","Endpoint snaps")}: ${m.snaps.map(s=>s==="vertex"?t("顶点","Vertex"):s==="edge"?t("边","Edge"):t("面","Face")).join(" / ")}`});
    if(m.wall){const wall={"x-":t("柜头","Rear wall"),"x+":t("箱门","Door plane"),"y-":t("左侧","Left wall"),"y+":t("右侧","Right wall"),"z-":t("柜底","Floor"),"z+":t("柜顶","Ceiling")};fields.push({text:`${t("参考柜壁","Reference wall")}: ${wall[m.wall]} (${m.wall})`});}
    m.targets.forEach((target,j)=>{
      fields.push({text:`${t("对象","Target")} ${j+1} | ${target.kind==="pallet"?t("托盘","Pallet"):t("货物","Cargo")}: ${target.id}`,emphasis:true});
      const b=target.source,c=target.bounds;
      fields.push({text:`${t("来源 XYZ；尺寸","Source XYZ; size")}: ${point([b.x,b.y,b.z])}; ${point([b.dx,b.dy,b.dz])}`});
      if(sectionedMeasurement(m))fields.push({text:`${t("取点范围 XYZ；尺寸","Capture XYZ; size")}: ${point([c.x,c.y,c.z])}; ${point([c.dx,c.dy,c.dz])}`});
      if(m.surface){const spec=m.surface[j];fields.push({text:`${t("实体快照","Solid snapshot")}: ${t(...SHAPE_LABELS[spec.profile.cargoShape!])} | ${spec.orientation} | ${t("轴符号","Axis signs")}: ${spec.orientationSigns?.join(" / ")??t("默认正旋转","Default proper rotation")}`},{text:`${t("形状参数","Shape parameters")}: ${JSON.stringify(spec.profile)}`});}
    });
    return {record:m,number:i+1,current,title:m.name||`${t("测量","Measurement")} ${i+1}`,status:current?t("当前有效：与导出时方案一致","CURRENT: matches the plan at export"):t("需重新测量：历史快照，不用于当前箱位","REMEASURE: historical snapshot, not current positions"),distance:fmt(value.distance),value,fields};
  });
  const currentCount=entries.filter(e=>e.current).length;
  return {language:options.language,unit:options.unit,precision:options.precision,generatedAt,scope,currentCount,staleCount:entries.length-currentCount,entries,
    context:[`${t("生成时间 UTC","Generated UTC")}: ${generatedAt}`,`${t("查看方案","Viewed plan")}: ${plan.container.name} (${plan.container.id}) | ${plan.strategy==="practical"?t("现场","Practical"):t("高密度","High density")} | ${t("引擎","Engine")} ${plan.engineVersion}`,`${t("当前范围检测码","Current change marker")}: ${scope} | ${t("布局模型校验","Layout model validation")}: ${plan.validation.valid?t("通过","Passed"):t("未通过","Failed")}`,`${t("全部已保存记录","All saved records")}: ${entries.length} | ${t("当前","Current")}: ${currentCount} | ${t("需重测","Remeasure")}: ${entries.length-currentCount} | ${options.unit}, ${options.precision} ${t("位小数","decimals")}`],
    notes:[t("包含导出时全部已保存记录，包括隐藏及历史记录；状态按点击导出时的完整方案核对。","Includes all saved records at export, including hidden and historical entries. Status is checked against the complete plan when export is clicked."),t("实体两点为直线距离，不代表沿面长度或两件货物全局最短净距；两箱与柜壁测量仍使用外包络。","Solid point distances are straight lines, not surface lengths or global minimum cargo clearances. Carton gaps and wall clearances use envelopes."),t("线框投影仅定位各记录的来源快照和端点，不是装卸路径、承重核验或当前全柜图。历史图不得用于当前箱位。","Wireframe projections locate each recorded source snapshot and its endpoints. They are not access paths, bearing checks or a complete current load view. Historical diagrams are not current positions."),t("显示按所选单位与精度舍入；原始毫米值另列。PDF 为图像页面，不能恢复或合并记录，请另存测量 JSON 备份。","Display values use the selected units and decimals; raw millimetre values are also listed. PDF pages are images and cannot restore or merge records; keep the measurement JSON backup.")],
  };
}
