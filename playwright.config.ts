import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['focused.spec.ts'],
  timeout: 5 * 60 * 1000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chrome-desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
});
