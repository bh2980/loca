import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';
import pRetry from 'p-retry';

export default defineConfig(async ({ command, isPreview }) => {
  const api = `http://127.0.0.1:${process.env.WORKBENCH_PORT ?? 4317}`;
  if (command === 'serve' && !isPreview) {
    // Startup readiness only: prevent the first page load from racing API initialization.
    console.info(`[dev] Waiting for API ${api}`);
    try {
      await pRetry(async () => {
        const response = await fetch(`${api}/api/projects`, { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
      }, { retries: Infinity, minTimeout: 250, maxTimeout: 1000, maxRetryTime: 30_000 });
    } catch (cause) {
      throw new Error(`API ${api}가 30초 안에 준비되지 않았습니다. API 서버의 시작 로그를 확인하세요.`, { cause });
    }
  }
  return {
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: {
      host: '127.0.0.1',
      port: 4318,
      proxy: {
        '/api': {
          target: api,
          changeOrigin: false,
          // The API is not up yet or is restarting: answer 503 (the app shows a notice and retries) instead of Vite's error log per request.
          configure: ((proxy) => {
            let down = false;
            proxy.on('error', (_error, _request, res) => {
              if (!down) console.info('[dev] API에 연결할 수 없습니다. 다시 연결될 때까지 503으로 응답합니다.');
              down = true;
              if (res && 'writeHead' in res && !res.headersSent) {
                res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: '서버에 연결하는 중입니다' }));
              } else res?.end?.();
            });
            proxy.on('proxyRes', () => {
              down = false;
            });
          }) satisfies ProxyOptions['configure'],
        },
      },
    },
  };
});
