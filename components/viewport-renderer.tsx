"use client";
import type {ReactNode} from "react";
import {useWebGLSupport} from "./use-webgl-support";
import {SceneErrorBoundary} from "./scene-error-boundary";
import {tr,useLanguage} from "./language";
/** The workbench, package preview and dialogs share the same graphics gate. */
export function ViewportRenderer({children,fallback,resetKey}:{children:ReactNode;fallback:ReactNode;resetKey:string}){
 useLanguage();const supported=useWebGLSupport();
 if(supported===null)return <div className="scene-loading" role="status">{tr("正在检测三维图形能力…","Checking graphics support…")}</div>;
 if(!supported)return fallback;
 return <SceneErrorBoundary resetKey={resetKey} fallback={fallback}>{children}</SceneErrorBoundary>;
}
