import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

if (import.meta.env.DEV) {
  import('./devtools/ipc-bridge').then(({ initDevtoolsBridge }) =>
    initDevtoolsBridge(),
  );
  import('./devtools/console-capture').then(({ initConsoleCapture }) =>
    initConsoleCapture(),
  );
  import('./devtools/hmr-capture').then(({ initHmrCapture }) =>
    initHmrCapture(),
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
