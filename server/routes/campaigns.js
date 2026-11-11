import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { ah, bad, parse, intParam, notFound, forbidden } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAdmin } from '../auth.js';
import { eligibilitySql, eligibilityPreview, distribute, campaignSummary } from '../services/campaigns.js';

const r = Router();

const campaignSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  promo_description: z.string().trim().max(4000).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  product_ids: z.array(z.number().int()).default([]),
  years: z.array(z.number().int().min(1990).max(2100)).default([]),
  historical_statuses: z.array(z.enum(['ganho', 'perdido', 'aberto', 'revisao'])).default([]),
  filters: z.object({
    lost_reasons: z.array(z.string()).optional(),
    exclude_recent_days: z.number().int().min(0).max(730).optional(),
    exclude_active_campaigns: z.boolean().optional(),
    exclude_converted: z.boolean().optional(),
    previous: z.enum(['todos', 'nunca_abordados', 'ja_abordados']).optional(),
  }).default({}),
  goal_contacts: z.number().int().min(0).nullable().optional(),
  goal_conversions: z.number().int().min(0).nullable().optional(),
  goal_revenue: z.number().min(0).nullable().optional(),
  followup_days: z.number().int().min(1).max(60).default(3),
  max_attempts: z.number().int().min(1).max(10).default(3),
  seller_ids: z.array(z.number().int()).default([]),
});

async function loadCampaign(id, req) {
  const c = await one(`SELECT c.*, u.name AS created_by_name,
      COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name) FROM campaign_sellers cs JOIN users s ON s.id=cs.user_id WHERE cs.campaign_id=c.id), '[]') AS sellers,
      COALESCE((SELECT json_agg(p.name ORDER BY p.sort_order) FROM products p WHERE p.id = ANY(c.product_ids)), '[]') AS product_names
    FROM campaigns c LEFT JOIN users u ON u.id=c.created_by WHERE c.id=$1`, [id]);
  if (!c) throw notFound('Campanha não encontrada.');
  if (req.user.role !== 'admin' && c.status === 'rascunho') throw forbidden();
  return c;
}

r.get('/', ah(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.status) { params.push(String(req.query.status).split(',')); where.push(`c.status = ANY($${params.length})`); }
  if (req.query.product_id) { params.push(Number(req.query.product_id)); where.push(`$${params.length} = ANY(c.product_ids)`); }
  if (req.user.role !== 'admin') where.push(`c.status <> 'rascunho'`);
  const rows = await many(`SELECT c.id, c.name, c.status, c.start_date, c.end_date, c.product_ids, c.years, c.historical_statuses,
      c.goal_contacts, c.goal_conversions, c.is_demo, c.created_at, c.closed_at,
      COALESCE((SELECT json_agg(p.name ORDER BY p.sort_order) FROM products p WHERE p.id = ANY(c.product_ids)), '[]') AS product_names,
      COALESCE((SELECT json_agg(s.name ORDER BY s.name) FROM campaign_sellers cs JOIN users s ON s.id=cs.user_id WHERE cs.campaign_id=c.id), '[]') AS sellers,
      count(cc.id)::int AS participants,
      count(cc.id) FILTER (WHERE cc.status <> 'pendente')::int AS worked,
      count(cc.first_sent_at)::int AS sent,
      count(cc.responded_at)::int AS responded,
      count(cc.converted_at)::int AS converted,
      COALESCE(sum(cc.conversion_value) FILTER (WHERE cc.converted_at IS NOT NULL),0) AS revenue
      ${req.user.role !== 'admin' ? `, count(cc.id) FILTER (WHERE cc.assigned_to=${Number(req.user.id)})::int AS mine` : ''}
    FROM campaigns c LEFT JOIN campaign_contacts cc ON cc.campaign_id=c.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY c.id ORDER BY CASE c.status WHEN 'ativa' THEN 0 WHEN 'pausada' THEN 1 WHEN 'rascunho' THEN 2 ELSE 3 END, c.created_at DESC`, params);
  res.json(rows);
}));

r.get('/:id', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const c = await loadCampaign(id, req);
  const summary = await campaignSummary(id);
  const bySeller = await many(`SELECT u.id, u.name,
      count(cc.id)::int AS assigned,
      count(cc.id) FILTER (WHERE cc.status <> 'pendente')::int AS worked,
      count(cc.id) FILTER (WHERE cc.status = 'pendente')::int AS pending,
      count(cc.first_sent_at)::int AS sent, count(cc.responded_at)::int AS responded, count(cc.converted_at)::int AS converted
    FROM users u LEFT JOIN campaign_contacts cc ON cc.assigned_to=u.id AND cc.campaign_id=$1
    WHERE u.role='vendedora' AND u.active GROUP BY u.id ORDER BY u.name`, [id]);
  const byStatus = await many(`SELECT status, count(*)::int AS n FROM campaign_contacts WHERE campaign_id=$1 GROUP BY 1`, [id]);
  const bySegment = await many(`SELECT o.product_id, p.name AS product_name, o.ref_year, o.historical_status,
      count(*)::int AS participants, count(cc.assigned_to)::int AS assigned,
      count(cc.first_sent_at)::int AS sent, count(cc.responded_at)::int AS responded, count(cc.converted_at)::int AS converted,
      COALESCE(json_agg(DISTINCT cc.assigned_to) FILTER (WHERE cc.assigned_to IS NOT NULL), '[]') AS seller_ids
    FROM campaign_contacts cc LEFT JOIN opportunities o ON o.id=cc.opportunity_id LEFT JOIN products p ON p.id=o.product_id
    WHERE cc.campaign_id=$1 GROUP BY 1,2,3,4 ORDER BY p.name, o.ref_year DESC NULLS LAST, o.historical_status`, [id]);
  res.json({ ...c, summary, bySeller, byStatus, bySegment });
}));

async function saveSellers(client, campaignId, sellerIds) {
  await client.query('DELETE FROM campaign_sellers WHERE campaign_id=$1', [campaignId]);
  for (const u of sellerIds) await client.query('INSERT INTO campaign_sellers VALUES ($1,$2) ON CONFLICT DO NOTHING', [campaignId, u]);
}

r.post('/', requireAdmin, ah(async (req, res) => {
  const d = parse(campaignSchema, req.body);
  if (d.start_date && d.end_date && d.end_date < d.start_date) throw bad('A data de encerramento deve ser posterior ao início.');
  const id = await tx(async (c) => {
    const row = (await c.query(`INSERT INTO campaigns(name, description, promo_description, start_date, end_date, product_ids, years, historical_statuses,
        filters, goal_contacts, goal_conversions, goal_revenue, followup_days, max_attempts, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [d.name, d.description ?? null, d.promo_description ?? null, d.start_date ?? null, d.end_date ?? null, d.product_ids, d.years,
        d.historical_statuses, d.filters, d.goal_contacts ?? null, d.goal_conversions ?? null, d.goal_revenue ?? null, d.followup_days, d.max_attempts, req.user.id])).rows[0];
    await saveSellers(c, row.id, d.seller_ids);
    return row.id;
  });
  await audit(req, 'campanha_criada', 'campaign', id, { name: d.name });
  res.json({ id });
}));

r.patch('/:id', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const cur = await loadCampaign(id, req);
  if (cur.status === 'encerrada') throw bad('Campanhas encerradas são preservadas e não podem ser editadas. Duplique-a para reutilizar.');
  const d = parse(campaignSchema, req.body);
  if (d.start_date && d.end_date && d.end_date < d.start_date) throw bad('A data de encerramento deve ser posterior ao início.');
  await tx(async (c) => {
    await c.query(`UPDATE campaigns SET name=$2, description=$3, promo_description=$4, start_date=$5, end_date=$6, product_ids=$7, years=$8,
        historical_statuses=$9, filters=$10, goal_contacts=$11, goal_conversions=$12, goal_revenue=$13, followup_days=$14, max_attempts=$15, updated_at=now()
      WHERE id=$1`, [id, d.name, d.description ?? null, d.promo_description ?? null, d.start_date ?? null, d.end_date ?? null, d.product_ids, d.years,
      d.historical_statuses, d.filters, d.goal_contacts ?? null, d.goal_conversions ?? null, d.goal_revenue ?? null, d.followup_days, d.max_attempts]);
    await saveSellers(c, id, d.seller_ids);
  });
  await audit(req, 'campanha_editada', 'campaign', id, { name: d.name });
  res.json({ ok: true });
}));

r.post('/:id/status', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const { action } = parse(z.object({ action: z.enum(['ativar', 'pausar', 'encerrar', 'retomar']) }), req.body);
  const c = await loadCampaign(id, req);
  const allowed = { ativar: ['rascunho'], retomar: ['pausada'], pausar: ['ativa'], encerrar: ['rascunho', 'ativa', 'pausada'] }[action];
  if (!allowed.includes(c.status)) throw bad(`Não é possível ${action} uma campanha com status "${c.status}".`);
  if (action === 'ativar' || action === 'retomar') {
    const tpl = await one(`SELECT count(*)::int AS n FROM message_templates WHERE campaign_id=$1 AND kind='inicial' AND active`, [id]);
    if (!tpl.n) throw bad('Cadastre ao menos uma mensagem inicial antes de ativar a campanha.');
    const p = await one('SELECT count(*)::int AS n FROM campaign_contacts WHERE campaign_id=$1', [id]);
    if (!p.n) throw bad('Adicione contatos à campanha antes de ativá-la.');
  }
  await tx(async (cl) => {
    if (action === 'ativar' || action === 'retomar') await cl.query(`UPDATE campaigns SET status='ativa', activated_at=COALESCE(activated_at, now()), updated_at=now() WHERE id=$1`, [id]);
    if (action === 'pausar') await cl.query(`UPDATE campaigns SET status='pausada', updated_at=now() WHERE id=$1`, [id]);
    if (action === 'encerrar') {
      await cl.query(`UPDATE campaigns SET status='encerrada', closed_at=now(), closed_by=$2, updated_at=now() WHERE id=$1`, [id, req.user.id]);
      const sus = await cl.query(`UPDATE followups SET status='suspenso', status_reason='Campanha encerrada' WHERE campaign_id=$1 AND status='pendente' RETURNING campaign_contact_id`, [id]);
      if (sus.rowCount) {
        await cl.query(`INSERT INTO interactions(campaign_contact_id, campaign_id, contact_id, user_id, type, note, is_demo)
          SELECT cc.id, cc.campaign_id, cc.contact_id, $2, 'followup_cancelado', 'Follow-up suspenso: campanha encerrada', cc.is_demo
          FROM campaign_contacts cc WHERE cc.id = ANY($1)`, [sus.rows.map((x) => x.campaign_contact_id), req.user.id]);
      }
    }
  });
  await audit(req, `campanha_${action}`, 'campaign', id);
  res.json({ ok: true });
}));

r.post('/:id/duplicate', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const c = await loadCampaign(id, req);
  const { name } = parse(z.object({ name: z.string().trim().min(3).max(120).optional() }), req.body || {});
  const newId = await tx(async (cl) => {
    const row = (await cl.query(`INSERT INTO campaigns(name, description, promo_description, product_ids, years, historical_statuses, filters,
        goal_contacts, goal_conversions, goal_revenue, followup_days, max_attempts, template_from_id, created_by)
      SELECT $2, description, promo_description, product_ids, years, historical_statuses, filters, goal_contacts, goal_conversions, goal_revenue,
        followup_days, max_attempts, id, $3 FROM campaigns WHERE id=$1 RETURNING id`, [id, name || `${c.name.replace(/^\[DEMO\]\s*/, '')} (cópia)`, req.user.id])).rows[0];
    await cl.query(`INSERT INTO campaign_sellers SELECT $2, user_id FROM campaign_sellers WHERE campaign_id=$1`, [id, row.id]);
    const tpls = (await cl.query(`SELECT * FROM message_templates WHERE campaign_id=$1 AND active ORDER BY id`, [id])).rows;
    for (const t of tpls) {
      const nt = (await cl.query(`INSERT INTO message_templates(campaign_id, name, kind, step, product_id, ref_year, historical_status, body, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [row.id, t.name, t.kind, t.step, t.product_id, t.ref_year, t.historical_status, t.body, req.user.id])).rows[0];
      await cl.query('INSERT INTO message_template_versions(template_id, version, body, created_by) VALUES ($1,1,$2,$3)', [nt.id, t.body, req.user.id]);
    }
    return row.id;
  });
  await audit(req, 'campanha_duplicada', 'campaign', newId, { from: id });
  res.json({ id: newId });
}));

r.delete('/:id', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const c = await loadCampaign(id, req);
  if (c.status !== 'rascunho') throw bad('Somente rascunhos podem ser excluídos. Campanhas ativas devem ser encerradas.');
  const sent = await one('SELECT count(*)::int AS n FROM campaign_contacts WHERE campaign_id=$1 AND attempts>0', [id]);
  if (sent.n) throw bad('A campanha já possui envios registrados e não pode ser excluída.');
  await query('DELETE FROM campaigns WHERE id=$1', [id]);
  await audit(req, 'campanha_excluida', 'campaign', id, { name: c.name });
  res.json({ ok: true });
}));

// ---------------- Elegibilidade e participantes ----------------
r.get('/:id/eligibility', requireAdmin, ah(async (req, res) => {
  const c = await loadCampaign(intParam(req.params.id), req);
  res.json(await eligibilityPreview(c));
}));

// prévia sem salvar (usada no formulário de criação)
r.post('/eligibility-preview', requireAdmin, ah(async (req, res) => {
  const d = parse(campaignSchema.partial({ name: true }).extend({ campaign_id: z.number().int().optional() }), req.body);
  res.json(await eligibilityPreview({ ...d, id: d.campaign_id || 0 }));
}));

r.post('/:id/participants', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const c = await loadCampaign(id, req);
  if (c.status === 'encerrada') throw bad('Campanha encerrada.');
  const d = parse(z.object({
    segments: z.array(z.object({ product_id: z.number().int().nullable(), ref_year: z.number().int().nullable(), historical_status: z.string() })).optional(),
    include_recent: z.boolean().default(false),
    include_active: z.boolean().default(false),
    limit: z.number().int().min(1).optional(),
  }), req.body);
  const { sql, params, excludeActive } = await eligibilitySql(c);
  const conds = ['NOT e.dnc', 'NOT e.already'];
  if (!d.include_recent) conds.push('NOT e.recent');
  if (excludeActive && !d.include_active) conds.push('NOT e.in_active');
  let segWhere = '';
  if (d.segments?.length) {
    params.push(JSON.stringify(d.segments));
    segWhere = `AND EXISTS (SELECT 1 FROM jsonb_to_recordset($${params.length}::jsonb) s(product_id int, ref_year int, historical_status text)
      WHERE s.product_id IS NOT DISTINCT FROM e.product_id AND s.ref_year IS NOT DISTINCT FROM e.ref_year AND s.historical_status = e.historical_status)`;
  }
  const ins = await query(`INSERT INTO campaign_contacts(campaign_id, contact_id, opportunity_id, added_by, is_demo)
    SELECT $${params.length + 1}, e.contact_id, e.opportunity_id, $${params.length + 2}, $${params.length + 3}
      FROM (${sql}) e WHERE ${conds.join(' AND ')} ${segWhere}
      ORDER BY e.product_id, e.ref_year DESC, e.contact_id ${d.limit ? `LIMIT ${d.limit}` : ''}
    ON CONFLICT (campaign_id, contact_id) DO NOTHING RETURNING id, contact_id`, [...params, id, req.user.id, c.is_demo]);
  if (ins.rowCount) {
    await query(`INSERT INTO interactions(campaign_contact_id, campaign_id, contact_id, user_id, type, note, is_demo)
      SELECT x.id, $2, x.contact_id, $3, 'participacao', 'Incluído na campanha', $4 FROM unnest($1::int[], $5::int[]) AS x(id, contact_id)`,
      [ins.rows.map((x) => x.id), id, req.user.id, c.is_demo, ins.rows.map((x) => x.contact_id)]);
  }
  await audit(req, 'participantes_adicionados', 'campaign', id, { added: ins.rowCount });
  res.json({ added: ins.rowCount });
}));

r.post('/:id/participants/add-contact', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const c = await loadCampaign(id, req);
  if (c.status === 'encerrada') throw bad('Campanha encerrada.');
  const d = parse(z.object({ contact_id: z.number().int(), opportunity_id: z.number().int().nullable().optional(), assigned_to: z.number().int().nullable().optional() }), req.body);
  const ct = await one('SELECT * FROM contacts WHERE id=$1', [d.contact_id]);
  if (!ct) throw notFound('Contato não encontrado.');
  if (ct.do_not_contact) throw bad('Este contato pediu para não ser contatado (opt-out).');
  const oppId = d.opportunity_id ?? (await one(`SELECT id FROM opportunities WHERE contact_id=$1
     ORDER BY (product_id = ANY($2::int[])) DESC, ref_year DESC NULLS LAST, id DESC LIMIT 1`, [d.contact_id, c.product_ids]))?.id ?? null;
  const row = await one(`INSERT INTO campaign_contacts(campaign_id, contact_id, opportunity_id, assigned_to, assigned_at, added_by, is_demo)
    VALUES ($1,$2,$3,$4, CASE WHEN $4::int IS NULL THEN NULL ELSE now() END, $5, $6) ON CONFLICT DO NOTHING RETURNING id`,
    [id, d.contact_id, oppId, d.assigned_to ?? null, req.user.id, c.is_demo]);
  if (!row) throw bad('Este contato já participa da campanha.');
  await query(`INSERT INTO interactions(campaign_contact_id, campaign_id, contact_id, user_id, type, note) VALUES ($1,$2,$3,$4,'participacao','Incluído manualmente na campanha')`,
    [row.id, id, d.contact_id, req.user.id]);
  res.json({ id: row.id });
}));

r.post('/:id/participants/remove', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const { ids } = parse(z.object({ ids: z.array(z.number().int()).min(1) }), req.body);
  const del = await query(`DELETE FROM campaign_contacts WHERE campaign_id=$1 AND id = ANY($2) AND attempts=0 AND status='pendente' RETURNING id`, [id, ids]);
  await audit(req, 'participantes_removidos', 'campaign', id, { removed: del.rowCount });
  res.json({ removed: del.rowCount, kept: ids.length - del.rowCount });
}));

// ---------------- Distribuição ----------------
r.post('/:id/distribute', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const c = await loadCampaign(id, req);
  if (c.status === 'encerrada') throw bad('Campanha encerrada.');
  const d = parse(z.object({
    method: z.enum(['igual', 'proporcional', 'segmento', 'manual']),
    scope: z.enum(['nao_atribuidos', 'pendentes']).default('nao_atribuidos'),
    weights: z.record(z.string(), z.number().min(0)).optional(),
    segments: z.array(z.object({ product_id: z.number().int().nullable(), ref_year: z.number().int().nullable(), historical_status: z.string().nullable(), user_id: z.number().int().nullable() })).optional(),
    participant_ids: z.array(z.number().int()).optional(),
    user_id: z.number().int().nullable().optional(),
  }), req.body);
  const sellers = (await many(`SELECT id FROM users WHERE role='vendedora' AND active`)).map((u) => u.id);
  const validUser = (u) => u === null || sellers.includes(u);
  // nunca redistribui automaticamente quem já recebeu mensagem
  const scopeSql = d.scope === 'pendentes' ? `cc.attempts=0 AND cc.status='pendente'` : `cc.assigned_to IS NULL AND cc.attempts=0`;
  let updates = [];
  if (d.method === 'igual' || d.method === 'proporcional') {
    const campaignSellers = c.sellers.map((s) => s.id).filter((u) => sellers.includes(u));
    const weights = d.method === 'igual'
      ? Object.fromEntries((campaignSellers.length ? campaignSellers : sellers).map((u) => [u, 1]))
      : Object.fromEntries(Object.entries(d.weights || {}).map(([k, v]) => [Number(k), v]).filter(([k]) => sellers.includes(k)));
    if (!Object.values(weights).some((w) => w > 0)) throw bad('Informe ao menos uma vendedora com percentual maior que zero.');
    const parts = await many(`SELECT cc.id, concat_ws('|', o.product_id, o.ref_year, o.historical_status) AS segment
      FROM campaign_contacts cc LEFT JOIN opportunities o ON o.id=cc.opportunity_id WHERE cc.campaign_id=$1 AND ${scopeSql}`, [id]);
    updates = distribute(parts, weights);
  } else if (d.method === 'segmento') {
    for (const s of d.segments || []) {
      if (!validUser(s.user_id)) throw bad('Vendedora inválida.');
      const parts = await many(`SELECT cc.id FROM campaign_contacts cc LEFT JOIN opportunities o ON o.id=cc.opportunity_id
        WHERE cc.campaign_id=$1 AND cc.attempts=0 AND o.product_id IS NOT DISTINCT FROM $2 AND o.ref_year IS NOT DISTINCT FROM $3
          AND ($4::text IS NULL OR o.historical_status=$4)`, [id, s.product_id, s.ref_year, s.historical_status]);
      updates.push(...parts.map((p) => ({ id: p.id, user_id: s.user_id })));
    }
  } else {
    if (!d.participant_ids?.length) throw bad('Selecione os contatos.');
    if (!validUser(d.user_id ?? null)) throw bad('Vendedora inválida.');
    updates = d.participant_ids.map((pid) => ({ id: pid, user_id: d.user_id ?? null }));
  }
  let changed = 0;
  await tx(async (cl) => {
    for (const u of updates) {
      const r1 = await cl.query(`UPDATE campaign_contacts SET assigned_to=$3, assigned_at=CASE WHEN $3::int IS NULL THEN NULL ELSE now() END, updated_at=now()
        WHERE id=$1 AND campaign_id=$2 AND assigned_to IS DISTINCT FROM $3 RETURNING contact_id`, [u.id, id, u.user_id]);
      if (r1.rowCount) {
        changed++;
        await cl.query(`INSERT INTO interactions(campaign_contact_id, campaign_id, contact_id, user_id, type, note, is_demo)
          VALUES ($1,$2,$3,$4,'atribuicao',$5,$6)`, [u.id, id, r1.rows[0].contact_id, req.user.id,
          u.user_id ? `Atribuído a ${(await cl.query('SELECT name FROM users WHERE id=$1', [u.user_id])).rows[0].name}` : 'Atribuição removida', c.is_demo]);
        // follow-ups pendentes acompanham a nova responsável (nada a fazer: ficam ligados ao participante)
      }
    }
  });
  await audit(req, 'distribuicao', 'campaign', id, { method: d.method, changed });
  res.json({ changed });
}));

r.get('/:id/participants', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const params = [id];
  const where = ['cc.campaign_id=$1'];
  if (req.query.assigned === 'none') where.push('cc.assigned_to IS NULL');
  else if (req.query.assigned) { params.push(Number(req.query.assigned)); where.push(`cc.assigned_to=$${params.length}`); }
  if (req.query.search) { params.push(`%${req.query.search}%`); where.push(`(ct.full_name ILIKE $${params.length} OR ct.phone ILIKE $${params.length} OR ct.company ILIKE $${params.length})`); }
  const rows = await many(`SELECT cc.id, cc.status, cc.attempts, cc.assigned_to, u.name AS assigned_name, ct.id AS contact_id, ct.full_name, ct.company, ct.phone,
      o.ref_year, o.historical_status, p.name AS product_name
    FROM campaign_contacts cc JOIN contacts ct ON ct.id=cc.contact_id LEFT JOIN opportunities o ON o.id=cc.opportunity_id
    LEFT JOIN products p ON p.id=o.product_id LEFT JOIN users u ON u.id=cc.assigned_to
    WHERE ${where.join(' AND ')} ORDER BY ct.full_name LIMIT 100 OFFSET ${(page - 1) * 100}`, params);
  const { n } = await one(`SELECT count(*)::int AS n FROM campaign_contacts cc JOIN contacts ct ON ct.id=cc.contact_id WHERE ${where.join(' AND ')}`, params);
  res.json({ rows, total: n, page, pageSize: 100 });
}));

export default r;
