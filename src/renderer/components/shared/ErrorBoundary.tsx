import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (props: { error: Error; reset: () => void }) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }
    return this.props.children;
  }
}

// --- Fallback UI ---

interface ErrorFallbackProps {
  error: Error;
  reset: () => void;
  variant?: 'inline' | 'page';
}

export function ErrorFallback({ error, reset, variant = 'inline' }: ErrorFallbackProps): React.JSX.Element {
  if (variant === 'page') {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-bg-primary text-text-primary gap-4">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-text-secondary max-w-md text-center truncate">{error.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-accent/20 text-accent rounded hover:bg-accent/30"
        >
          Reload
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted text-sm p-4">
      <span>Something went wrong</span>
      <span className="text-xs text-text-muted/60 max-w-[300px] truncate">{error.message}</span>
      <button
        type="button"
        onClick={reset}
        className="mt-1 px-3 py-1 bg-accent/20 text-accent rounded text-xs hover:bg-accent/30"
      >
        Retry
      </button>
    </div>
  );
}
