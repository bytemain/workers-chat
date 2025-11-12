import manifestPlugin from 'esbuild-plugin-manifest';
import { createHash } from 'crypto';

export default {
  entrypoints: [
    {
      input: 'src/ui/index.html',
      output: './dist/ui',
      clean: true,
      bundle: true,
      external: ['tinybase'].join(','),
    },
    { input: 'src/ui/crypto.worker.js', output: './dist/ui' },
  ],
  assetNames: 'assets/[name]-[hash]',
  chunkNames: '[ext]/[name]-[hash]',
  plugins: [
    manifestPlugin({
      filename: 'manifest.json',
      append: true,
      // The `entries` object is what the contents of the manifest would normally be without using a custom `generate` function.
      // It is a string to string mapping of the original asset name to the output file name.
      generate: (entries) => {
        const manifest = {};

        for (const [source, file] of Object.entries(entries)) {
          const realFile = typeof file === 'string' ? file : file.file;

          manifest[source] = {
            file: realFile,
            hash: createHash('md5').update(realFile).digest('hex'),
          };
        }

        return manifest;
      },
    }),
  ],
};
