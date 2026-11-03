import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: [
    {
      command: 'node src/mock-sync-api.js',
      url: 'http://127.0.0.1:4174/health',
      reuseExistingServer: !process.env.CI,
      timeout: 15_000
    },
    {
      command: 'node src/skip-logic-fixture.js',
      url: 'http://127.0.0.1:4173/health',
      reuseExistingServer: !process.env.CI,
      timeout: 15_000
    }
  ]
});
