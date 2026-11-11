import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate({ log = console.log } = {}) {
  // tudo numa transação com trava: várias instâncias do site (ex.: Vercel) podem iniciar ao mesmo tempo
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727201)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      try {
        await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch (e) {
        throw new Error(`Falha na migração ${f}: ${e.message}`);
      }
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      log(`[migrate] aplicada ${f}`);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate().then(() => { console.log('[migrate] banco atualizado'); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
