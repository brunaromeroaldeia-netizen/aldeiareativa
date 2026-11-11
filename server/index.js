import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { loadUser, requireAuth, requireAdmin } from './auth.js';
import { HttpError } from './lib/http.js';
import { startScheduler, runScheduler } from './services/scheduler.js';
import { ensureBlackFridayCampaign } from './services/blackFriday.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import productRoutes from './routes/products.js';
import settingsRoutes from './routes/settings.js';
import importRoutes from './routes/imports.js';
import contactRoutes from './routes/contacts.js';
import campaignRoutes from './routes/campaigns.js';
import templateRoutes from './routes/templates.js';
import participantRoutes from './routes/participants.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';

export async function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: config.isProd ? {
      directives: {
        defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"], connectSrc: ["'self'"], fontSrc: ["'self'", 'data:'],
      },
    } : false,
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const api = express.Router();
  // proteção CSRF: toda requisição que altera dados precisa do cabeçalho customizado
  api.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'aldeia-reativa') {
      return next(new HttpError(403, 'Requisição bloqueada.'));
    }
    next();
  });
  api.use(loadUser);
  // garante a agenda atualizada mesmo se o servidor ficou suspenso (no máximo 1x por minuto)
  let lastRun = 0;
  api.use((req, _res, next) => {
    if (req.user && Date.now() - lastRun > 60000) { lastRun = Date.now(); runScheduler().catch(() => {}); }
    next();
  });
  api.get('/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
  api.use('/auth', authRoutes);
  api.use(requireAuth);
  api.use('/users', userRoutes);
  api.use('/products', productRoutes);
  api.use('/settings', settingsRoutes);
  api.use('/imports', requireAdmin, importRoutes);
  api.use('/contacts', contactRoutes);
  api.use('/campaigns', campaignRoutes);
  api.use('/templates', templateRoutes);
  api.use('/participants', participantRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/reports', reportRoutes);
  api.use('/admin', requireAdmin, adminRoutes);
  api.use((_req, _res, next) => next(new HttpError(404, 'Rota não encontrada.')));
  app.use('/api', api);

  if (config.isProd) {
    const dist = path.join(config.root, 'dist');
    app.use(express.static(dist, { index: false, maxAge: '7d', immutable: true }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else if (process.env.NO_VITE !== '1') {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa', root: path.join(config.root, 'client') });
    app.use(vite.middlewares);
  }

  // erros
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Arquivo maior que ${config.maxUploadMb} MB.` });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
    console.error(`[erro] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Erro interno. Tente novamente; se persistir, avise a administradora.' });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await migrate();
  const bf = await ensureBlackFridayCampaign().catch((e) => { console.error('[inicial] campanha Black Friday', e.message); return null; });
  if (bf) console.log(`[inicial] campanha Black Friday de Mesa ${bf.created ? 'criada' : 'configurada'} (id ${bf.campaign_id})`);
  const app = await createApp();
  app.listen(config.port, () => console.log(`Aldeia Reativa rodando em http://localhost:${config.port} (${config.env})`));
  if (process.env.DISABLE_SCHEDULER !== '1') startScheduler(10);
}
