"use client";

import { tr } from "./language";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  resetKey: string;
  fallback?: ReactNode;
};

type State = {
  failed: boolean;
};

export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("3D scene render failed", error, info.componentStack);
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="scene-shell" role="region" aria-label={tr("三维装柜视图")}>
          <div className="scene-fallback" role="alert">
            <strong>{tr("三维视图加载失败")}</strong>
            <span>{tr("装柜坐标、三视图、独立校验与导出仍可使用。可重试三维渲染。")}</span>
            <button className="button ghost small scene-error-action" type="button" onClick={() => this.setState({ failed: false })}>{tr("重新加载三维视图")}</button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
