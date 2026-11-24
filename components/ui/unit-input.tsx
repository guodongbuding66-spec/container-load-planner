"use client";
import type {ComponentProps} from "react";
import {NumericInput} from "../numeric-input";
export function UnitInput({unit,...props}:ComponentProps<typeof NumericInput>&{unit:string}){
 return <span className="unit-input"><NumericInput {...props}/><span className="unit-input-suffix" aria-hidden="true">{unit}</span></span>;
}
