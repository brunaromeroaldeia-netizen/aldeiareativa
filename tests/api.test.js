// Testes de regras de negócio contra um banco PostgreSQL de testes (dados são apagados!).
// Uso: TEST_DATABASE_URL=postgres://.../aldeia_reativa_test npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
const skip = !url || !/test/.test(url) ? 'defina TEST_DATABASE_URL apontando para um banco cujo nome contenha "test"' : false;
let server; let base; let db; let mod = {};

before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = url;
  process.env.NO_VITE = '1';
  db = await import('../server/db.js');
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await (await import('../server/migrate.js')).migrate({ log: () => {} });
  const { hashPassword } = await import('../server/auth.js');
  const h = await hashPassword('SenhaTeste123');
  await db.query(`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES
    ('Admin','admin@t.local','admin',$1,false),('Letícia','leticia@t.local','vendedora',$1,false),('Giovana','giovana@t.local','vendedora',$1,false)`, [h]);
  mod.scheduler = await import('../server/services/scheduler.js');
  mod.dates = await import('../server/lib/dates.js');
  const { createApp } = await import('../server/index.js');
  const app = await createApp();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}/api`;
});
after(async () => { if (server) server.close(); if (db) await db.pool.end(); });

function client() {
  let cookie = '';
  const call = async (method, path, body, { csrf = true } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-Requested-With': 'aldeia-reativa' } : {}), cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
    return { status: res.status, data };
  };
  return { call, login: (email) => call('POST', '/auth/login', { email, password: 'SenhaTeste123' }) };
}

test('fluxo completo de reativação e regras de negócio', { skip }, async () => {
  const admin = client(); const leti = client(); const gio = client();
  assert.equal((await admin.call('GET', '/campaigns')).status, 401);
  assert.equal((await admin.login('admin@t.local')).status, 200);
  await leti.login('leticia@t.local'); await gio.login('giovana@t.local');
  const [{ id: letiId }, { id: gioId }] = (await admin.call('GET', '/users')).data.filter((u) => u.role === 'vendedora').sort((a, b) => a.name.localeCompare(b.name)).reverse();

  // CSRF: alteração sem cabeçalho é bloqueada
  assert.equal((await admin.call('POST', '/contacts', { full_name: 'X' }, { csrf: false })).status, 403);
  // vendedora não importa nem cria campanha
  assert.equal((await leti.call('GET', '/imports')).status, 403);
  assert.equal((await leti.call('POST', '/campaigns', { name: 'Teste' })).status, 403);

  const products = (await admin.call('GET', '/products')).data;
  const mesa = products.find((p) => p.name.startsWith('Mesa')).id;
  const ids = [];
  for (const [i, name] of ['Mariana Ferreira', 'Carlos Souza', 'Fernanda Lima', 'Bruno Alves'].entries()) {
    const r = await admin.call('POST', '/contacts', { full_name: name, phone: `(41) 99999-000${i}`, opportunity: { product_id: mesa, created_date: '2024-03-10', lost_date: '2024-04-01', lost_reason: 'Preço' } });
    assert.equal(r.status, 200); ids.push(r.data.id);
  }
  // duplicidade não é criada silenciosamente
  const dup = await admin.call('POST', '/contacts', { full_name: 'Mariana F.', phone: '41 9 9999-0000' });
  assert.equal(dup.status, 409);

  const camp = await admin.call('POST', '/campaigns', { name: 'Black Friday Mesas', product_ids: [mesa], years: [2024], historical_statuses: ['perdido'], followup_days: 3, max_attempts: 2, seller_ids: [letiId, gioId] });
  const cid = camp.data.id;
  assert.equal((await admin.call('GET', `/campaigns/${cid}/eligibility`)).data.total.eligible, 4);
  assert.equal((await admin.call('POST', `/campaigns/${cid}/participants`, {})).data.added, 4);
  assert.equal((await admin.call('POST', `/campaigns/${cid}/status`, { action: 'ativar' })).status, 400); // sem mensagem
  await admin.call('POST', '/templates', { campaign_id: cid, name: 'Inicial', kind: 'inicial', step: 1, product_id: mesa, ref_year: 2024, historical_status: 'perdido', body: 'Oi, {{primeiro_nome}}! Tudo bem? 😊' });
  await admin.call('POST', '/templates', { campaign_id: cid, name: 'FU', kind: 'followup', step: 2, product_id: null, ref_year: null, historical_status: null, body: 'Oi, {{primeiro_nome}}! Conseguiu ver?' });
  assert.equal((await admin.call('POST', `/campaigns/${cid}/distribute`, { method: 'igual' })).data.changed, 4);
  assert.equal((await admin.call('POST', `/campaigns/${cid}/status`, { action: 'ativar' })).status, 200);

  // cada vendedora vê apenas os próprios contatos
  const mine = (await leti.call('GET', `/participants?campaign_id=${cid}`)).data.rows;
  const hers = (await gio.call('GET', `/participants?campaign_id=${cid}`)).data.rows;
  assert.equal(mine.length, 2); assert.equal(hers.length, 2);
  assert.equal((await leti.call('GET', `/participants/${hers[0].id}`)).status, 404);
  assert.equal((await leti.call('POST', `/participants/${hers[0].id}/send`, { message_text: 'x', expected_attempts: 0 })).status, 404);

  // mensagem personalizada
  const p = mine[0];
  const det = (await leti.call('GET', `/participants/${p.id}`)).data;
  assert.match(det.message.text, new RegExp(`^Oi, ${p.full_name.split(' ')[0]}! Tudo bem\\? 😊$`));

  // copiar não conta como envio
  await leti.call('POST', `/participants/${p.id}/copy`, {});
  let dash = (await admin.call('GET', `/dashboard?campaign_id=${cid}`)).data;
  assert.equal(dash.kpis.messages, 0); assert.equal(dash.kpis.sent, 0);

  // envio confirmado + follow-up agendado; envio duplicado é bloqueado
  const send = await leti.call('POST', `/participants/${p.id}/send`, { message_text: det.message.text, template_id: det.message.template.id, expected_attempts: 0 });
  assert.equal(send.status, 200);
  assert.equal(send.data.nextDue, mod.dates.addDays(mod.dates.today(), 3));
  assert.equal((await leti.call('POST', `/participants/${p.id}/send`, { message_text: 'x', expected_attempts: 0 })).status, 409);

  // follow-up vence (simulação de 3 dias) e aparece como atrasado / pendente
  await db.query(`UPDATE followups SET due_date = due_date - 4 WHERE campaign_contact_id=$1`, [p.id]);
  await mod.scheduler.runScheduler();
  assert.equal((await db.one('SELECT status FROM campaign_contacts WHERE id=$1', [p.id])).status, 'followup_pendente');
  assert.equal((await leti.call('GET', `/participants/queues?campaign_id=${cid}`)).data.atrasados, 1);
  const det2 = (await leti.call('GET', `/participants/${p.id}`)).data;
  assert.equal(det2.message.step, 2);
  assert.match(det2.message.text, /Conseguiu ver\?/);
  // segundo envio atinge o limite (2): sem novo follow-up, prazo de encerramento
  const s2 = await leti.call('POST', `/participants/${p.id}/send`, { message_text: det2.message.text, expected_attempts: 1 });
  assert.equal(s2.data.nextDue, null); assert.ok(s2.data.deadline);
  await db.query(`UPDATE campaign_contacts SET no_response_deadline = no_response_deadline - 10 WHERE id=$1`, [p.id]);
  await mod.scheduler.runScheduler();
  assert.equal((await db.one('SELECT status FROM campaign_contacts WHERE id=$1', [p.id])).status, 'sem_resposta');

  // resposta cancela follow-ups; conversão preserva o histórico importado
  const q = mine[1];
  await leti.call('POST', `/participants/${q.id}/send`, { message_text: 'Oi!', expected_attempts: 0 });
  await leti.call('POST', `/participants/${q.id}/outcome`, { status: 'interesse', note: 'Pediu valores' });
  assert.equal((await db.one(`SELECT count(*)::int n FROM followups WHERE campaign_contact_id=$1 AND status='pendente'`, [q.id])).n, 0);
  assert.equal((await leti.call('POST', `/participants/${q.id}/outcome`, { status: 'convertido', conversion_value: 890 })).status, 200);
  const opp = await db.one(`SELECT o.historical_status FROM campaign_contacts cc JOIN opportunities o ON o.id=cc.opportunity_id WHERE cc.id=$1`, [q.id]);
  assert.equal(opp.historical_status, 'perdido');
  dash = (await gio.call('GET', `/dashboard?campaign_id=${cid}`)).data; // vendedora também vê o dashboard
  assert.equal(dash.kpis.converted, 1); assert.equal(dash.kpis.revenue, 890);
  assert.equal(dash.kpis.messages, 3); assert.equal(dash.kpis.sent, 2);
  assert.equal(dash.kpis.response_rate, 50); assert.equal(dash.kpis.conversion_rate, 50);

  // opt-out bloqueia futuras campanhas
  const g = hers[0];
  await gio.call('POST', `/participants/${g.id}/send`, { message_text: 'Oi', expected_attempts: 0 });
  await gio.call('POST', `/participants/${g.id}/outcome`, { status: 'opt_out', note: 'Pediu para não receber' });
  const camp2 = await admin.call('POST', '/campaigns', { name: 'Janeiro 2027', product_ids: [mesa], years: [2024], historical_statuses: ['perdido'], filters: { exclude_recent_days: 0, exclude_active_campaigns: false } });
  const el2 = (await admin.call('GET', `/campaigns/${camp2.data.id}/eligibility`)).data.total;
  assert.equal(el2.excluded_dnc, 1); assert.equal(el2.eligible, 3);

  // encerrar campanha suspende follow-ups e bloqueia envios
  const h2 = hers[1];
  await gio.call('POST', `/participants/${h2.id}/send`, { message_text: 'Oi', expected_attempts: 0 });
  await admin.call('POST', `/campaigns/${cid}/status`, { action: 'encerrar' });
  assert.equal((await db.one(`SELECT status FROM followups WHERE campaign_contact_id=$1`, [h2.id])).status, 'suspenso');
  assert.equal((await gio.call('POST', `/participants/${h2.id}/send`, { message_text: 'Oi', expected_attempts: 1 })).status, 400);
  // campanha encerrada continua consultável com resultados
  const closed = (await gio.call('GET', `/campaigns/${cid}`)).data;
  assert.equal(closed.status, 'encerrada'); assert.equal(closed.summary.converted, 1);

  // exportação
  const rep = await fetch(`${base}/reports/campanhas?format=csv`, { headers: { cookie: '' } });
  assert.equal(rep.status, 401);
});
