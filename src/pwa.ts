/**
 * Service worker registration and the update path.
 *
 * The offline cache is what lets SignBridge work without a network. It is also
 * how a user ends up permanently stuck on a broken build, which is exactly what
 * happened: `registerType: 'prompt'` with an update handler that only wrote to
 * the console meant a shipped fix could never reach anyone who had already
 * loaded the app. Reloading served the same cached bundle every time.
 *
 * So: updates are still not applied under a running session — swapping the
 * model or the feature pipeline mid-conversation would be worse — but the user
 * is now *told*, visibly, with a button that takes the update. And there is a
 * hard reset in Settings for when the cache itself is the problem.
 */
import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';

interface UpdateState {
  /** A newer build is cached and waiting for a reload. */
  updateReady: boolean;
  offlineReady: boolean;
  /** Set once the user dismisses the banner; it returns on the next update. */
  dismissed: boolean;
  apply(): void;
  dismiss(): void;
  setUpdateReady(v: boolean): void;
  setOfflineReady(v: boolean): void;
}

let applyUpdate: (reload?: boolean) => Promise<void> = async () => {
  window.location.reload();
};

export const useUpdate = create<UpdateState>((set) => ({
  updateReady: false,
  offlineReady: false,
  dismissed: false,
  apply() {
    // Hands control to the waiting worker, which then reloads the page.
    void applyUpdate(true);
  },
  dismiss() {
    set({ dismissed: true });
  },
  setUpdateReady(updateReady) {
    set({ updateReady, dismissed: false });
  },
  setOfflineReady(offlineReady) {
    set({ offlineReady });
  },
}));

/** How often to ask the server whether a newer build exists. */
const UPDATE_CHECK_MS = 15 * 60 * 1000;

export function initServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  applyUpdate = registerSW({
    onNeedRefresh() {
      useUpdate.getState().setUpdateReady(true);
    },
    onOfflineReady() {
      useUpdate.getState().setOfflineReady(true);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Poll, and check again whenever the tab comes back to the foreground.
      // Without this a long-lived tab never learns that a fix shipped.
      setInterval(() => void registration.update(), UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
  });
}

/**
 * Nuclear option: unregister every service worker, delete every cache, reload.
 *
 * For when the cached build itself is broken and a normal reload keeps serving
 * it. This is the escape hatch that did not exist when it was needed.
 */
export async function hardReset(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.warn('Hard reset could not complete cleanly:', err);
  } finally {
    // Bypass any remaining HTTP cache for the shell itself.
    window.location.replace(`${window.location.pathname}?fresh=${Date.now()}`);
  }
}
