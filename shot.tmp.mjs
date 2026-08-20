import { chromium, devices } from '@playwright/test';

const out = process.argv[2];
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function shot(name, ctxOptions, steps) {
  const ctx = await browser.newContext({ ...ctxOptions, permissions: ['camera'] });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4173');
  await page.waitForSelector('[role=note]');
  await steps(page);
  await page.screenshot({ path: `${out}/${name}.png` });
  await ctx.close();
}

const start = async (page) => {
  await page.getByRole('button', { name: /turn on the camera/i }).click();
  await page.waitForTimeout(3000);
};

await shot('p1-portrait', devices['iPhone 13'], start);

await shot('p2-immersive', devices['iPhone 13'], async (page) => {
  await start(page);
  await page.getByRole('button', { name: 'Hide controls' }).click();
  await page.waitForTimeout(600);
});

await shot('p3-landscape', devices['iPhone 13 landscape'], start);

await shot('p4-settings', devices['iPhone 13'], async (page) => {
  await start(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(600);
});

await browser.close();
console.log('done');
