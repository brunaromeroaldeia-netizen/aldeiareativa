// Gera um backup do banco em ./backups (pg_dump formato custom) e mantém os 30 mais recentes.
// Restaurar: pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/arquivo.dump
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';

fs.mkdirSync(config.backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = path.join(config.backupDir, `aldeia-reativa-${stamp}.dump`);
const r = spawnSync('pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, `--dbname=${config.databaseUrl}`], { stdio: 'inherit' });
if (r.status !== 0) { console.error('Falha no backup (pg_dump instalado?)'); process.exit(1); }
console.log('Backup gerado:', file);
const keep = Number(process.env.BACKUP_KEEP || 30);
const files = fs.readdirSync(config.backupDir).filter((f) => f.endsWith('.dump')).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(config.backupDir, f));
