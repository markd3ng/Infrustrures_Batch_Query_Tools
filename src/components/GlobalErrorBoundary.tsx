import React from 'react';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export default class GlobalErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    message: ''
  };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : '发生未知错误';
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[GlobalErrorBoundary]', error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <section className="rounded-2xl border border-rose-300/25 bg-rose-500/10 p-6 text-rose-100 backdrop-blur transition-all duration-300">
        <h2 className="mb-2 text-lg font-semibold">页面发生异常</h2>
        <p className="mb-4 text-sm text-rose-100/90">
          我们已拦截本次错误，避免页面整体崩溃。你可以刷新页面后重试查询。
        </p>
        <p className="mb-5 rounded-lg border border-rose-200/25 bg-black/20 px-3 py-2 text-xs text-rose-100/90">
          错误信息：{this.state.message || '未知异常'}
        </p>
        <button
          type="button"
          onClick={this.handleReload}
          className="rounded-xl bg-rose-300/90 px-4 py-2 text-sm font-semibold text-slate-950 transition-all duration-300 hover:bg-rose-200"
        >
          刷新并重试
        </button>
      </section>
    );
  }
}
