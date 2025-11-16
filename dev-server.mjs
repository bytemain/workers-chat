import { serve, loadDevServerConfig } from '@chialab/rna-dev-server';
import { colors } from '@chialab/rna-logger';
import proxy from 'koa-proxies';
import path from 'node:path';
import HttpProxy from 'http-proxy';

async function main() {
  const root = './src/ui';
  const proxyServer = HttpProxy.createProxyServer();

  const serveConfig = await loadDevServerConfig({
    rootDir: root,
    middleware: [
      proxy('/api', {
        target: 'http://localhost:8787',
        changeOrigin: true,
        logs: true,
      }),
      proxy('/files', {
        target: 'http://localhost:8787',
        changeOrigin: true,
      }),
    ],
  });

  const server = await serve(serveConfig);

  // Handle WebSocket upgrade events
  if (server.server) {
    console.log('[dev-server] Setting up WebSocket proxy handler');

    server.server.on('upgrade', (req, socket, head) => {
      console.log('[dev-server] WebSocket upgrade request:', {
        url: req.url,
        headers: req.headers,
      });

      // Proxy WebSocket requests that start with /api
      if (req.url.startsWith('/api')) {
        console.log('[dev-server] Proxying WebSocket to http://localhost:8787');
        proxyServer.ws(
          req,
          socket,
          head,
          {
            target: 'http://localhost:8787',
            ws: true,
          },
          (err) => {
            console.error('[dev-server] WebSocket proxy error:', err);
            socket.destroy();
          },
        );
      } else {
        console.log('[dev-server] WebSocket not proxied, destroying socket');
        socket.destroy();
      }
    });

    proxyServer.on('error', (err, req, res) => {
      console.error('[dev-server] Proxy error:', err);
    });
  }

  serveConfig.logger?.log(`
    ${colors.bold('rna dev server started')}
  
    root:     ${colors.blue.bold(path.resolve(serveConfig.rootDir || root))}
    local:    ${colors.blue.bold(`http://${server.config.hostname}:${server.config.port}/`)}
  `);
}

main();
