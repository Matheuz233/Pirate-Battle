import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PW_PORT ?? 4173);

/** Profiling run (not part of the regular E2E suite): `npm run perf`. */
export default defineConfig({
  testDir: './perf',
  timeout: 10 * 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
      args: (process.env.PERF_GPU === '1' ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']).concat([
        '--enable-precise-memory-info',
        '--js-flags=--expose-gc',
      ]),
    },
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
