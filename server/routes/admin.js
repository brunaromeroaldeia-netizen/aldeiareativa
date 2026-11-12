import { Router } from 'express';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { one } from '../db.js';
import { buildBackup, listBackups, streamBackup, saveDailyBackup, automaticBackupsEnabled } from '../services/backup.js';
import { ah, bad } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { loadDemo, removeDemo } from '../services/demo.js';
import { runScheduler } from '../services/scheduler.js';
import { today } from '../lib/dates.js';

const r = Router();

r.get('/demo', ah(async (_req, res) => {
  res.json(await one(`SELECT $1::boolean AS "allowLoad", (SELECT count(*) FROM contacts WHERE is_demo)::int AS contacts,
    (SELECT count(*) FROM opportunities WHERE is_demo)::int AS opportunities,
    (SELECT count(*) FROM campaigns WHERE is_demo)::int AS campaigns`, [config.allowDemo]));
}));

r.post('/demo', ah(async (req, res) => {
  if (!config.allowDemo) throw bad('Dados de demonstração desativados no site oficial.');
  try { res.json(await loadDemo(req.user.id)); } catch (e) { throw bad(e.message); }
}));

r.delete('/demo', ah(async (req, res) => res.json(await removeDemo(req.user.id))));

r.post('/scheduler/run', ah(async (_req, res) => res.json(await runScheduler())));

/** Backup completo do banco (pg_dump, formato custom). */
r.get('/backup', ah(async (req, res) => {
  await audit(req, 'backup_baixado', 'system', null);
  if (config.serverless) {
    const { name, data } = await buildBackup();
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.end(data);
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="aldeia-reativa-${today()}.dump"`);
  const dump = spawn('pg_dump', ['--format=custom', '--no-owner', `--dbname=${config.databaseUrl}`]);
  let failed = false;
  dump.on('error', () => { failed = true; if (!res.headersSent) res.status(500); res.end(); });
  dump.stderr.on('data', (d) => console.error('[backup]', String(d)));
  dump.stdout.pipe(res);
  dump.on('close', (code) => { if (code !== 0 && !failed) console.error('[backup] pg_dump terminou com código', code); });
}));

/** Cópias automáticas diárias (últimos 30 dias). */
r.get('/backups', ah(async (_req, res) => {
  res.json({ enabled: automaticBackupsEnabled(), backups: (await listBackups()).map(({ url, ...b }) => b) });
}));

r.post('/backups', ah(async (req, res) => {
  if (!automaticBackupsEnabled()) throw bad('Armazenamento de backup não configurado.');
  const result = await saveDailyBackup();
  await audit(req, 'backup_automatico_gerado', 'system', null, result);
  res.json(result);
}));

r.get('/backups/:name', ah(async (req, res) => {
  await audit(req, 'backup_baixado', 'system', null, { arquivo: req.params.name });
  if (!(await streamBackup(req.params.name, res))) throw bad('Cópia não encontrada.');
}));

export default r;
