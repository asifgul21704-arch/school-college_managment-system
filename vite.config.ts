import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function copySrcAssetsPlugin() {
  return {
    name: 'copy-src-assets',
    closeBundle() {
      const rootDir = import.meta.dirname ?? '.';
      const srcAssets = path.resolve(rootDir, 'src', 'assets');
      const distSrcAssets = path.resolve(rootDir, 'dist', 'src', 'assets');
      if (fs.existsSync(srcAssets)) {
        fs.mkdirSync(path.dirname(distSrcAssets), {recursive: true});
        fs.cpSync(srcAssets, distSrcAssets, {recursive: true});
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), copySrcAssetsPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname ?? '.', '.'),
      },
    },
    server: {
      // Permit the production Railway hostname when Vite middleware handles requests.
      allowedHosts: ['school-collegemanagment-system-production.up.railway.app'],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
