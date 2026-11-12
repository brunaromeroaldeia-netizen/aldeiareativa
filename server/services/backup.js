// Backup completo em JSON compactado (.json.gz) e cópias automáticas diárias.
// As cópias diárias ficam num armazenamento privado da Vercel (Vercel Blob), fora do banco:
// protegem contra perda do banco, importação errada ou exclusão acidental.
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { many } from '../db.js';
import { today } from '../lib/dates.js';

export const BACKUP_FORMAT = 'aldeia-reativa-json-1';
const PREFIX = 'backups/';
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);

export const automaticBackupsEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/** Gera o arquivo de backup (todas as tabelas do sistema). */
export async function buildBackup() {
  const tables = (await many(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename`)).map((t) => t.tablename);
  const out = { gerado_em: new Date().toISOString(), formato: BACKUP_FORMAT, tabelas: {} };
  for (const t of tables) {
    // o próprio Postgres gera o JSON: datas com precisão total, números exatos e binários em hexadecimal
    const r = await many(`SELECT coalesce(json_agg(x), '[]'::json) AS rows FROM "${t.replace(/"/g, '')}" x`);
    out.tabelas[t] = r[0].rows;
  }
  return { name: `aldeia-reativa-${today()}.json.gz`, data: zlib.gzipSync(Buffer.from(JSON.stringify(out))) };
}

const blob = () => import('@vercel/blob');

/** Grava a cópia do dia e apaga as mais antigas que o prazo de retenção. Idempotente. */
export async function saveDailyBackup() {
  if (!automaticBackupsEnabled()) return { skipped: 'armazenamento de backup não configurado' };
  const { put, list, del } = await blob();
  const { name, data } = await buildBackup();
  await put(PREFIX + name, data, { access: 'private', contentType: 'application/gzip', addRandomSuffix: false, allowOverwrite: true });
  const limit = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const old = (await listBackups()).filter((b) => b.date < limit);
  if (old.length) await del(old.map((b) => b.url));
  return { saved: name, size: data.length, removed: old.length };
}

export async function listBackups() {
  if (!automaticBackupsEnabled()) return [];
  const { list } = await blob();
  const items = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    items.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return items
    .map((b) => ({ name: b.pathname.slice(PREFIX.length), url: b.url, size: b.size, uploaded_at: b.uploadedAt, date: (b.pathname.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '' }))
    .filter((b) => b.date)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Envia uma cópia guardada para o navegador (sem carregar tudo na memória). */
export async function streamBackup(name, res) {
  if (!/^aldeia-reativa-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(name)) return false;
  const { get } = await blob();
  const r = await get(PREFIX + name, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return false;
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  Readable.fromWeb(r.stream).pipe(res);
  return true;
}
