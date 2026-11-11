// Entrada do site na Vercel: todas as rotas /api/* chegam aqui.
// Na primeira requisição de cada instância: aplica migrações pendentes e garante a campanha inicial.
import { createApp } from '../server/index.js';
import { migrate } from '../server/migrate.js';
import { ensureBlackFridayCampaign } from '../server/services/blackFriday.js';

let ready;
async function init() {
  await migrate({ log: (m) => console.log(m) });
  await ensureBlackFridayCampaign().catch((e) => console.error('[inicial] campanha Black Friday', e.message));
  return createApp();
}

export default async function handler(req, res) {
  ready ||= init().catch((e) => { ready = null; throw e; });
  try {
    const app = await ready;
    return app(req, res);
  } catch (e) {
    console.error('[init]', e);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Servidor iniciando ou banco de dados indisponível. Tente novamente em instantes.' }));
  }
}

export const config = { api: { bodyParser: false } };
