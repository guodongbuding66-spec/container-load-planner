"use client";

export function WorkbenchTabs<T extends string>({label,items,value,onChange}:{
  label:string; items:readonly (readonly [T,string])[]; value:T; onChange:(value:T)=>void;
}) {
  return <div className="workbench-tabs" role="group" aria-label={label}>
    {items.map(([id,name])=><button type="button" aria-pressed={value===id} key={id} onClick={()=>onChange(id)}>{name}</button>)}
  </div>;
}
