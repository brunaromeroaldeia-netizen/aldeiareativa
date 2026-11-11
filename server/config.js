import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://aldeia:devpass@localhost:5432/aldeia_reativa',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'uploads'),
  backupDir: process.env.BACKUP_DIR || path.join(root, 'backups'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 20),
  sessionDays: Number(process.env.SESSION_DAYS || 7),
  sessionIdleHours: Number(process.env.SESSION_IDLE_HOURS || 12),
  timezone: process.env.APP_TIMEZONE || 'America/Sao_Paulo',
  smtp: process.env.SMTP_HOST ? {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    from: process.env.SMTP_FROM || 'Aldeia Reativa <no-reply@localhost>',
  } : null,
};
