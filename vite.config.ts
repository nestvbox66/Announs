import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function appVersion(): string {
  try {
    return JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version ?? 'dev';
  } catch {
    return 'dev';
  }
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export default defineConfig(() => {
  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion()),
      __GIT_COMMIT__: JSON.stringify(gitCommit()),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
