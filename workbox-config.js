module.exports = {
  globDirectory: 'dist/ui',
  globPatterns: ['**/*.{js,css,html,json,png,svg,ico,woff,woff2}'],
  swDest: 'dist/ui/sw.js',
  ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
  // Runtime caching strategies
  runtimeCaching: [
    {
      // Cache API requests with NetworkFirst
      urlPattern: /^https?:\/\/.*\/api\/.*/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-cache',
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 5 * 60, // 5 minutes
        },
      },
    },
    {
      // Don't cache CDN assets - always fetch fresh
      urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/,
      handler: 'NetworkOnly',
    },
    {
      // Cache WebSocket upgrade requests (they'll fail but won't break)
      urlPattern: /^wss?:\/\/.*/,
      handler: 'NetworkOnly',
    },
  ],
  // Don't cache these patterns
  navigateFallback: null,
  navigateFallbackDenylist: [/^\/api\//, /^\/room\//],
};
