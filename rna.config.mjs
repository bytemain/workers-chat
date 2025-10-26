export default {
    entrypoints: [
        { input: 'src/ui/index.html', output: './dist/ui', clean: true },
        { input: 'src/ui/crypto.worker.js', output: './dist/ui', }
    ],
    assetNames: 'assets/[name]-[hash]',
    chunkNames: '[ext]/[name]-[hash]',
}