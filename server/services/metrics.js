import { many, one } from '../db.js';
import { today, addDays } from '../lib/dates.js';
import { intList, strList } from '../lib/http.js';

const isoOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Filtros do dashboard aplicados aos participantes de campanhas.
 * Período: considera a coorte de contatos cujo PRIMEIRO envio ocorreu no período (taxas consistentes);
 * contagens de mensagens usam a data de cada envio.
 */
export function metricFilters(q) {
  const params = [];
  const where = [`c.status <> 'rascunho'`];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('$?', `$${params.length}`)); };
  if (intList(q.campaign_id).length) add('cc.campaign_id = ANY($?::int[])', intList(q.campaign_id));
  if (intList(q.product_id).length) add('COALESCE(o.product_id, c.product_ids[1]) = ANY($?::int[])', intList(q.product_id));
  if (intList(q.year).length) add('o.ref_year = ANY($?::int[])', intList(q.year));
  if (strList(q.hist).length) add('o.historical_status = ANY($?::text[])', strList(q.hist));
  if (intList(q.seller).length) add('cc.assigned_to = ANY($?::int[])', intList(q.seller));
  if (strList(q.campaign_status).length) add('c.status = ANY($?::text[])', strList(q.campaign_status));
  const from = isoOk(q.from) ? q.from : null;
  const to = isoOk(q.to) ? q.to : null;
  const range = (col) => `${col} IS NOT NULL${from ? ` AND ${col}::date >= '${from}'` : ''}${to ? ` AND ${col}::date <= '${to}'` : ''}`;
  return { where: where.join(' AND '), params, from, to, cohort: range('cc.first_sent_at'), range };
}

const FROM = `FROM campaign_contacts cc
  JOIN campaigns c ON c.id = cc.campaign_id
  LEFT JOIN opportunities o ON o.id = cc.opportunity_id`;

/** Indicadores agrupados (groupExpr = expressão SQL do grupo, ou 'total'). */
export async function groupedMetrics(q, groupExpr = `'total'`, { extraJoin = '' } = {}) {
  const f = metricFilters(q);
  const t = today();
  const msgRange = f.range('i.created_at');
  return many(`
    SELECT ${groupExpr} AS key,
      count(*)::int AS participants,
      count(*) FILTER (WHERE cc.assigned_to IS NOT NULL)::int AS assigned,
      count(*) FILTER (WHERE cc.status <> 'pendente')::int AS worked,
      count(*) FILTER (WHERE cc.status = 'pendente')::int AS pending,
      count(*) FILTER (WHERE ${f.cohort})::int AS sent,
      count(*) FILTER (WHERE ${f.cohort} AND cc.responded_at IS NOT NULL)::int AS responded,
      count(*) FILTER (WHERE ${f.cohort} AND cc.interested_at IS NOT NULL)::int AS interested,
      count(*) FILTER (WHERE ${f.cohort} AND cc.negotiation_at IS NOT NULL)::int AS negotiation,
      count(*) FILTER (WHERE ${f.cohort} AND cc.converted_at IS NOT NULL)::int AS converted,
      count(*) FILTER (WHERE ${f.cohort} AND cc.status = 'sem_interesse')::int AS no_interest,
      count(*) FILTER (WHERE ${f.cohort} AND cc.status = 'sem_resposta')::int AS no_response,
      count(*) FILTER (WHERE ${f.cohort} AND cc.status IN ('enviada','aguardando','followup_pendente'))::int AS awaiting,
      count(*) FILTER (WHERE cc.status = 'opt_out')::int AS opt_out,
      COALESCE(sum(cc.conversion_value) FILTER (WHERE ${f.cohort} AND cc.converted_at IS NOT NULL), 0)::float AS revenue,
      COALESCE(sum(m.messages), 0)::int AS messages,
      COALESCE(sum(m.followups_done), 0)::int AS followups_done,
      COALESCE(sum(fu.overdue) FILTER (WHERE c.status = 'ativa'), 0)::int AS followups_overdue,
      COALESCE(sum(fu.today) FILTER (WHERE c.status = 'ativa'), 0)::int AS followups_today
    ${FROM}
    ${extraJoin}
    LEFT JOIN LATERAL (SELECT count(*) AS messages, count(*) FILTER (WHERE i.attempt > 1) AS followups_done
        FROM interactions i WHERE i.campaign_contact_id = cc.id AND i.type = 'envio' AND ${msgRange}) m ON TRUE
    LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE f.due_date < '${t}') AS overdue, count(*) FILTER (WHERE f.due_date = '${t}') AS today
        FROM followups f WHERE f.campaign_contact_id = cc.id AND f.status = 'pendente') fu ON TRUE
    WHERE ${f.where}
    GROUP BY 1 ORDER BY 1`, f.params);
}

export function withRates(m) {
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    ...m,
    response_rate: pct(m.responded, m.sent),
    conversion_rate: pct(m.converted, m.sent),
    conversion_over_responded: pct(m.converted, m.responded),
    conversion_over_interested: pct(m.converted, m.interested),
    interest_rate: pct(m.interested, m.sent),
    messages_per_contact: m.sent ? Math.round((m.messages / m.sent) * 10) / 10 : null,
  };
}

const EMPTY = { participants: 0, assigned: 0, worked: 0, pending: 0, sent: 0, responded: 0, interested: 0, negotiation: 0, converted: 0,
  no_interest: 0, no_response: 0, awaiting: 0, opt_out: 0, revenue: 0, messages: 0, followups_done: 0, followups_overdue: 0, followups_today: 0 };

/** Indicadores da base (contatos/oportunidades), independentes de campanha. */
export async function baseMetrics(q) {
  const params = [];
  const conds = [];
  const add = (sql, v) => { params.push(v); conds.push(sql.replaceAll('$?', `$${params.length}`)); };
  if (intList(q.product_id).length) add('o.product_id = ANY($?::int[])', intList(q.product_id));
  if (intList(q.year).length) add('o.ref_year = ANY($?::int[])', intList(q.year));
  if (strList(q.hist).length) add('o.historical_status = ANY($?::text[])', strList(q.hist));
  const oppWhere = conds.length ? `AND ${conds.join(' AND ')}` : '';
  const row = await one(`SELECT
      count(DISTINCT ct.id)::int AS contacts,
      count(DISTINCT ct.id) FILTER (WHERE NOT ct.do_not_contact)::int AS eligible,
      count(DISTINCT ct.id) FILTER (WHERE ct.do_not_contact)::int AS dnc,
      count(o.id)::int AS opportunities,
      count(o.id) FILTER (WHERE o.historical_status='ganho')::int AS ganho,
      count(o.id) FILTER (WHERE o.historical_status='perdido')::int AS perdido,
      count(o.id) FILTER (WHERE o.historical_status='aberto')::int AS aberto,
      count(o.id) FILTER (WHERE o.historical_status='revisao')::int AS revisao,
      count(DISTINCT ct.id) FILTER (WHERE ct.phone_norm IS NULL)::int AS without_phone,
      count(DISTINCT ct.id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM campaign_contacts x WHERE x.contact_id=ct.id))::int AS never_approached
    FROM contacts ct JOIN opportunities o ON o.contact_id = ct.id ${oppWhere}
    WHERE ct.anonymized_at IS NULL`, params);
  return row;
}

export async function dashboard(q) {
  const [total] = await groupedMetrics(q);
  const kpis = withRates(total || EMPTY);
  const base = await baseMetrics(q);
  const campaigns = await one(`SELECT count(*) FILTER (WHERE status='ativa')::int AS ativas, count(*) FILTER (WHERE status='pausada')::int AS pausadas,
      count(*) FILTER (WHERE status='encerrada')::int AS encerradas, count(*) FILTER (WHERE status='rascunho')::int AS planejadas FROM campaigns
      ${intList(q.product_id).length ? `WHERE product_ids && ARRAY[${intList(q.product_id).join(',')}]::int[]` : ''}`);

  const f = metricFilters(q);
  const end = f.to || today();
  const start = f.from || addDays(end, -29);
  const daily = await many(`
    WITH days AS (SELECT generate_series($${f.params.length + 1}::date, $${f.params.length + 2}::date, '1 day')::date AS d),
    sends AS (SELECT i.created_at::date AS d, count(*) AS n FROM interactions i JOIN campaign_contacts cc ON cc.id=i.campaign_contact_id
               JOIN campaigns c ON c.id=cc.campaign_id LEFT JOIN opportunities o ON o.id=cc.opportunity_id
               WHERE i.type='envio' AND ${f.where} GROUP BY 1),
    resp AS (SELECT cc.responded_at::date AS d, count(*) AS n FROM campaign_contacts cc JOIN campaigns c ON c.id=cc.campaign_id
               LEFT JOIN opportunities o ON o.id=cc.opportunity_id WHERE cc.responded_at IS NOT NULL AND ${f.where} GROUP BY 1),
    conv AS (SELECT cc.converted_at::date AS d, count(*) AS n, sum(cc.conversion_value) AS v FROM campaign_contacts cc JOIN campaigns c ON c.id=cc.campaign_id
               LEFT JOIN opportunities o ON o.id=cc.opportunity_id WHERE cc.converted_at IS NOT NULL AND ${f.where} GROUP BY 1)
    SELECT to_char(days.d,'YYYY-MM-DD') AS day, COALESCE(sends.n,0)::int AS sent, COALESCE(resp.n,0)::int AS responses,
           COALESCE(conv.n,0)::int AS conversions, COALESCE(conv.v,0)::float AS revenue
    FROM days LEFT JOIN sends ON sends.d=days.d LEFT JOIN resp ON resp.d=days.d LEFT JOIN conv ON conv.d=days.d ORDER BY days.d`,
  [...f.params, start, end]);

  const byProduct = (await groupedMetrics(q, `COALESCE(o.product_id, c.product_ids[1])`)).map(withRates);
  const products = await many('SELECT id, name, color FROM products');
  byProduct.forEach((r) => { const p = products.find((x) => x.id === r.key); r.label = p?.name || 'Sem produto'; r.color = p?.color; });
  const byYear = (await groupedMetrics(q, `o.ref_year`)).map(withRates).map((r) => ({ ...r, label: r.key ? String(r.key) : 'Sem ano' }));
  const byHist = (await groupedMetrics(q, `o.historical_status`)).map(withRates).map((r) => ({ ...r, label: HIST_LABEL[r.key] || 'Sem histórico' }));
  const sellers = await many(`SELECT id, name FROM users WHERE role='vendedora' ORDER BY name`);
  const bySellerRaw = (await groupedMetrics(q, `cc.assigned_to`)).map(withRates);
  const bySeller = sellers.map((s) => ({ ...withRates(EMPTY), ...(bySellerRaw.find((r) => r.key === s.id) || {}), key: s.id, label: s.name }));
  const unassigned = bySellerRaw.find((r) => r.key === null);
  const campaignRows = (await groupedMetrics(q, `cc.campaign_id`)).map(withRates);
  const camps = await many('SELECT id, name, status, start_date, end_date, goal_conversions, goal_contacts FROM campaigns');
  const ranking = campaignRows.map((r) => ({ ...r, ...(camps.find((c) => c.id === r.key) || {}), label: camps.find((c) => c.id === r.key)?.name }))
    .sort((a, b) => b.converted - a.converted || (b.conversion_rate || 0) - (a.conversion_rate || 0) || b.revenue - a.revenue);

  const funnel = [
    { key: 'atribuidos', label: 'Atribuídos', value: kpis.assigned },
    { key: 'enviados', label: 'Com envio confirmado', value: kpis.sent },
    { key: 'responderam', label: 'Responderam', value: kpis.responded },
    { key: 'interessados', label: 'Interessados', value: kpis.interested },
    { key: 'negociacoes', label: 'Negociação', value: kpis.negotiation },
    { key: 'convertidos', label: 'Convertidos', value: kpis.converted },
  ];
  return { kpis, base, campaigns, daily, funnel, byProduct, byYear, byHist, bySeller, unassigned: unassigned ? withRates(unassigned) : null, ranking, period: { from: f.from, to: f.to, chartStart: start, chartEnd: end } };
}

export const HIST_LABEL = { ganho: 'Ganho', perdido: 'Perdido', aberto: 'Aberto', revisao: 'Revisão necessária' };
