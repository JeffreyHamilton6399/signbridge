import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support. `registerType: 'prompt'` means a new build never swaps under
// a running session - a model change mid-conversation would be worse than a
// stale build.
const updateSW = registerSW({
  onNeedRefresh() {
    // Deliberately quiet: the update applies on the next full load. Nothing
    // interrupts a session in progress.
    console.info('A new version of SignBridge is ready. Reload to use it.');
  },
  onOfflineReady() {
    console.info('SignBridge is ready to work offline.');
  },
});

void updateSW;
