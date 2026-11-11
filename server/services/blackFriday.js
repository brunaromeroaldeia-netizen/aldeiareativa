// Pacote da campanha "Black Friday — Mesa / Plano Full — Aldeia Cândido" (novembro de 2026).
// Aplica modelos, condições comerciais e regras de sequência SOMENTE nessa campanha.
// Idempotente: pode ser executado mais de uma vez sem duplicar modelos nem apagar histórico.
import { tx } from '../db.js';

export const BF_NAME = 'Black Friday — Mesa / Plano Full — Aldeia Cândido';
export const BF_UPDATE = 'black-friday-mesa-2026-v1';
export const BF_END = '2026-11-30';

export const BF_CONDITIONS = [
  'Produto: Mesa / Plano Full',
  'Unidade: Aldeia Cândido — Centro Cívico',
  'Validade: contratos assinados até 30/11/2026',
  'Condição: o cliente assina em novembro e pode começar a utilizar o espaço imediatamente, conforme disponibilidade.',
  'Taxa de adesão: paga na contratação.',
  'Mensalidades: novembro e dezembro de 2026 sem cobrança de mensalidade.',
  'Primeira mensalidade: janeiro de 2027.',
  'Permanência mínima: seis meses a partir de janeiro de 2027.',
  'Disponibilidade: sujeita à existência de mesas disponíveis.',
].join('\n');

export const BF_SCHEDULE = { steps: [{ step: 2, min: 3, max: 3 }, { step: 3, min: 3, max: 5 }], close_after_days: 3 };

export const BF_TEMPLATES = [
  {
    name: 'Inicial — Ex-clientes de Mesa', kind: 'inicial', step: 1, historical_status: 'ganho', client_status: 'inativo',
    body: `Oi, {{primeiro_nome}}! Tudo bem? 😊

Aqui é a {{vendedora}}, da Aldeia!

Estou passando porque preparamos uma condição especial de Black Friday para quem quer começar 2027 com um espaço de trabalho já garantido.

Fechando uma mesa agora em novembro, você já pode começar a usar o coworking, mas a primeira mensalidade fica só para janeiro!

Como você já conhece a Aldeia, lembrei de você. Faz sentido conversarmos sobre voltar a ter um espaço com a gente?`,
  },
  {
    name: 'Inicial — Leads Perdidos', kind: 'inicial', step: 1, historical_status: 'perdido', client_status: null,
    body: `Oi, {{primeiro_nome}}! Tudo bem? 😊

Aqui é a {{vendedora}}, da Aldeia!

Há um tempo você demonstrou interesse em ter um espaço de trabalho com a gente, e lembrei de você por conta de uma condição especial que liberamos nesta Black Friday.

Quem contratar uma mesa agora em novembro já pode começar a usar o espaço imediatamente, mas a primeira mensalidade fica só para janeiro de 2027!

Queria saber: aquele plano de ter um espaço de trabalho ainda faz sentido pra você?`,
  },
  {
    name: 'Inicial — Leads Abertos', kind: 'inicial', step: 1, historical_status: 'aberto', client_status: null,
    body: `Oi, {{primeiro_nome}}! Tudo bem? 😊

Aqui é a {{vendedora}}, da Aldeia!

Estava revisitando alguns contatos que já demonstraram interesse nos nossos espaços e queria saber se você ainda está buscando um lugar para trabalhar.

Estamos com uma condição especial de Black Friday: você garante sua mesa agora, já pode começar a usar o espaço e só paga a primeira mensalidade em janeiro de 2027!

Ainda está nos seus planos ter um espaço de trabalho?`,
  },
  {
    name: 'Follow-up 1 — Retomada', kind: 'followup', step: 2, historical_status: null, client_status: null,
    body: `Oi, {{primeiro_nome}}! Tudo bem? 😊

Passando para saber se você conseguiu ver a condição especial que te enviei sobre as mesas da Aldeia.

A ideia é que você possa começar 2027 com sua estrutura de trabalho já resolvida, aproveitando o espaço ainda em novembro e dezembro, sem mensalidade nesse período.

Faz sentido para você neste momento?`,
  },
  {
    name: 'Follow-up 2 — Última Tentativa', kind: 'followup', step: 3, historical_status: null, client_status: null,
    body: `Oi, {{primeiro_nome}}! Tudo bem?

Passando uma última vez sobre a nossa condição especial de Black Friday. 😊

A campanha é válida para contratos fechados até 30/11, com a primeira mensalidade só em janeiro de 2027.

Se ainda estiver pensando em ter um espaço de trabalho, posso te apresentar as opções disponíveis!

Se não for o momento, sem problemas. Quem sabe conversamos em outra oportunidade! 😊`,
  },
];

const q = async (c, sql, params) => (await c.query(sql, params)).rows;

export async function mesaProductId(c) {
  return (await q(c, `SELECT id FROM products WHERE name ILIKE 'Mesa%' ORDER BY id LIMIT 1`))[0]?.id ?? null;
}

/** Campanhas de Black Friday de Mesa ainda não encerradas (alvo do pacote). */
export async function findBlackFridayCampaigns(c) {
  const mesa = await mesaProductId(c);
  if (!mesa) return [];
  return q(c, `SELECT * FROM campaigns WHERE name ILIKE '%black friday%' AND $1 = ANY(product_ids) AND status <> 'encerrada' ORDER BY id`, [mesa]);
}

/** Aplica modelos, condições e regras à campanha indicada. */
export async function applyBlackFridayPackage(c, campaignId, userId) {
  const mesa = await mesaProductId(c);
  const camp = (await q(c, 'SELECT * FROM campaigns WHERE id=$1', [campaignId]))[0];
  if (!camp || !mesa) return null;
  const report = { campaign_id: campaignId, templates_created: [], templates_updated: [], templates_deactivated: [], followups_adjusted: 0, followups_cancelled: 0 };

  await c.query(`UPDATE campaigns SET name=$2, promo_description=$3, end_date=$4, product_ids=$5, years='{}', historical_statuses=$6,
      filters = filters || $7::jsonb, followup_days=3, max_attempts=3, followup_schedule=$8,
      description = COALESCE(NULLIF(description,''), $9), updated_at=now() WHERE id=$1`,
  [campaignId, BF_NAME, BF_CONDITIONS, BF_END, [mesa], ['ganho', 'perdido', 'aberto'], JSON.stringify({ exclude_active_clients: true }),
    JSON.stringify(BF_SCHEDULE), 'Reativação de ex-clientes, leads perdidos e leads em aberto de Mesa / Plano Full para a Black Friday 2026.']);

  // modelos antigos desta campanha deixam de ser sugeridos (histórico de envios preservado)
  const names = BF_TEMPLATES.map((t) => t.name);
  const old = await q(c, `UPDATE message_templates SET active=FALSE, updated_at=now() WHERE campaign_id=$1 AND active AND NOT (name = ANY($2)) RETURNING name`, [campaignId, names]);
  report.templates_deactivated = old.map((x) => x.name);

  for (const t of BF_TEMPLATES) {
    const cur = (await q(c, 'SELECT * FROM message_templates WHERE campaign_id=$1 AND name=$2 ORDER BY id LIMIT 1', [campaignId, t.name]))[0];
    if (!cur) {
      const row = (await q(c, `INSERT INTO message_templates(campaign_id, name, kind, step, product_id, ref_year, historical_status, client_status, body, created_by)
        VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9) RETURNING id`, [campaignId, t.name, t.kind, t.step, mesa, t.historical_status, t.client_status, t.body, userId]))[0];
      await c.query('INSERT INTO message_template_versions(template_id, version, body, created_by) VALUES ($1,1,$2,$3)', [row.id, t.body, userId]);
      report.templates_created.push(t.name);
    } else if (cur.body !== t.body || cur.kind !== t.kind || cur.step !== t.step || cur.historical_status !== t.historical_status || cur.client_status !== t.client_status || !cur.active) {
      const bodyChanged = cur.body !== t.body;
      const row = (await q(c, `UPDATE message_templates SET kind=$2, step=$3, product_id=$4, ref_year=NULL, historical_status=$5, client_status=$6, body=$7, active=TRUE,
          version = version + $8, updated_at=now() WHERE id=$1 RETURNING version`, [cur.id, t.kind, t.step, mesa, t.historical_status, t.client_status, t.body, bodyChanged ? 1 : 0]))[0];
      if (bodyChanged) await c.query('INSERT INTO message_template_versions(template_id, version, body, created_by) VALUES ($1,$2,$3,$4)', [cur.id, row.version, t.body, userId]);
      report.templates_updated.push(t.name);
    }
  }

  // follow-ups já pendentes passam a seguir a janela e o prazo final da campanha
  const adj = await c.query(`UPDATE followups SET due_until = LEAST(due_date + 2, $2::date)
    WHERE campaign_id=$1 AND status='pendente' AND type='followup' AND step=3 AND due_until IS NULL AND due_date <= $2::date`, [campaignId, BF_END]);
  report.followups_adjusted = adj.rowCount;
  const late = await q(c, `UPDATE followups SET status='cancelado', status_reason='Previsto para depois do fim da campanha (30/11/2026)', completed_at=now()
    WHERE campaign_id=$1 AND status='pendente' AND type='followup' AND due_date > $2::date RETURNING campaign_contact_id`, [campaignId, BF_END]);
  report.followups_cancelled = late.length;
  if (late.length) {
    await c.query(`UPDATE campaign_contacts SET no_response_deadline=$2::date, updated_at=now() WHERE id = ANY($1)`, [late.map((x) => x.campaign_contact_id), BF_END]);
  }
  await c.query(`INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES ($1,'pacote_black_friday_aplicado','campaign',$2,$3)`, [userId, campaignId, report]);
  return report;
}

/**
 * Somente dados de DEMONSTRAÇÃO: marca ex-clientes de Mesa fictícios (confirmados, não confirmados e ativos)
 * e inclui na campanha de exemplo os ex-clientes elegíveis, para testar o modelo de ex-clientes.
 */
export async function applyDemoExClients(c, campaignId, userId) {
  const camp = (await q(c, 'SELECT * FROM campaigns WHERE id=$1', [campaignId]))[0];
  if (!camp?.is_demo) return { added: 0 };
  const mesa = await mesaProductId(c);
  const won = await q(c, `SELECT DISTINCT ON (o.contact_id) o.id AS opportunity_id, o.contact_id, ct.client_status
      FROM opportunities o JOIN contacts ct ON ct.id=o.contact_id
     WHERE o.is_demo AND ct.is_demo AND o.product_id=$1 AND o.historical_status='ganho' AND NOT ct.do_not_contact
     ORDER BY o.contact_id, o.ref_year DESC`, [mesa]);
  // situação de cliente fictícia: 1 em cada 4 ativo, metade ex-cliente confirmado, o resto não confirmado
  for (const [i, w] of won.entries()) {
    if (w.client_status) continue;
    const status = i % 4 === 0 ? 'ativo' : i % 4 === 3 ? null : 'inativo';
    if (status) await c.query(`UPDATE contacts SET client_status=$2, client_status_at=now(), client_status_by=$3 WHERE id=$1`, [w.contact_id, status, userId]);
    w.client_status = status;
  }
  const sellers = await q(c, `SELECT id FROM users WHERE role='vendedora' AND active ORDER BY name`);
  let added = 0;
  for (const [i, w] of won.filter((x) => x.client_status !== 'ativo').entries()) {
    const seller = sellers.length ? sellers[i % sellers.length].id : null;
    const ins = await q(c, `INSERT INTO campaign_contacts(campaign_id, contact_id, opportunity_id, assigned_to, assigned_at, added_by, is_demo)
      VALUES ($1,$2,$3,$4, CASE WHEN $4::int IS NULL THEN NULL ELSE now() END, $5, TRUE) ON CONFLICT (campaign_id, contact_id) DO NOTHING RETURNING id`,
    [campaignId, w.contact_id, w.opportunity_id, seller, userId]);
    if (ins.length) {
      added++;
      await c.query(`INSERT INTO interactions(campaign_contact_id, campaign_id, contact_id, user_id, type, note, is_demo) VALUES ($1,$2,$3,$4,'participacao','Ex-cliente de Mesa incluído na campanha (exemplo)',TRUE)`,
        [ins[0].id, campaignId, w.contact_id, userId]);
    }
  }
  return { added };
}

/** Atualização de dados: aplica o pacote às campanhas Black Friday de Mesa existentes (uma única vez). */
export async function runBlackFridayUpdate() {
  return tx(async (c) => {
    const done = (await c.query('SELECT 1 FROM data_updates WHERE name=$1', [BF_UPDATE])).rowCount;
    if (done) return null;
    const admin = (await c.query(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`)).rows[0];
    const results = [];
    for (const camp of await findBlackFridayCampaigns(c)) {
      const r = await applyBlackFridayPackage(c, camp.id, admin?.id ?? null);
      const demo = await applyDemoExClients(c, camp.id, admin?.id ?? null);
      results.push({ ...r, demo_ex_clients_added: demo.added, previous_name: camp.name });
    }
    await c.query('INSERT INTO data_updates(name, details) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING', [BF_UPDATE, JSON.stringify({ campaigns: results })]);
    return results;
  });
}
