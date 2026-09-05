import base from './index_v132.js';

const VERSION = '1.3.3';

function wrapD1(db) {
  if (!db) return db;

  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'exec') {
        return async (sql) => {
          const text = String(sql || '').trim();
          if (!text) return { count: 0, duration: 0 };

          // Cloudflare D1 exec() separa consultas por saltos de línea, por lo que
          // los CREATE TABLE multilínea del Worker anterior terminaban como
          // "CREATE TABLE ... (" y producían SQLITE_ERROR: incomplete input.
          // Ejecutamos cada sentencia completa mediante prepare().run().
          const statements = text
            .split(';')
            .map(s => s.trim())
            .filter(Boolean);

          let last = null;
          for (const statement of statements) {
            last = await target.prepare(statement).run();
          }

          return last || { count: 0, duration: 0 };
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'HYPN Remote Image Auth',
        version: VERSION,
        databaseBinding: !!env.HYPN_DB
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const patchedEnv = Object.assign({}, env, {
      HYPN_DB: env.HYPN_DB ? wrapD1(env.HYPN_DB) : env.HYPN_DB
    });

    return await base.fetch(request, patchedEnv);
  }
};
