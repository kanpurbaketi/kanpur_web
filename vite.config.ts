import { defineConfig, loadEnv, type Plugin } from 'vite';
import { existsSync } from 'node:fs';

/** In development, /api/<name> runs api/<name>.ts, as Vercel does once deployed (the environment comes from .env). */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), ''));
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/api\/([a-z-]+)(?:[?/]|$)/.exec(req.url ?? '');
        const file = m && `api/${m[1]}.ts`;
        if (!file || !existsSync(file)) return next();
        try {
          const mod = await server.ssrLoadModule(`/${file}`);
          await mod.default(req, res);
        } catch (e) {
          console.error(e);
          if (!res.headersSent) { res.statusCode = 500; res.end('{"error":"server"}'); }
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  server: { port: 5180 },
  plugins: [devApi()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } },
  },
});
