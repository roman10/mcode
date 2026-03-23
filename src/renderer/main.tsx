import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { MCodeAPI } from '@shared/types';
import './styles/global.css';

if (import.meta.env.DEV) {
  document.title = 'mcode [DEV]';
}

function hasMcodeApi(value: unknown): value is MCodeAPI {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<MCodeAPI>;
  return Boolean(
    candidate.pty &&
    candidate.sessions &&
    candidate.hooks &&
    candidate.layout &&
    candidate.app &&
    candidate.devtools,
  );
}

function renderStartupFailure(root: HTMLElement, message: string): void {
  document.title = 'mcode - startup error';
  root.innerHTML = `
    <div class="flex h-screen w-screen flex-col bg-bg-primary text-text-primary">
      <div class="h-[38px] shrink-0"></div>
      <div class="flex flex-1 items-center justify-center p-6">
        <div class="w-full max-w-xl rounded-lg border border-border-default bg-bg-secondary p-5 shadow-lg">
          <h1 class="text-lg font-semibold">Renderer startup failed</h1>
          <p class="mt-3 text-sm text-text-secondary">${message}</p>
          <p class="mt-2 text-xs text-text-muted">Check the Electron logs in the terminal for the preload failure, then restart the app.</p>
        </div>
      </div>
    </div>
  `;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Renderer root element not found');
}

const runtimeApi = (window as Window & { mcode?: unknown }).mcode;
if (!hasMcodeApi(runtimeApi)) {
  const message =
    'The preload bridge is unavailable, so the renderer cannot access the app APIs.';
  console.error(`Renderer startup failed: ${message}`);
  renderStartupFailure(rootElement, message);
} else {
  if (import.meta.env.DEV) {
    import('./devtools/ipc-bridge')
      .then(({ initDevtoolsBridge }) => initDevtoolsBridge())
      .catch((error) => console.error('Failed to initialize devtools bridge', error));
    import('./devtools/console-capture')
      .then(({ initConsoleCapture }) => initConsoleCapture())
      .catch((error) => console.error('Failed to initialize console capture', error));
    import('./devtools/hmr-capture')
      .then(({ initHmrCapture }) => initHmrCapture())
      .catch((error) => console.error('Failed to initialize HMR capture', error));
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
