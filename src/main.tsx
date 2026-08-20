import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initServiceWorker } from './pwa';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support. A new build never swaps under a running session, but the
// user is told visibly when one is waiting — see src/pwa.ts for why that
// matters more than it sounds.
initServiceWorker();
