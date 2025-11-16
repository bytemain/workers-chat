import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Plugin to copy static files from src/public to dist/ui
const copyStaticFilesPlugin = {
  name: 'copy-static-files',
  setup(build) {
    build.onEnd(() => {
      const publicDir = 'src/public';
      const outputDir = 'dist/ui';

      try {
        const files = readdirSync(publicDir);
        files.forEach((file) => {
          const fromPath = join(publicDir, file);
          const toPath = join(outputDir, file);

          if (statSync(fromPath).isFile()) {
            copyFileSync(fromPath, toPath);
            console.log(`✅ Copied: ${fromPath} → ${toPath}`);
          }
        });
      } catch (error) {
        console.error(`❌ Failed to copy public files:`, error.message);
      }
    });
  },
};

export default {
  entrypoints: [
    {
      input: 'src/ui/index.html',
      output: './dist/ui',
      clean: true,
      bundle: true,
      external: ['_tinybase', 'reefjs', 'marked'],
    },
    { input: 'src/ui/crypto.worker.js', output: './dist/ui' },
  ],
  assetNames: 'assets/[name]-[hash]',
  chunkNames: '[ext]/[name]-[hash]',
  plugins: [copyStaticFilesPlugin],
};
