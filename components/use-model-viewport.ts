"use client";
import { useLayoutEffect, useRef, useState } from "react";

export function useModelViewport(initial={width:520,height:260}) {
  const host=useRef<HTMLDivElement>(null),[viewport,setViewport]=useState(initial);
  useLayoutEffect(()=>{if(!host.current)return;const observer=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;if(width>0&&height>0)setViewport(v=>v.width===width&&v.height===height?v:{width,height});});observer.observe(host.current);return()=>observer.disconnect();},[]);
  return {host,viewport};
}
