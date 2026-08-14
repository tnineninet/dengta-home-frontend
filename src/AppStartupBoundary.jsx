import { Component } from "react";
import { reloadApplication } from "./app-startup-recovery.js";

export function AppLoadingScreen() {
  return (
    <main className="app-startup-page" aria-busy="true" aria-live="polite">
      <div className="app-startup-mark" aria-hidden="true">灯</div>
      <strong>正在点亮你的家</strong>
      <span>载入聊天、记忆与伴侣空间…</span>
    </main>
  );
}

export function AppFailureScreen() {
  return (
    <main className="app-startup-page app-startup-failure" role="alert">
      <div className="app-startup-mark" aria-hidden="true">灯</div>
      <strong>这次没有顺利点亮</strong>
      <span>应用内容载入失败，账号和聊天数据不会因此丢失。</span>
      <button type="button" onClick={reloadApplication}>重新载入应用</button>
    </main>
  );
}

export class AppStartupBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    const name = String(error?.name || "Error").slice(0, 80);
    console.error("DengTa 应用界面载入失败", { name });
  }

  render() {
    return this.state.failed ? <AppFailureScreen /> : this.props.children;
  }
}
