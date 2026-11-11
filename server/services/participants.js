import { many, one } from '../db.js';
import { today } from '../lib/dates.js';
import { intList, strList } from '../lib/http.js';

/**
 * Monta WHERE para listas de participantes (operação, drill-down do dashboard e relatórios).
 * Vendedoras sempre ficam restritas aos próprios contatos.
 */
export function participantWhere(req, q = req.query, { forceOwn = true } = {}) {
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('$?', `$${params.length}`)); };
  const t = today();

  if (req.user.role !== 'admin' && forceOwn) add('cc.assigned_to = $?', req.user.id);
  else if (q.seller === 'none') where.push('cc.assigned_to IS NULL');
  else if (intList(q.seller).length) add('cc.assigned_to = ANY($?::int[])', intList(q.seller));

  if (intList(q.campaign_id).length) add('cc.campaign_id = ANY($?::int[])', intList(q.campaign_id));
  if (strList(q.campaign_status).length) add('c.status = ANY($?::text[])', strList(q.campaign_status));
  if (req.user.role !== 'admin') where.push(`c.status <> 'rascunho'`);
  if (intList(q.product_id).length) add('COALESCE(o.product_id, c.product_ids[1]) = ANY($?::int[])', intList(q.product_id));
  if (intList(q.year).length) add('o.ref_year = ANY($?::int[])', intList(q.year));
  if (strList(q.hist).length) add('o.historical_status = ANY($?::text[])', strList(q.hist));
  if (strList(q.status).length) add('cc.status = ANY($?::text[])', strList(q.status));
  if (q.search) {
    const s = `%${String(q.search).trim()}%`;
    const digits = String(q.search).replace(/\D/g, '');
    params.push(s);
    const i = params.length;
    let extra = '';
    if (digits.length >= 4) { params.push(`%${digits}%`); extra = ` OR ct.phone_norm LIKE $${params.length}`; }
    where.push(`(ct.full_name ILIKE $${i} OR ct.company ILIKE $${i} OR ct.email ILIKE $${i}${extra})`);
  }

  // período (coorte pelo primeiro envio), igual ao dashboard
  const hasPeriod = q.from || q.to;
  const cohort = hasPeriod
    ? `cc.first_sent_at IS NOT NULL AND cc.first_sent_at::date BETWEEN ${q.from ? `'${safeDate(q.from)}'` : `'1900-01-01'`} AND ${q.to ? `'${safeDate(q.to)}'` : `'2999-12-31'`}`
    : 'cc.first_sent_at IS NOT NULL';

  const pendingFu = `EXISTS (SELECT 1 FROM followups f WHERE f.campaign_contact_id=cc.id AND f.status='pendente'`;
  switch (q.queue) {
    case 'para_enviar': where.push(`cc.status='pendente' AND c.status='ativa'`); break;
    case 'followups_hoje': where.push(`${pendingFu} AND f.due_date <= '${t}' AND COALESCE(f.due_until, f.due_date) >= '${t}') AND c.status='ativa'`); break;
    case 'atrasados': where.push(`${pendingFu} AND COALESCE(f.due_until, f.due_date) < '${t}') AND c.status='ativa'`); break;
    case 'aguardando': where.push(`cc.status IN ('enviada','aguardando') AND NOT ${pendingFu} AND f.due_date <= '${t}')`); break;
    case 'negociacao': where.push(`cc.status IN ('respondeu','interesse','negociacao')`); break;
    case 'retornos': where.push(`cc.status='retorno_futuro'`); break;
    default: break;
  }

  switch (q.metric) {
    case 'atribuidos': where.push('cc.assigned_to IS NOT NULL'); break;
    case 'trabalhados': where.push(`cc.status <> 'pendente'`); break;
    case 'pendentes': where.push(`cc.status = 'pendente'`); break;
    case 'enviados': where.push(cohort); break;
    case 'responderam': where.push(`${cohort} AND cc.responded_at IS NOT NULL`); break;
    case 'interessados': where.push(`${cohort} AND cc.interested_at IS NOT NULL`); break;
    case 'negociacoes': where.push(`${cohort} AND cc.negotiation_at IS NOT NULL`); break;
    case 'convertidos': where.push(`${cohort} AND cc.converted_at IS NOT NULL`); break;
    case 'sem_interesse': where.push(`${cohort} AND cc.status = 'sem_interesse'`); break;
    case 'sem_resposta': where.push(`${cohort} AND cc.status = 'sem_resposta'`); break;
    case 'aguardando_resposta': where.push(`${cohort} AND cc.status IN ('enviada','aguardando','followup_pendente')`); break;
    case 'opt_out': where.push(`cc.status = 'opt_out'`); break;
    case 'followups_atrasados': where.push(`${pendingFu} AND COALESCE(f.due_until, f.due_date) < '${t}') AND c.status='ativa'`); break;
    case 'followups_pendentes': where.push(`${pendingFu}) AND c.status='ativa'`); break;
    default: break;
  }
  return { where: where.length ? where.join(' AND ') : 'TRUE', params };
}

function safeDate(v) {
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '1900-01-01';
}

export const PARTICIPANT_FROM = `
  FROM campaign_contacts cc
  JOIN campaigns c ON c.id = cc.campaign_id
  JOIN contacts ct ON ct.id = cc.contact_id
  LEFT JOIN opportunities o ON o.id = cc.opportunity_id
  LEFT JOIN products p ON p.id = COALESCE(o.product_id, c.product_ids[1])
  LEFT JOIN users u ON u.id = cc.assigned_to`;

export const PARTICIPANT_COLUMNS = `
  cc.id, cc.status, cc.attempts, cc.assigned_to, u.name AS assigned_name, cc.first_sent_at, cc.last_sent_at, cc.responded_at,
  cc.converted_at, cc.conversion_value, cc.return_date, cc.no_response_deadline, cc.notes, cc.updated_at, cc.added_at,
  c.id AS campaign_id, c.name AS campaign_name, c.status AS campaign_status, c.max_attempts,
  ct.id AS contact_id, ct.full_name, ct.first_name, ct.company, ct.phone, ct.email, ct.do_not_contact,
  o.id AS opportunity_id, o.ref_year, o.historical_status, o.lost_reason, p.id AS product_id, p.name AS product_name,
  (SELECT min(f.due_date) FROM followups f WHERE f.campaign_contact_id = cc.id AND f.status = 'pendente') AS next_due,
  (SELECT f.type FROM followups f WHERE f.campaign_contact_id = cc.id AND f.status = 'pendente' ORDER BY f.due_date LIMIT 1) AS next_due_type,
  (SELECT COALESCE(f.due_until, f.due_date) FROM followups f WHERE f.campaign_contact_id = cc.id AND f.status = 'pendente' ORDER BY f.due_date LIMIT 1) AS next_due_until`;

export function nextAction(p, t = today()) {
  if (p.campaign_status === 'encerrada') return { label: 'Campanha encerrada', tone: 'muted' };
  if (p.campaign_status === 'pausada') return { label: 'Campanha pausada', tone: 'muted' };
  const due = p.next_due;
  const until = p.next_due_until || due;
  const stage = p.attempts + 1 <= 1 ? 'Mensagem inicial' : `Follow-up ${p.attempts}`;
  if (p.status === 'pendente') return { label: 'Enviar mensagem inicial', tone: 'primary' };
  if (due && due <= t) {
    const late = until < t;
    if (p.next_due_type === 'retorno') return { label: late ? 'Retorno atrasado' : 'Retornar hoje', tone: late ? 'danger' : 'warning' };
    if (late) return { label: `${stage} atrasado`, tone: 'danger' };
    return { label: until > t ? `${stage} até ${fmt(until)}` : `${stage} hoje`, tone: 'warning' };
  }
  switch (p.status) {
    case 'enviada': case 'aguardando':
      return due ? { label: `Aguardar · ${stage} ${until !== due ? `${fmt(due)}–${fmt(until)}` : fmt(due)}`, tone: 'muted' }
        : { label: p.no_response_deadline ? `Aguardar até ${fmt(p.no_response_deadline)} · sem novas tentativas` : 'Aguardar resposta', tone: 'muted' };
    case 'followup_pendente': return { label: `Enviar ${stage}`, tone: 'warning' };
    case 'respondeu': return { label: 'Qualificar resposta', tone: 'primary' };
    case 'interesse': return { label: 'Negociar', tone: 'primary' };
    case 'negociacao': return { label: 'Fechar negociação', tone: 'primary' };
    case 'retorno_futuro': return { label: `Retornar em ${fmt(p.return_date || due)}`, tone: 'muted' };
    default: return { label: '—', tone: 'muted' };
  }
}
const fmt = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');

export async function queueCounts(req, baseQuery) {
  const q = { ...baseQuery };
  delete q.queue; delete q.status; delete q.metric;
  const { where, params } = participantWhere(req, q);
  const t = today();
  return one(`SELECT
      count(*) FILTER (WHERE cc.status='pendente' AND c.status='ativa')::int AS para_enviar,
      count(*) FILTER (WHERE c.status='ativa' AND EXISTS (SELECT 1 FROM followups f WHERE f.campaign_contact_id=cc.id AND f.status='pendente' AND f.due_date <= '${t}' AND COALESCE(f.due_until, f.due_date) >= '${t}'))::int AS followups_hoje,
      count(*) FILTER (WHERE c.status='ativa' AND EXISTS (SELECT 1 FROM followups f WHERE f.campaign_contact_id=cc.id AND f.status='pendente' AND COALESCE(f.due_until, f.due_date) < '${t}'))::int AS atrasados,
      count(*) FILTER (WHERE cc.status IN ('enviada','aguardando') AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.campaign_contact_id=cc.id AND f.status='pendente' AND f.due_date <= '${t}'))::int AS aguardando,
      count(*) FILTER (WHERE cc.status IN ('respondeu','interesse','negociacao'))::int AS negociacao,
      count(*) FILTER (WHERE cc.status='retorno_futuro')::int AS retornos,
      count(*)::int AS total,
      count(*) FILTER (WHERE cc.status <> 'pendente')::int AS trabalhados
    ${PARTICIPANT_FROM} WHERE ${where}`, params);
}

/** Alertas de abordagem duplicada/excessiva para um contato. */
export async function contactWarnings(contactId, campaignId, recentDays) {
  const warnings = [];
  const others = await many(`SELECT c.name, c.status AS campaign_status, cc.status, u.name AS assigned_name
    FROM campaign_contacts cc JOIN campaigns c ON c.id=cc.campaign_id LEFT JOIN users u ON u.id=cc.assigned_to
    WHERE cc.contact_id=$1 AND cc.campaign_id<>$2 AND c.status IN ('ativa','pausada')
      AND cc.status NOT IN ('convertido','sem_interesse','sem_resposta','opt_out')`, [contactId, campaignId]);
  for (const o of others) warnings.push({ level: 'warning', msg: `Também está na campanha ativa "${o.name}"${o.assigned_name ? ` (com ${o.assigned_name})` : ''} — situação: ${o.status}.` });
  const recent = await one(`SELECT i.created_at, c.name, u.name AS user_name FROM interactions i LEFT JOIN campaigns c ON c.id=i.campaign_id LEFT JOIN users u ON u.id=i.user_id
    WHERE i.contact_id=$1 AND i.type='envio' AND COALESCE(i.campaign_id,0)<>$2 AND i.created_at > now() - make_interval(days => $3::int)
    ORDER BY i.created_at DESC LIMIT 1`, [contactId, campaignId, recentDays]);
  if (recent) warnings.push({ level: 'warning', msg: `Recebeu mensagem há poucos dias (${new Date(recent.created_at).toLocaleDateString('pt-BR')}, campanha "${recent.name}", por ${recent.user_name}).` });
  return warnings;
}
