// "Servidor" da versão de testes: executa as MESMAS rotas e regras de negócio do backend
// (server/routes, server/services) dentro do navegador, sobre um PostgreSQL real (PGlite).
import { PGlite } from '@electric-sql/pglite';
import { setDatabase } from './shims/pg.js';
import { files } from './shims/fs.js';
import migrationSql from '../server/migrations/001_init.sql?raw';
import migration002 from '../server/migrations/002_atualizacao_oportunidades.sql?raw';
import migration003 from '../server/migrations/003_sequencia_e_situacao_cliente.sql?raw';
import { runBlackFridayUpdate } from '../server/services/blackFriday.js';
import { Router } from './shims/express.js';
import { loadUser, requireAuth, requireAdmin, hashPassword, COOKIE } from '../server/auth.js';
import { HttpError, ah } from '../server/lib/http.js';
import { one, query } from '../server/db.js';
import { runScheduler } from '../server/services/scheduler.js';
import { loadDemo, removeDemo } from '../server/services/demo.js';
import authRoutes from '../server/routes/auth.js';
import userRoutes from '../server/routes/users.js';
import productRoutes from '../server/routes/products.js';
import settingsRoutes from '../server/routes/settings.js';
import importRoutes from '../server/routes/imports.js';
import contactRoutes from '../server/routes/contacts.js';
import campaignRoutes from '../server/routes/campaigns.js';
import templateRoutes from '../server/routes/templates.js';
import participantRoutes from '../server/routes/participants.js';
import dashboardRoutes from '../server/routes/dashboard.js';
import reportRoutes from '../server/routes/reports.js';

export const TEST_USERS = [
  { name: 'Bruna', email: 'admin@aldeia.teste', role: 'admin', password: 'Admin2026teste', label: 'Bruna (administradora)' },
  { name: 'Letícia', email: 'leticia@aldeia.teste', role: 'vendedora', password: 'Leticia2026teste', label: 'Letícia (vendedora)' },
  { name: 'Giovana', email: 'giovana@aldeia.teste', role: 'vendedora', password: 'Giovana2026teste', label: 'Giovana (vendedora)' },
];

const DB_NAME = 'idb://aldeia-reativa-teste';
let db;
let persistent = false;

// ---------------- banco ----------------
async function loadBinary(name) {
  const r = await fetch(name);
  if (!r.ok) throw new Error(`Arquivo ${name} não carregou (${r.status}).`);
  return r.arrayBuffer();
}

async function seed(progress) {
  progress?.('Criando estrutura do banco…');
  const sql = migrationSql.replace(/CREATE EXTENSION[^;]*;/, '').replace(/CREATE INDEX contacts_name_trgm[^;]*;/, '');
  await db.exec(sql);
  await db.exec(migration002);
  await db.exec(migration003);
  progress?.('Criando usuárias de teste…');
  for (const u of TEST_USERS) {
    await query('INSERT INTO users(name, email, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,FALSE)', [u.name, u.email, u.role, await hashPassword(u.password)]);
  }
  progress?.('Gerando base de demonstração…');
  const admin = await one(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  await loadDemo(admin.id);
  await runScheduler();
}

export async function boot(progress) {
  progress?.('Carregando banco de dados…');
  const [wasm, initdb, data] = await Promise.all([loadBinary('pglite.wasm'), loadBinary('initdb.wasm'), loadBinary('pglite-data.wasm')]);
  const [pgliteWasmModule, initdbWasmModule] = await Promise.all([WebAssembly.compile(wasm), WebAssembly.compile(initdb)]);
  const opts = {
    pgliteWasmModule, initdbWasmModule, fsBundle: new Blob([data]),
    parsers: { 1082: (v) => v, 1700: (v) => (v === null ? null : Number(v)), 20: (v) => Number(v) },
    serializers: { 114: (x) => (typeof x === 'string' ? x : JSON.stringify(x)), 3802: (x) => (typeof x === 'string' ? x : JSON.stringify(x)) },
  };
  try {
    db = await PGlite.create(DB_NAME, { ...opts, relaxedDurability: true });
    persistent = true;
  } catch (e) {
    console.warn('[teste] armazenamento do navegador indisponível, usando memória', e);
    db = await PGlite.create('memory://', { ...opts, fsBundle: new Blob([data]) });
    persistent = false;
  }
  setDatabase(Promise.resolve(db));
  await db.exec(`SET TIME ZONE 'America/Sao_Paulo'`);
  const exists = await db.query(`SELECT to_regclass('public.users') AS t`);
  if (!exists.rows[0].t) await seed(progress);
  else {
    // atualiza ambientes de teste já existentes, preservando tudo o que foi feito (idempotente)
    progress?.('Aplicando atualizações…');
    await db.exec(migration002);
    await db.exec(migration003);
  }
  try {
    const bf = await runBlackFridayUpdate();
    if (bf) console.info('[teste] pacote Black Friday aplicado', bf);
  } catch (e) {
    console.error('[teste] atualização da Black Friday não aplicada', e); // nunca impede a abertura do sistema
  }
  await persist(); // garante que a carga inicial e as atualizações ficaram gravadas
  return { persistent };
}

/** Grava no armazenamento do navegador e só retorna quando a gravação terminou. */
async function persist() {
  if (!persistent) return;
  try { await db.fs.syncToFs(false); } catch { await db.syncToFs(); }
}

export async function resetEnvironment(progress) {
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  files.clear();
  writeCookies({});
  await seed(progress);
  await persist();
}

// ---------------- sessão (cookie simulado) ----------------
const COOKIE_KEY = 'aldeia-reativa-teste:sessao';
let memoryCookies = {};
function readCookies() {
  try { return JSON.parse(localStorage.getItem(COOKIE_KEY) || '{}'); } catch { return memoryCookies; }
}
function writeCookies(c) {
  memoryCookies = c;
  try { localStorage.setItem(COOKIE_KEY, JSON.stringify(c)); } catch { /* sem armazenamento: só memória */ }
}

// ---------------- rotas (mesma montagem de server/index.js) ----------------
const sandboxAdmin = Router();
sandboxAdmin.get('/demo', ah(async (_req, res) => {
  res.json(await one(`SELECT (SELECT count(*) FROM contacts WHERE is_demo)::int AS contacts,
    (SELECT count(*) FROM opportunities WHERE is_demo)::int AS opportunities,
    (SELECT count(*) FROM campaigns WHERE is_demo)::int AS campaigns`));
}));
sandboxAdmin.post('/demo', ah(async (req, res) => {
  try { res.json(await loadDemo(req.user.id)); } catch (e) { throw new HttpError(400, e.message); }
}));
sandboxAdmin.delete('/demo', ah(async (req, res) => res.json(await removeDemo(req.user.id))));
sandboxAdmin.post('/scheduler/run', ah(async (_req, res) => res.json(await runScheduler())));
sandboxAdmin.get('/backup', (_req, _res, next) => next(new HttpError(400, 'Backup do banco disponível apenas na versão oficial (servidor).')));

const api = Router();
api.use((req, _res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'aldeia-reativa') return next(new HttpError(403, 'Requisição bloqueada.'));
  next();
});
api.use(loadUser);
api.get('/health', (_req, res) => res.json({ ok: true, sandbox: true, persistent }));
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
api.use('/admin', requireAdmin, sandboxAdmin);

// ---------------- adaptador de requisições ----------------
function makeRes(resolve) {
  const res = {
    statusCode: 200, headers: {}, headersSent: false, finished: false,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    cookie(name, value) { writeCookies({ ...readCookies(), [name]: value }); return this; },
    clearCookie(name) { const c = readCookies(); delete c[name]; writeCookies(c); return this; },
    json(d) { this.headers['content-type'] = 'application/json'; this.finish(JSON.stringify(d)); },
    send(body) {
      if (body && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) return this.json(body);
      this.finish(body instanceof Uint8Array ? new Blob([body]) : body);
    },
    download(path, name) {
      const data = files.get(path);
      if (!data) return this.status(404).json({ error: 'Arquivo de origem indisponível nesta sessão de testes.' });
      this.setHeader('content-disposition', `attachment; filename="${name}"`);
      this.setHeader('content-type', 'application/octet-stream');
      this.finish(new Blob([data]));
    },
    end() { this.finish(null); },
    finish(body) {
      if (this.finished) return;
      this.finished = true; this.headersSent = true;
      resolve(new Response(body ?? null, { status: this.statusCode, headers: this.headers }));
    },
  };
  return res;
}

function sendError(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Arquivo grande demais.' });
  console.error('[teste] erro', err);
  return res.status(500).json({ error: `Erro interno: ${err?.message || err}` });
}

let lastSchedulerRun = 0;
async function doHandle(method, rawUrl, headers, body) {
  if (Date.now() - lastSchedulerRun > 60000) {
    lastSchedulerRun = Date.now();
    try { await runScheduler(); } catch (e) { console.warn('[teste] agenda', e); }
  }
  const u = new URL(rawUrl, 'http://aldeia.teste');
  let parsedBody = {};
  let file;
  if (body instanceof FormData) {
    const f = body.get('file');
    if (f && typeof f !== 'string') file = { buffer: Buffer.from(await f.arrayBuffer()), originalname: f.name, size: f.size };
  } else if (typeof body === 'string' && body) {
    try { parsedBody = JSON.parse(body); } catch { return new Response(JSON.stringify({ error: 'JSON inválido.' }), { status: 400, headers: { 'content-type': 'application/json' } }); }
  }
  const req = {
    method, originalUrl: u.pathname + u.search, url: u.pathname + u.search, path: u.pathname.replace(/^\/api/, '') || '/',
    query: Object.fromEntries(u.searchParams), params: {}, headers, body: parsedBody, file, ip: 'navegador (teste)',
    cookies: readCookies(), get: (n) => headers[n.toLowerCase()],
  };
  const response = await new Promise((resolve) => {
    const res = makeRes(resolve);
    api.handle(req, res, (err) => { if (!res.finished) sendError(res, err || new HttpError(404, 'Rota não encontrada.')); });
  });
  // toda ação que altera dados só termina depois de gravada no navegador (fechar a página logo em seguida não perde nada)
  if (method !== 'GET') await persist();
  return response;
}

// requisições executadas uma de cada vez (o banco do navegador tem uma única conexão)
let queue = Promise.resolve();
export function handle(method, url, headers, body) {
  const p = queue.then(() => doHandle(method, url, headers, body));
  queue = p.catch(() => {});
  return p;
}

export { COOKIE };
