// Restaura um backup .json.gz do Aldeia Reativa no banco de DATABASE_URL.
// ATENÇÃO: substitui TODOS os dados atuais do sistema pelos do arquivo.
// Uso: node scripts/restaurar-backup.js arquivo.json.gz --confirmar
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { BACKUP_FORMAT } from '../server/services/backup.js';

const file = process.argv[2];
if (!file || !process.argv.includes('--confirmar')) {
  console.error('Uso: node scripts/restaurar-backup.js arquivo.json.gz --confirmar\nSubstitui todos os dados atuais pelos do backup.');
  process.exit(1);
}
const raw = fs.readFileSync(file);
const backup = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString('utf8'));
if (backup.formato !== BACKUP_FORMAT) throw new Error(`Formato de backup desconhecido: ${backup.formato}`);

// garante a estrutura atual (o backup pode ser de uma versão anterior; as migrações do arquivo são restauradas depois)
await migrate();

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`)).rows.map((r) => r.tablename);
  const fks = (await client.query(`
    SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.contype = 'f' AND n.nspname = current_schema()`)).rows;
  // ordem de inserção: tabelas referenciadas antes das que as referenciam
  const strip = (t) => t.replace(/^.*\./, '').replace(/"/g, '');
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of fks) if (strip(child) !== strip(parent)) deps.get(strip(child))?.add(strip(parent));
  const order = [];
  const seen = new Set();
  const visit = (t, stack = new Set()) => {
    if (seen.has(t)) return;
    if (stack.has(t)) throw new Error(`Dependência circular entre tabelas: ${t}`);
    stack.add(t);
    for (const p of deps.get(t) || []) visit(p, stack);
    stack.delete(t); seen.add(t); order.push(t);
  };
  tables.forEach((t) => visit(t));

  await client.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const summary = {};
  for (const t of order) {
    const rows = backup.tabelas[t] && [...backup.tabelas[t]].sort((a, b) => (a.id ?? 0) - (b.id ?? 0)); // registros que apontam para outros da mesma tabela vêm depois
    if (!rows?.length) { summary[t] = 0; continue; }
    const cols = new Set((await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [t])).rows.map((r) => r.column_name));
    const keys = Object.keys(rows[0]).filter((k) => cols.has(k));
    const list = keys.map((k) => `"${k}"`).join(', ');
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((row) => {
        const o = {};
        for (const k of keys) {
          const v = row[k];
          o[k] = v && typeof v === 'object' && '$base64' in v ? `\\x${Buffer.from(v.$base64, 'base64').toString('hex')}` : v;
        }
        return o;
      });
      await client.query(`INSERT INTO "${t}" (${list}) SELECT ${list} FROM json_populate_recordset(NULL::"${t}", $1::json)`, [JSON.stringify(chunk)]);
    }
    // sequência do id continua de onde o backup parou
    if (cols.has('id')) {
      await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT max(id) FROM "${t}"), 1), (SELECT max(id) FROM "${t}") IS NOT NULL)
        WHERE pg_get_serial_sequence($1, 'id') IS NOT NULL`, [t]);
    }
    summary[t] = rows.length;
  }
  await client.query('COMMIT');
  console.log(`Backup de ${backup.gerado_em} restaurado.`);
  console.table(summary);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Restauração cancelada, nada foi alterado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
