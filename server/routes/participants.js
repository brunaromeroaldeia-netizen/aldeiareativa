import { Router } from 'express';
import { z } from 'zod';
import { many, one, tx } from '../db.js';
import { ah, bad, parse, intParam, notFound, forbidden, conflict } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { today, addDays } from '../lib/dates.js';
import { renderTemplate, templateData, pickTemplate } from '../lib/template.js';
import { getSettings } from './settings.js';
import { participantWhere, PARTICIPANT_FROM, PARTICIPANT_COLUMNS, nextAction, queueCounts, contactWarnings } from '../services/participants.js';

const r = Router();

// ---------------- Listagem (Minha Operação / drill-down) ----------------
r.get('/', ah(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(200, Number(req.query.pageSize) || 50);
  const { where, params } = participantWhere(req);
  const order = {
    atrasados: 'next_due ASC NULLS LAST, ct.full_name',
    followups_hoje: 'ct.full_name',
    para_enviar: 'cc.id',
  }[req.query.queue] || `CASE WHEN cc.status='pendente' THEN 1 ELSE 2 END, next_due ASC NULLS LAST, cc.updated_at DESC`;
  const rows = await many(`SELECT * FROM (SELECT ${PARTICIPANT_COLUMNS} ${PARTICIPANT_FROM} WHERE ${where}) x
    ORDER BY ${order.replaceAll('ct.', '').replaceAll('cc.', '')} LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
  const { n } = await one(`SELECT count(*)::int AS n ${PARTICIPANT_FROM} WHERE ${where}`, params);
  const t = today();
  res.json({ rows: rows.map((p) => ({ ...p, next_action: nextAction(p, t) })), total: n, page, pageSize: size, today: t });
}));

r.get('/queues', ah(async (req, res) => res.json(await queueCounts(req, req.query))));

// Kanban: contagem + primeiros itens por status
r.get('/board', ah(async (req, res) => {
  const q = { ...req.query };
  delete q.status; delete q.queue;
  const { where, params } = participantWhere(req, q);
  const rows = await many(`SELECT * FROM (SELECT ${PARTICIPANT_COLUMNS}, row_number() OVER (PARTITION BY cc.status ORDER BY cc.updated_at DESC) AS rn
    ${PARTICIPANT_FROM} WHERE ${where}) x WHERE rn <= 60`, params);
  const counts = await many(`SELECT cc.status, count(*)::int AS n ${PARTICIPANT_FROM} WHERE ${where} GROUP BY 1`, params);
  const t = today();
  res.json({ rows: rows.map((p) => ({ ...p, next_action: nextAction(p, t) })), counts });
}));

// ---------------- Detalhe ----------------
async function loadParticipant(id, req, { lock, client } = {}) {
  const q = client ? (sql, p) => client.query(sql, p).then((x) => x.rows[0]) : one;
  const p = await q(`SELECT cc.*, c.name AS campaign_name, c.status AS campaign_status, c.followup_days, c.max_attempts, c.product_ids,
      c.promo_description, c.is_demo AS campaign_is_demo
    FROM campaign_contacts cc JOIN campaigns c ON c.id=cc.campaign_id WHERE cc.id=$1 ${lock ? 'FOR UPDATE OF cc' : ''}`, [id]);
  if (!p) throw notFound('Contato da campanha não encontrado.');
  if (req.user.role !== 'admin' && p.assigned_to !== req.user.id) throw notFound('Contato da campanha não encontrado.');
  return p;
}

function canAct(req, p) {
  if (req.user.role === 'admin') return;
  if (p.assigned_to !== req.user.id) throw forbidden('Este contato está atribuído a outra vendedora. Peça a reatribuição à administradora.');
}

async function buildMessage(p, contact, opportunity, seller, settings, templateId) {
  const templates = await many('SELECT * FROM message_templates WHERE campaign_id=$1 AND active ORDER BY step, id', [p.campaign_id]);
  const step = p.attempts + 1;
  const ctx = { step, product_id: opportunity?.product_id ?? p.product_ids?.[0] ?? null, ref_year: opportunity?.ref_year ?? null, historical_status: opportunity?.historical_status ?? null };
  let tpl = templateId ? templates.find((t) => t.id === templateId) : pickTemplate(templates, ctx);
  const product = ctx.product_id ? await one('SELECT name FROM products WHERE id=$1', [ctx.product_id]) : null;
  const data = templateData({ contact, opportunity, product, campaign: { name: p.campaign_name }, seller, unit: settings.unidade_padrao });
  const rendered = tpl ? renderTemplate(tpl.body, data) : { text: '', warnings: [step > 1 ? 'Nenhuma mensagem de follow-up cadastrada para esta etapa.' : 'Nenhuma mensagem inicial cadastrada para este segmento.'] };
  if (!contact.first_name) rendered.warnings.unshift('Contato sem primeiro nome identificado — revise a saudação antes de enviar.');
  return {
    step, template: tpl ? { id: tpl.id, name: tpl.name, version: tpl.version, kind: tpl.kind, step: tpl.step } : null,
    text: rendered.text, warnings: rendered.warnings,
    options: templates.map((t) => ({ id: t.id, name: t.name, kind: t.kind, step: t.step, product_id: t.product_id, ref_year: t.ref_year, historical_status: t.historical_status })),
  };
}

r.get('/:id', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const p = await loadParticipant(id, req);
  const settings = await getSettings();
  const contact = await one('SELECT * FROM contacts WHERE id=$1', [p.contact_id]);
  const opportunity = p.opportunity_id ? await one(`SELECT o.*, pr.name AS product_name FROM opportunities o LEFT JOIN products pr ON pr.id=o.product_id WHERE o.id=$1`, [p.opportunity_id]) : null;
  const seller = p.assigned_to ? await one('SELECT id, name FROM users WHERE id=$1', [p.assigned_to]) : null;
  const opportunities = await many(`SELECT o.id, o.ref_year, o.historical_status, o.created_date, o.won_date, o.lost_date, o.lost_reason, o.value,
      o.original_owner, o.year_inferred, o.year_source, o.notes, pr.name AS product_name
    FROM opportunities o LEFT JOIN products pr ON pr.id=o.product_id WHERE o.contact_id=$1 ORDER BY o.ref_year DESC NULLS LAST, o.id DESC`, [p.contact_id]);
  const events = await many(`SELECT i.*, u.name AS user_name, t.name AS template_name FROM interactions i
    LEFT JOIN users u ON u.id=i.user_id LEFT JOIN message_templates t ON t.id=i.template_id
    WHERE i.campaign_contact_id=$1 AND i.type <> 'copia' ORDER BY i.created_at DESC, i.id DESC`, [id]);
  const followups = await many(`SELECT * FROM followups WHERE campaign_contact_id=$1 ORDER BY due_date DESC, id DESC`, [id]);
  // participações anteriores/simultâneas (histórico de relacionamento)
  const history = await many(`SELECT cc.id, cc.status, cc.attempts, cc.first_sent_at, cc.last_sent_at, cc.responded_at, cc.converted_at, cc.conversion_value,
      c.id AS campaign_id, c.name AS campaign_name, c.status AS campaign_status, c.start_date, u.name AS assigned_name,
      (SELECT json_agg(json_build_object('type', i.type, 'at', i.created_at, 'text', i.message_text, 'note', i.note, 'to_status', i.to_status, 'user', uu.name, 'attempt', i.attempt) ORDER BY i.created_at)
         FROM interactions i LEFT JOIN users uu ON uu.id=i.user_id WHERE i.campaign_contact_id=cc.id AND i.type IN ('envio','status','nota','conversao','opt_out')) AS events
    FROM campaign_contacts cc JOIN campaigns c ON c.id=cc.campaign_id LEFT JOIN users u ON u.id=cc.assigned_to
    WHERE cc.contact_id=$1 AND cc.id<>$2 ORDER BY cc.added_at DESC`, [p.contact_id, id]);
  const warnings = await contactWarnings(p.contact_id, p.campaign_id, Number(settings.janela_abordagem_recente_dias ?? 30));
  if (contact.do_not_contact) warnings.unshift({ level: 'danger', msg: 'Contato pediu para não receber comunicações (opt-out). Não envie mensagens.' });
  const templateId = req.query.template_id ? Number(req.query.template_id) : null;
  // {{vendedora}} = quem abriu o contato (é quem vai copiar e enviar), nunca o responsável antigo
  const message = await buildMessage(p, contact, opportunity, req.user, settings, templateId);
  const t = today();
  res.json({
    participant: { ...p, next_action: nextAction({ ...p, next_due: followups.find((f) => f.status === 'pendente')?.due_date, next_due_type: followups.find((f) => f.status === 'pendente')?.type }, t) },
    contact, opportunity, seller, opportunities, events, followups, history, warnings, message, today: t,
    canAct: req.user.role === 'admin' || p.assigned_to === req.user.id,
  });
}));

// ---------------- Ações ----------------
async function addEvent(c, p, req, ev) {
  await c.query(`INSERT INTO interactions(campaign_contact_id, campaign_id, contact_id, user_id, type, attempt, from_status, to_status, message_text,
      template_id, template_version, note, value, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [p.id, p.campaign_id, p.contact_id, req.user.id, ev.type, ev.attempt ?? null, ev.from ?? null, ev.to ?? null, ev.text ?? null,
    ev.template_id ?? null, ev.template_version ?? null, ev.note ?? null, ev.value ?? null, p.is_demo]);
}

async function cancelFollowups(c, p, req, reason, { types = ['followup', 'retorno'] } = {}) {
  const r1 = await c.query(`UPDATE followups SET status='cancelado', status_reason=$3, completed_at=now(), completed_by=$4
    WHERE campaign_contact_id=$1 AND status='pendente' AND type = ANY($2) RETURNING id`, [p.id, types, reason, req.user.id]);
  if (r1.rowCount) await addEvent(c, p, req, { type: 'followup_cancelado', note: `Follow-up cancelado: ${reason}` });
  return r1.rowCount;
}

r.post('/:id/copy', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const d = parse(z.object({ template_id: z.number().int().nullable().optional(), edited: z.boolean().optional() }), req.body);
  await tx(async (c) => {
    const p = await loadParticipant(id, req, { client: c });
    await addEvent(c, p, req, { type: 'copia', template_id: d.template_id ?? null, note: d.edited ? 'Mensagem copiada (editada)' : 'Mensagem copiada' });
  });
  res.json({ ok: true });
}));

const SENDABLE = ['pendente', 'enviada', 'aguardando', 'followup_pendente', 'retorno_futuro'];

r.post('/:id/send', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const d = parse(z.object({
    message_text: z.string().min(1).max(5000),
    template_id: z.number().int().nullable().optional(),
    template_version: z.number().int().nullable().optional(),
    expected_attempts: z.number().int().min(0),
    note: z.string().max(2000).optional(),
  }), req.body);
  const result = await tx(async (c) => {
    const p = await loadParticipant(id, req, { lock: true, client: c });
    canAct(req, p);
    if (!p.assigned_to && req.user.role !== 'admin') throw forbidden('Contato sem responsável definido.');
    if (p.campaign_status !== 'ativa') throw bad(`A campanha está ${p.campaign_status}. Envios só podem ser registrados em campanhas ativas.`);
    const ct = (await c.query('SELECT do_not_contact FROM contacts WHERE id=$1', [p.contact_id])).rows[0];
    if (ct.do_not_contact) throw bad('Contato com bloqueio de comunicação (opt-out).');
    if (p.attempts !== d.expected_attempts) throw conflict('Este envio já foi registrado (possivelmente em outra aba ou por outra pessoa). Atualize a ficha.');
    if (!SENDABLE.includes(p.status)) throw bad('A situação atual deste contato não permite registrar um novo envio de reativação.');
    const attempts = p.attempts + 1;
    const t = today();
    const fromStatus = p.status;
    const status = attempts === 1 ? 'enviada' : 'aguardando';
    // follow-ups pendentes desta etapa são concluídos pelo envio
    const done = await c.query(`UPDATE followups SET status='realizado', completed_at=now(), completed_by=$2 WHERE campaign_contact_id=$1 AND status='pendente' RETURNING id`, [p.id, req.user.id]);
    let nextDue = null;
    let deadline = null;
    if (attempts < p.max_attempts) {
      nextDue = addDays(t, p.followup_days);
      await c.query(`INSERT INTO followups(campaign_contact_id, campaign_id, type, step, due_date, created_by) VALUES ($1,$2,'followup',$3,$4,$5)`,
        [p.id, p.campaign_id, attempts + 1, nextDue, req.user.id]);
    } else {
      deadline = addDays(t, p.followup_days);
    }
    await c.query(`UPDATE campaign_contacts SET attempts=$2, status=$3, first_sent_at=COALESCE(first_sent_at, now()), last_sent_at=now(),
        no_response_deadline=$4, return_date=NULL, updated_at=now(),
        assigned_to=COALESCE(assigned_to, $5), assigned_at=COALESCE(assigned_at, now()) WHERE id=$1`,
      [p.id, attempts, status, deadline, req.user.id]);
    await addEvent(c, p, req, { type: 'envio', attempt: attempts, from: fromStatus, to: status, text: d.message_text,
      template_id: d.template_id ?? null, template_version: d.template_version ?? null, note: d.note || (done.rowCount ? `Follow-up realizado (${attempts}ª abordagem)` : null) });
    if (nextDue) await addEvent(c, p, req, { type: 'followup_agendado', note: `Follow-up agendado para ${nextDue.split('-').reverse().join('/')}` });
    else await addEvent(c, p, req, { type: 'sistema', note: `Limite de ${p.max_attempts} abordagens atingido. Sem resposta até ${deadline.split('-').reverse().join('/')}, o contato será encerrado como "sem resposta".` });
    return { attempts, status, nextDue, deadline };
  });
  res.json(result);
}));

const outcomeSchema = z.object({
  status: z.enum(['respondeu', 'interesse', 'negociacao', 'retorno_futuro', 'convertido', 'sem_interesse', 'sem_resposta', 'opt_out', 'aguardando']),
  note: z.string().max(4000).optional().nullable(),
  return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  conversion_value: z.number().min(0).max(100000000).optional().nullable(),
  conversion_product_id: z.number().int().optional().nullable(),
  conversion_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const LABEL = {
  pendente: 'Pendente', enviada: 'Mensagem enviada', aguardando: 'Aguardando resposta', followup_pendente: 'Follow-up pendente',
  respondeu: 'Cliente respondeu', interesse: 'Demonstrou interesse', retorno_futuro: 'Retorno futuro', negociacao: 'Em negociação',
  convertido: 'Convertido', sem_interesse: 'Sem interesse', sem_resposta: 'Sem resposta', opt_out: 'Não contatar (opt-out)',
};

r.post('/:id/outcome', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const d = parse(outcomeSchema, req.body);
  const out = await tx(async (c) => {
    const p = await loadParticipant(id, req, { lock: true, client: c });
    canAct(req, p);
    const from = p.status;
    if (from === d.status && d.status !== 'retorno_futuro') throw bad('O contato já está nesta situação.');
    if (p.campaign_status === 'encerrada' && req.user.role !== 'admin') throw bad('Campanha encerrada: somente a administradora pode ajustar resultados.');
    if (from === 'pendente' && !['opt_out', 'convertido', 'respondeu', 'interesse'].includes(d.status)) throw bad('Confirme o envio da primeira mensagem antes de atualizar a situação.');
    if (from === 'opt_out' && req.user.role !== 'admin') throw bad('Contato em opt-out. Somente a administradora pode reverter.');
    if (from === 'convertido' && req.user.role !== 'admin') throw bad('Conversão registrada. Somente a administradora pode corrigir.');
    if (d.status === 'retorno_futuro' && (!d.return_date || d.return_date <= today())) throw bad('Informe uma data futura para o retorno.');
    if (d.status === 'aguardando' && !p.attempts) throw bad('Nenhuma mensagem enviada ainda.');

    const set = { status: d.status };
    const now = 'now()';
    const responded = ['respondeu', 'interesse', 'negociacao', 'retorno_futuro', 'convertido', 'sem_interesse', 'opt_out'];
    const sqlParts = ['status=$2', 'updated_at=now()'];
    if (responded.includes(d.status) && p.attempts > 0) sqlParts.push(`responded_at=COALESCE(responded_at, ${now})`);
    if (['interesse', 'negociacao', 'convertido'].includes(d.status)) sqlParts.push(`interested_at=COALESCE(interested_at, ${now})`);
    if (['negociacao', 'convertido'].includes(d.status)) sqlParts.push(`negotiation_at=COALESCE(negotiation_at, ${now})`);
    const params = [p.id, d.status];
    if (d.status === 'convertido') {
      params.push(d.conversion_date || null, d.conversion_value ?? null, d.conversion_product_id ?? null);
      sqlParts.push(`converted_at=COALESCE($3::date::timestamptz + (now() - date_trunc('day', now())), now())`, `conversion_value=$4`, `conversion_product_id=COALESCE($5, conversion_product_id)`);
    } else if (from === 'convertido') {
      sqlParts.push('converted_at=NULL', 'conversion_value=NULL');
    }
    if (['convertido', 'sem_interesse', 'sem_resposta', 'opt_out'].includes(d.status)) sqlParts.push('closed_at=now()', 'no_response_deadline=NULL');
    else sqlParts.push('closed_at=NULL');
    if (d.status === 'retorno_futuro') { params.push(d.return_date); sqlParts.push(`return_date=$${params.length}`); }
    else if (d.status !== 'aguardando') sqlParts.push('return_date=NULL');
    if (responded.includes(d.status)) sqlParts.push('no_response_deadline=NULL');
    await c.query(`UPDATE campaign_contacts SET ${[...new Set(sqlParts)].join(', ')} WHERE id=$1`, params);

    await addEvent(c, p, req, { type: d.status === 'convertido' ? 'conversao' : d.status === 'opt_out' ? 'opt_out' : 'status', from, to: d.status,
      note: d.note || null, value: d.status === 'convertido' ? d.conversion_value ?? null : null });

    // regras de follow-up
    if (d.status !== 'aguardando') await cancelFollowups(c, p, req, `cliente marcado como "${LABEL[d.status]}"`);
    if (d.status === 'retorno_futuro') {
      await c.query(`INSERT INTO followups(campaign_contact_id, campaign_id, type, step, due_date, created_by) VALUES ($1,$2,'retorno',$3,$4,$5)`,
        [p.id, p.campaign_id, p.attempts + 1, d.return_date, req.user.id]);
      await addEvent(c, p, req, { type: 'followup_agendado', note: `Retorno agendado para ${d.return_date.split('-').reverse().join('/')}` });
    }
    if (d.status === 'opt_out') {
      await c.query(`UPDATE contacts SET do_not_contact=TRUE, dnc_at=now(), dnc_by=$2, dnc_reason=COALESCE($3,'Pedido registrado na campanha'), updated_at=now() WHERE id=$1`,
        [p.contact_id, req.user.id, d.note || null]);
      // bloqueia as demais campanhas em andamento
      const others = (await c.query(`SELECT cc.* FROM campaign_contacts cc JOIN campaigns cp ON cp.id=cc.campaign_id
         WHERE cc.contact_id=$1 AND cc.id<>$2 AND cc.status NOT IN ('convertido','sem_interesse','sem_resposta','opt_out') FOR UPDATE OF cc`, [p.contact_id, p.id])).rows;
      for (const o of others) {
        await c.query(`UPDATE campaign_contacts SET status='opt_out', closed_at=now(), updated_at=now() WHERE id=$1`, [o.id]);
        await cancelFollowups(c, o, req, 'contato pediu para não ser contatado');
        await addEvent(c, o, req, { type: 'opt_out', from: o.status, to: 'opt_out', note: `Opt-out registrado na campanha "${p.campaign_name}"` });
      }
      await c.query(`INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES ($1,'opt_out','contact',$2,$3)`, [req.user.id, p.contact_id, { campaign_id: p.campaign_id }]);
    }
    if (d.status === 'aguardando' && p.attempts < p.max_attempts) {
      // reabre a sequência: agenda novo follow-up se não houver
      const has = (await c.query(`SELECT 1 FROM followups WHERE campaign_contact_id=$1 AND status='pendente'`, [p.id])).rowCount;
      if (!has) {
        const due = addDays(today(), p.followup_days);
        await c.query(`INSERT INTO followups(campaign_contact_id, campaign_id, type, step, due_date, created_by) VALUES ($1,$2,'followup',$3,$4,$5)`, [p.id, p.campaign_id, p.attempts + 1, due, req.user.id]);
      }
    }
    return { status: d.status };
  });
  res.json(out);
}));

r.post('/:id/note', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const { note } = parse(z.object({ note: z.string().trim().min(1).max(4000) }), req.body);
  await tx(async (c) => {
    const p = await loadParticipant(id, req, { client: c });
    canAct(req, p);
    await addEvent(c, p, req, { type: 'nota', note });
  });
  res.json({ ok: true });
}));

r.patch('/:id', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const { notes } = parse(z.object({ notes: z.string().max(4000).nullable() }), req.body);
  await tx(async (c) => {
    const p = await loadParticipant(id, req, { client: c });
    canAct(req, p);
    await c.query('UPDATE campaign_contacts SET notes=$2, updated_at=now() WHERE id=$1', [id, notes]);
  });
  res.json({ ok: true });
}));

/** Reprograma o próximo follow-up (ou cancela). Em campanha encerrada, apenas a administradora. */
r.post('/:id/followup', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const d = parse(z.object({ due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), note: z.string().max(1000).optional() }), req.body);
  await tx(async (c) => {
    const p = await loadParticipant(id, req, { lock: true, client: c });
    canAct(req, p);
    if (p.campaign_status === 'encerrada' && req.user.role !== 'admin') throw bad('Campanha encerrada: apenas a administradora pode reprogramar.');
    if (['convertido', 'opt_out'].includes(p.status)) throw bad('Contato convertido ou em opt-out não recebe follow-up.');
    if (d.due_date && d.due_date < today()) throw bad('Escolha uma data a partir de hoje.');
    await cancelFollowups(c, p, req, d.due_date ? 'reprogramado' : 'cancelado manualmente');
    if (d.due_date) {
      const type = p.status === 'retorno_futuro' ? 'retorno' : 'followup';
      await c.query(`INSERT INTO followups(campaign_contact_id, campaign_id, type, step, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [p.id, p.campaign_id, type, p.attempts + 1, d.due_date, req.user.id]);
      await addEvent(c, p, req, { type: 'followup_agendado', note: `Follow-up reprogramado para ${d.due_date.split('-').reverse().join('/')}${d.note ? ` — ${d.note}` : ''}` });
      if (['sem_resposta', 'sem_interesse'].includes(p.status) || p.status === 'followup_pendente') {
        await c.query(`UPDATE campaign_contacts SET status='aguardando', closed_at=NULL, no_response_deadline=NULL, updated_at=now() WHERE id=$1`, [p.id]);
      }
    }
  });
  res.json({ ok: true });
}));

r.post('/:id/assign', ah(async (req, res) => {
  if (req.user.role !== 'admin') throw forbidden();
  const id = intParam(req.params.id);
  const { user_id } = parse(z.object({ user_id: z.number().int().nullable() }), req.body);
  await tx(async (c) => {
    const p = await loadParticipant(id, req, { lock: true, client: c });
    if (user_id) {
      const u = (await c.query(`SELECT name FROM users WHERE id=$1 AND role='vendedora' AND active`, [user_id])).rows[0];
      if (!u) throw bad('Vendedora inválida.');
      await addEvent(c, p, req, { type: 'atribuicao', note: `Reatribuído a ${u.name}` });
    } else await addEvent(c, p, req, { type: 'atribuicao', note: 'Atribuição removida' });
    await c.query(`UPDATE campaign_contacts SET assigned_to=$2, assigned_at=CASE WHEN $2::int IS NULL THEN NULL ELSE now() END, updated_at=now() WHERE id=$1`, [id, user_id]);
  });
  await audit(req, 'reatribuicao', 'campaign_contact', id, { user_id });
  res.json({ ok: true });
}));

export default r;
