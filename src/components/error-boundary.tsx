import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render-time errors anywhere below it so the user sees a recovery
 * screen instead of a silent blank page. Logs the error to the console for
 * debugging — check DevTools Console when reproducing an issue.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("PANIC BUTTON crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background px-6 text-center gap-4">
          <p className="text-lg font-bold text-foreground">Terjadi kesalahan</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Ada masalah saat menampilkan halaman ini. Coba muat ulang — kalau alarm sedang aktif, tetap tenang dan hubungi kontak darurat secara langsung.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm"
          >
            Muat Ulang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
