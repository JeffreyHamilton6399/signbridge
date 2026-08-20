/**
 * Stand-in for vite-plugin-pwa's `virtual:pwa-register`.
 *
 * The virtual module only exists once the PWA plugin runs, which it does not
 * under vitest. Aliased in vitest.config.ts so src/pwa.ts can be imported and
 * tested without pulling in the whole plugin.
 */
export interface RegisterSWOptions {
  onNeedRefresh?(): void;
  onOfflineReady?(): void;
  onRegisteredSW?(url: string, registration: ServiceWorkerRegistration | undefined): void;
  onRegisterError?(error: unknown): void;
}

export function registerSW(_options: RegisterSWOptions = {}) {
  return async (_reload?: boolean) => {
    window.location.reload();
  };
}
