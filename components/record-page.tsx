"use client";

import {useMemo,useState} from "react";
import {ChevronLeft,ChevronRight,Search} from "lucide-react";
import {tr,useLanguage} from "./language";

const normalize=(text:string)=>text.normalize("NFKC").trim().toLowerCase();

export function useRecordPage<T extends {search:string}>(records:T[],size=12,control?:{page:number;onPageChange:(page:number)=>void},resetKey?:string) {
  const [queryState,setQuery]=useState({key:resetKey,value:""});
  const query=queryState.key===resetKey?queryState.value:"";
  const [localPage,setLocalPage]=useState(0);
  const page=control?.page??localPage,setPage=control?.onPageChange??setLocalPage;
  const matches=useMemo(()=>{
    const words=normalize(query).split(/\s+/).filter(Boolean);
    return words.length?records.filter(r=>words.every(word=>normalize(r.search).includes(word))):records;
  },[query,records]);
  const pageCount=Math.max(1,Math.ceil(matches.length/size));
  const current=Math.min(page,pageCount-1);
  const start=current*size;
  return {query,changeQuery:(value:string)=>{setQuery({key:resetKey,value});setPage(0);},page:current,setPage,pageCount,
    count:matches.length,total:records.length,matches,start,end:Math.min(start+size,matches.length),rows:matches.slice(start,start+size)};
}

export function RecordPageControls({page,label,placeholder,disabled=false}:{page:ReturnType<typeof useRecordPage>;label:string;placeholder:string;disabled?:boolean}) {
  useLanguage();
  return <div className="record-page-controls">
    <label className="record-search"><Search size={15} aria-hidden="true"/><input type="search" disabled={disabled} aria-label={label} placeholder={placeholder} value={page.query} onChange={e=>page.changeQuery(e.target.value)}/></label>
    <span role="status">{page.count?`${page.start+1}–${page.end} / ${page.count.toLocaleString()} ${tr("条","records")}` : tr("没有匹配记录","No matching records")}{page.count!==page.total&&` · ${tr("总计","Total")} ${page.total.toLocaleString()}`}</span>
    {page.pageCount>1&&<div className="record-pagination" role="group" aria-label={tr("清单分页","List pagination")}>
      <button type="button" className="button small" aria-label={tr("上一页","Previous page")} disabled={disabled||page.page===0} onClick={()=>page.setPage(page.page-1)}><ChevronLeft size={15}/></button>
      <span>{page.page+1} / {page.pageCount}</span>
      <button type="button" className="button small" aria-label={tr("下一页","Next page")} disabled={disabled||page.page+1===page.pageCount} onClick={()=>page.setPage(page.page+1)}><ChevronRight size={15}/></button>
    </div>}
  </div>;
}
