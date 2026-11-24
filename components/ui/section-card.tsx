"use client";
import {useId,type ReactNode} from "react";
export function SectionCard({title,children,className=""}:{title:ReactNode;children:ReactNode;className?:string}){
 const id=useId();return <section className={`section-card ${className}`} aria-labelledby={id}><header><h3 id={id}>{title}</h3></header><div className="section-card-body">{children}</div></section>;
}
