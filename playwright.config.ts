import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a fake camera.
 *
 * Chromium's `--use-file-for-fake-video-capture` plays a Y4M file into
 * getUserMedia, which is the only way to exercise the real pipeline - permission
 * flow, worker startup, landmark extraction - without a human waving at a
 * webcam. Drop a recording at tests/fixtures/hand.y4m to run the recognition
 * specs; without it the specs that need landmarks skip themselves rather than
 * failing, so the suite stays green on a fresh clone.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    permissions: ['camera'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            ...(process.env.SIGNBRIDGE_FIXTURE
              ? [`--use-file-for-fake-video-capture=${process.env.SIGNBRIDGE_FIXTURE}`]
              : []),
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
