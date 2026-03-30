// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary, ErrorFallback } from '../../../../src/renderer/components/shared/ErrorBoundary';

// Suppress React error boundary console.error noise in test output
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }): React.JSX.Element {
  if (shouldThrow) throw new Error('test render error');
  return <div>OK</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary fallback={({ error }) => <div>{error.message}</div>}>
        <div>child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('child content')).toBeDefined();
  });

  it('renders fallback when child throws', () => {
    render(
      <ErrorBoundary fallback={({ error }) => <div>Error: {error.message}</div>}>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Error: test render error')).toBeDefined();
  });

  it('calls onError callback when child throws', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary
        fallback={({ error }) => <div>{error.message}</div>}
        onError={onError}
      >
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('test render error');
  });

  it('recovers when reset is called', () => {
    let shouldThrow = true;
    function Conditional(): React.JSX.Element {
      if (shouldThrow) throw new Error('boom');
      return <div>recovered</div>;
    }

    render(
      <ErrorBoundary
        fallback={({ reset }) => <button onClick={reset}>retry</button>}
      >
        <Conditional />
      </ErrorBoundary>,
    );

    expect(screen.getByText('retry')).toBeDefined();

    // Fix the underlying issue, then retry
    shouldThrow = false;
    fireEvent.click(screen.getByText('retry'));

    expect(screen.getByText('recovered')).toBeDefined();
  });
});

describe('ErrorFallback', () => {
  it('renders inline variant by default', () => {
    const reset = vi.fn();
    render(<ErrorFallback error={new Error('oops')} reset={reset} />);
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('oops')).toBeDefined();
    expect(screen.getByText('Retry')).toBeDefined();
  });

  it('renders page variant with Reload button', () => {
    const reset = vi.fn();
    render(<ErrorFallback error={new Error('fatal')} reset={reset} variant="page" />);
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('fatal')).toBeDefined();
    expect(screen.getByText('Reload')).toBeDefined();
  });

  it('calls reset on Retry click (inline)', () => {
    const reset = vi.fn();
    render(<ErrorFallback error={new Error('oops')} reset={reset} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(reset).toHaveBeenCalledOnce();
  });
});
