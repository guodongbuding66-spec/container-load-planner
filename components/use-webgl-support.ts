"use client";

import { useSyncExternalStore } from "react";
import { supportsWebGL } from "../lib/packing/webgl-support";

const subscribe = () => () => undefined;
const getServerSnapshot = () => null;

export function useWebGLSupport(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribe, supportsWebGL, getServerSnapshot);
}
