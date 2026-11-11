import { Router } from 'express';
import { many, one } from '../db.js';
import { ah, intList } from '../lib/http.js';
import { today, addDays } from '../lib/dates.js';
import { dashboard, groupedMetrics, withRates } from '../services/metrics.js';
import { PARTICIPANT_FROM, PARTICIPANT_COLUMNS, participantWhere, nextAction } from '../services/participants.js';

const r = Router();

r.get('/', ah(async (req, res) => res.json(await dashboard(req.query))));

/** Visão geral (home): resumo pessoal + operação + campanhas ativas. */
r.get('/overview', ah(async (req, res) => {
  const t = today();
  const own = req.user.role === 'admin' ? {} : { seller: String(req.user.id) };
  const productQ = req.query.product_id ? { product_id: req.query.product_id } : {};
  const [mine] = await groupedMetrics({ ...productQ, ...own, campaign_status: 'ativa,pausada' });
  const [all] = await groupedMetrics({ ...productQ });
  const { where, params } = participantWhere(req, { ...productQ });
  const agenda = await one(`SELECT
      count(*) FILTER (WHERE cc.status='pendente' AND c.status='ativa')::int AS para_enviar,
      count(*) FILTER (WHERE c.status='ativa' AND EXISTS (SELECT 1 FROM followups f WHERE f.campaign_contact_id=cc.id AND f.status='pendente' AND f.due_date='${t}'))::int AS followups_hoje,
      count(*) FILTER (WHERE c.status='ativa' AND EXISTS (SELECT 1 FROM followups f WHERE f.campaign_contact_id=cc.id AND f.status='pendente' AND f.due_date<'${t}'))::int AS atrasados,
      count(*) FILTER (WHERE cc.status IN ('respondeu','interesse','negociacao'))::int AS negociacao
    ${PARTICIPANT_FROM} WHERE ${where}`, params);
  const productFilter = intList(req.query.product_id);
  const active = await many(`SELECT c.id, c.name, c.status, c.start_date, c.end_date, c.goal_contacts, c.goal_conversions,
      COALESCE((SELECT json_agg(p.name) FROM products p WHERE p.id = ANY(c.product_ids)), '[]') AS product_names,
      count(cc.id)::int AS participants, count(cc.id) FILTER (WHERE cc.status<>'pendente')::int AS worked,
      count(cc.first_sent_at)::int AS sent, count(cc.responded_at)::int AS responded, count(cc.converted_at)::int AS converted,
      COALESCE(sum(cc.conversion_value) FILTER (WHERE cc.converted_at IS NOT NULL),0)::float AS revenue
      ${req.user.role !== 'admin' ? `, count(cc.id) FILTER (WHERE cc.assigned_to=${Number(req.user.id)})::int AS mine,
         count(cc.id) FILTER (WHERE cc.assigned_to=${Number(req.user.id)} AND cc.status<>'pendente')::int AS mine_worked` : ''}
    FROM campaigns c LEFT JOIN campaign_contacts cc ON cc.campaign_id=c.id
    WHERE c.status IN ('ativa','pausada') ${productFilter.length ? `AND c.product_ids && ARRAY[${productFilter.join(',')}]::int[]` : ''}
    GROUP BY c.id ORDER BY c.status, c.end_date NULLS LAST`);
  const recent = await many(`SELECT i.id, i.type, i.created_at, i.to_status, i.note, i.attempt, i.value, u.name AS user_name, ct.full_name, c.name AS campaign_name, i.campaign_contact_id
    FROM interactions i JOIN contacts ct ON ct.id=i.contact_id LEFT JOIN users u ON u.id=i.user_id LEFT JOIN campaigns c ON c.id=i.campaign_id
    LEFT JOIN campaign_contacts cc ON cc.id=i.campaign_contact_id
    WHERE i.type IN ('envio','status','conversao','opt_out') ${req.user.role !== 'admin' ? `AND cc.assigned_to=${Number(req.user.id)}` : ''}
    ORDER BY i.created_at DESC LIMIT 12`);
  const review = req.user.role === 'admin' ? await one(`SELECT
      count(*) FILTER (WHERE historical_status='revisao' AND NOT status_manual)::int AS revisao,
      count(*) FILTER (WHERE ref_year IS NULL)::int AS sem_ano,
      count(*) FILTER (WHERE product_id IS NULL)::int AS sem_produto FROM opportunities`) : null;
  const pendingImports = req.user.role === 'admin' ? await one(`SELECT count(*)::int AS n FROM imports WHERE status IN ('rascunho','analisada')`) : null;
  const accessRequests = req.user.role === 'admin' ? await one(`SELECT count(*)::int AS n FROM access_requests WHERE resolved_at IS NULL`) : null;
  const demo = await one(`SELECT (SELECT count(*) FROM contacts WHERE is_demo)::int AS contacts, (SELECT count(*) FROM campaigns WHERE is_demo)::int AS campaigns`);
  res.json({ today: t, mine: withRates(mine || {}), all: withRates(all || {}), agenda, active, recent, review, pendingImports, accessRequests, demo });
}));

/** Agenda de follow-ups agrupada por data. */
r.get('/agenda', ah(async (req, res) => {
  const t = today();
  const days = Math.min(60, Number(req.query.days) || 14);
  const q = { ...req.query };
  delete q.queue;
  const { where, params } = participantWhere(req, q);
  const rows = await many(`SELECT f.id AS followup_id, f.due_date, f.type AS followup_type, f.step, ${PARTICIPANT_COLUMNS}
    ${PARTICIPANT_FROM} JOIN followups f ON f.campaign_contact_id = cc.id AND f.status = 'pendente'
    WHERE ${where} AND c.status = 'ativa' AND f.due_date <= '${addDays(t, days)}'
    ORDER BY f.due_date, ct.full_name LIMIT 500`, params);
  const suspended = await one(`SELECT count(*)::int AS n FROM followups f JOIN campaign_contacts cc ON cc.id=f.campaign_contact_id
    WHERE f.status='suspenso' ${req.user.role !== 'admin' ? `AND cc.assigned_to=${Number(req.user.id)}` : ''}`);
  res.json({ today: t, rows: rows.map((p) => ({ ...p, next_action: nextAction(p, t) })), suspended: suspended.n });
}));

export default r;
