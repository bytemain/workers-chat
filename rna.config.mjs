export default {
    entrypoints: [
        { input: 'src/ui/index.html', output: './public', clean: true },
        { input: 'src/ui/crypto.worker.js', output: './public', }
    ],
    assetNames: 'assets/[name]-[hash]',
    chunkNames: '[ext]/[name]-[hash]',
}