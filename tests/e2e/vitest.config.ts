import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

let hasJsdom = false;
try {
  require.resolve('jsdom');
  hasJsdom = true;
} catch {
  hasJsdom = false;
}

export default {
  plugins: [react()],
  test: {
    name: 'MediMate-E2E',
    include: ['tests/e2e/**/*.test.ts', 'tests/e2e/**/*.test.tsx'],
    globals: true,
    environment: hasJsdom ? 'jsdom' : 'node',
    setupFiles: [path.resolve(__dirname, './harness/setup.ts')],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default'],
    isolate: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
      '@harness': path.resolve(__dirname, './harness'),
    },
  },
};
