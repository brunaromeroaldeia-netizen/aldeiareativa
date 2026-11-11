import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { ah, bad, parse, intParam, notFound, forbidden, conflict, intList, strList } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { normalizePhone, normalizeEmail, formatPhone, titleCaseName, firstNameOf } from '../lib/normalize.js';
import { requireAdmin } from '../auth.js';

const r = Router();

function contactWhere(req) {
  const q = req.query;
  const params = [];
  const where = ['ct.anonymized_at IS NULL'];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('$?', `$${params.length}`)); };
  if (req.user.role !== 'admin') add('EXISTS (SELECT 1 FROM campaign_contacts x WHERE x.contact_id=ct.id AND x.assigned_to=$?)', req.user.id);
  const oppConds = [];
  const addOpp = (sql, v) => { params.push(v); oppConds.push(sql.replaceAll('$?', `$${params.length}`)); };
  if (intList(q.product_id).length) addOpp('o.product_id = ANY($?::int[])', intList(q.product_id));
  if (intList(q.year).length) addOpp('o.ref_year = ANY($?::int[])', intList(q.year));
  if (strList(q.hist).length) addOpp('o.historical_status = ANY($?::text[])', strList(q.hist));
  if (q.no_year === '1') oppConds.push('o.ref_year IS NULL');
  if (q.no_product === '1') oppConds.push('o.product_id IS NULL');
  if (q.import_id) addOpp('o.import_id = $?', Number(q.import_id));
  if (oppConds.length) where.push(`EXISTS (SELECT 1 FROM opportunities o WHERE o.contact_id=ct.id AND ${oppConds.join(' AND ')})`);
  if (q.dnc === '1') where.push('ct.do_not_contact');
  if (q.dnc === '0') where.push('NOT ct.do_not_contact');
  if (q.no_phone === '1') where.push('ct.phone_norm IS NULL');
  if (q.demo === '1') where.push('ct.is_demo');
  if (q.approached === '0') where.push('NOT EXISTS (SELECT 1 FROM campaign_contacts x WHERE x.contact_id=ct.id)');
  if (q.approached === '1') where.push('EXISTS (SELECT 1 FROM campaign_contacts x WHERE x.contact_id=ct.id AND x.attempts>0)');
  if (q.converted === '1') where.push('EXISTS (SELECT 1 FROM campaign_contacts x WHERE x.contact_id=ct.id AND x.converted_at IS NOT NULL)');
  if (q.search) {
    params.push(`%${String(q.search).trim()}%`);
    const i = params.length;
    const digits = String(q.search).replace(/\D/g, '');
    let extra = '';
    if (digits.length >= 4) { params.push(`%${digits}%`); extra = ` OR ct.phone_norm LIKE $${params.length}`; }
    where.push(`(ct.full_name ILIKE $${i} OR ct.company ILIKE $${i} OR ct.email ILIKE $${i}${extra})`);
  }
  return { where: where.join(' AND '), params };
}

r.get('/', ah(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = 50;
  const { where, params } = contactWhere(req);
  const rows = await many(`SELECT ct.id, ct.full_name, ct.company, ct.phone, ct.email, ct.do_not_contact, ct.is_demo, ct.created_at,
      (SELECT count(*)::int FROM opportunities o WHERE o.contact_id=ct.id) AS opportunities,
      (SELECT json_agg(json_build_object('product', p.name, 'year', o.ref_year, 'status', o.historical_status) ORDER BY o.ref_year DESC NULLS LAST)
         FROM opportunities o LEFT JOIN products p ON p.id=o.product_id WHERE o.contact_id=ct.id) AS opps,
      (SELECT json_build_object('campaign', c.name, 'status', cc.status, 'at', cc.updated_at) FROM campaign_contacts cc JOIN campaigns c ON c.id=cc.campaign_id
         WHERE cc.contact_id=ct.id ORDER BY cc.added_at DESC LIMIT 1) AS last_campaign,
      (SELECT count(*)::int FROM campaign_contacts cc WHERE cc.contact_id=ct.id) AS campaigns
    FROM contacts ct WHERE ${where} ORDER BY ct.full_name LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
  const { n } = await one(`SELECT count(*)::int AS n FROM contacts ct WHERE ${where}`, params);
  res.json({ rows, total: n, page, pageSize: size });
}));

r.get('/lost-reasons', ah(async (req, res) => {
  const products = intList(req.query.product_id);
  res.json(await many(`SELECT COALESCE(lost_reason,'(sem motivo)') AS reason, count(*)::int AS n FROM opportunities
    WHERE historical_status='perdido' AND (cardinality($1::int[])=0 OR product_id = ANY($1::int[])) GROUP BY 1 ORDER BY 2 DESC LIMIT 60`, [products]));
}));

r.get('/years', ah(async (_req, res) => {
  res.json((await many(`SELECT DISTINCT ref_year FROM opportunities WHERE ref_year IS NOT NULL ORDER BY 1 DESC`)).map((x) => x.ref_year));
}));

/** Busca rápida (duplicidade em cadastro manual, vínculo de importação, inclusão em campanha). */
r.get('/lookup', requireAdmin, ah(async (req, res) => {
  const phone = normalizePhone(req.query.phone);
  const email = normalizeEmail(req.query.email);
  const qtext = String(req.query.q || '').trim();
  const params = [phone, email, qtext ? `%${qtext}%` : null];
  res.json(await many(`SELECT id, full_name, company, phone, email, do_not_contact FROM contacts
    WHERE anonymized_at IS NULL AND (($1::text IS NOT NULL AND phone_norm=$1) OR ($2::text IS NOT NULL AND email_norm=$2) OR ($3::text IS NOT NULL AND full_name ILIKE $3))
    ORDER BY full_name LIMIT 15`, params));
}));

r.get('/:id', ah(async (req, res) => {
  const id = intParam(req.params.id);
  if (req.user.role !== 'admin') {
    const ok = await one('SELECT 1 FROM campaign_contacts WHERE contact_id=$1 AND assigned_to=$2', [id, req.user.id]);
    if (!ok) throw notFound();
  }
  const contact = await one(`SELECT ct.*, u.name AS dnc_by_name, cu.name AS client_status_by_name FROM contacts ct
    LEFT JOIN users u ON u.id=ct.dnc_by LEFT JOIN users cu ON cu.id=ct.client_status_by WHERE ct.id=$1`, [id]);
  if (!contact) throw notFound();
  const opportunities = await many(`SELECT o.*, p.name AS product_name, i.filename AS import_filename FROM opportunities o
    LEFT JOIN products p ON p.id=o.product_id LEFT JOIN imports i ON i.id=o.import_id
    WHERE o.contact_id=$1 ORDER BY o.ref_year DESC NULLS LAST, o.id DESC`, [id]);
  const history = opportunities.length ? await many(`SELECT h.opportunity_id, h.changes, h.created_at, i.filename, u.name AS user_name
    FROM opportunity_history h LEFT JOIN imports i ON i.id=h.import_id LEFT JOIN users u ON u.id=h.user_id
    WHERE h.opportunity_id = ANY($1) ORDER BY h.created_at DESC`, [opportunities.map((o) => o.id)]) : [];
  for (const o of opportunities) o.history = history.filter((h) => h.opportunity_id === o.id);
  const participations = await many(`SELECT cc.*, c.name AS campaign_name, c.status AS campaign_status, c.start_date, c.end_date, u.name AS assigned_name,
      (SELECT json_agg(json_build_object('id', i.id, 'type', i.type, 'at', i.created_at, 'text', i.message_text, 'note', i.note, 'from', i.from_status,
          'to', i.to_status, 'user', uu.name, 'attempt', i.attempt, 'value', i.value) ORDER BY i.created_at DESC, i.id DESC)
         FROM interactions i LEFT JOIN users uu ON uu.id=i.user_id WHERE i.campaign_contact_id=cc.id AND i.type <> 'copia') AS events
    FROM campaign_contacts cc JOIN campaigns c ON c.id=cc.campaign_id LEFT JOIN users u ON u.id=cc.assigned_to
    WHERE cc.contact_id=$1 ORDER BY cc.added_at DESC`, [id]);
  if (req.user.role === 'admin') await audit(req, 'contato_visualizado', 'contact', id);
  res.json({ contact, opportunities, participations });
}));

const oppSchema = z.object({
  product_id: z.number().int().nullable().optional(),
  ref_year: z.number().int().min(1990).max(2100).nullable().optional(),
  created_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  won_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lost_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lost_reason: z.string().trim().max(300).nullable().optional(),
  value: z.number().min(0).nullable().optional(),
  original_owner: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

function classify(o) {
  if (o.won_date && o.lost_date) return { status: 'revisao', reasons: ['Data do ganho e data da perda preenchidas'] };
  if (o.won_date) return { status: 'ganho', reasons: [] };
  if (o.lost_date) return { status: 'perdido', reasons: [] };
  return { status: 'aberto', reasons: [] };
}

function yearFor(o) {
  if (o.ref_year) return { year: o.ref_year, source: o.created_date && Number(o.created_date.slice(0, 4)) === o.ref_year ? 'criacao' : 'manual' };
  if (o.created_date) return { year: Number(o.created_date.slice(0, 4)), source: 'criacao' };
  if (o.won_date) return { year: Number(o.won_date.slice(0, 4)), source: 'ganho' };
  if (o.lost_date) return { year: Number(o.lost_date.slice(0, 4)), source: 'perda' };
  return { year: null, source: null };
}

async function insertOpportunity(c, contactId, o, userId) {
  const cl = classify(o);
  const y = yearFor(o);
  return (await c.query(`INSERT INTO opportunities(contact_id, product_id, created_date, won_date, lost_date, lost_reason, value, original_owner, notes,
      historical_status, review_reasons, ref_year, year_source, year_inferred, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
  [contactId, o.product_id ?? null, o.created_date ?? null, o.won_date ?? null, o.lost_date ?? null, o.lost_reason ?? null, o.value ?? null, o.original_owner ?? null,
    o.notes ?? null, cl.status, JSON.stringify(cl.reasons), y.year, y.source, !!y.source && !['criacao', 'manual'].includes(y.source), userId])).rows[0];
}

const contactSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  company: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

r.post('/', requireAdmin, ah(async (req, res) => {
  const d = parse(contactSchema.extend({ opportunity: oppSchema.optional(), force: z.boolean().optional() }), req.body);
  const phoneNorm = normalizePhone(d.phone);
  const emailNorm = normalizeEmail(d.email);
  if (d.phone && !phoneNorm) throw bad('Telefone inválido.');
  if (d.email && !emailNorm) throw bad('E-mail inválido.');
  if (!d.force) {
    const dups = await many(`SELECT id, full_name, phone, email FROM contacts WHERE anonymized_at IS NULL AND ((phone_norm=$1 AND $1 IS NOT NULL) OR (email_norm=$2 AND $2 IS NOT NULL))`, [phoneNorm, emailNorm]);
    if (dups.length) throw conflict('Já existe contato com este telefone ou e-mail.', { duplicates: dups });
  }
  const name = titleCaseName(d.full_name);
  const id = await tx(async (c) => {
    const row = (await c.query(`INSERT INTO contacts(full_name, first_name, company, phone, phone_norm, email, email_norm, notes, source, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9) RETURNING id`,
    [name, firstNameOf(name), d.company || null, phoneNorm ? formatPhone(phoneNorm) : null, phoneNorm, emailNorm, emailNorm, d.notes || null, req.user.id])).rows[0];
    if (d.opportunity) await insertOpportunity(c, row.id, d.opportunity, req.user.id);
    return row.id;
  });
  await audit(req, 'contato_criado_manual', 'contact', id);
  res.json({ id });
}));

r.patch('/:id', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const d = parse(contactSchema, req.body);
  const cur = await one('SELECT * FROM contacts WHERE id=$1', [id]);
  if (!cur) throw notFound();
  const phoneNorm = normalizePhone(d.phone);
  const emailNorm = normalizeEmail(d.email);
  if (d.phone && !phoneNorm) throw bad('Telefone inválido.');
  if (d.email && !emailNorm) throw bad('E-mail inválido.');
  await query(`UPDATE contacts SET full_name=$2, first_name=$3, company=$4, phone=$5, phone_norm=$6, email=$7, email_norm=$8, notes=$9, updated_at=now() WHERE id=$1`,
    [id, d.full_name, firstNameOf(d.full_name), d.company || null, phoneNorm ? formatPhone(phoneNorm) : null, phoneNorm, emailNorm, emailNorm, d.notes || null]);
  await audit(req, 'contato_editado', 'contact', id, { before: { full_name: cur.full_name, company: cur.company, phone: cur.phone, email: cur.email } });
  res.json({ ok: true });
}));

r.post('/:id/opportunities', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const d = parse(oppSchema, req.body);
  const row = await tx((c) => insertOpportunity(c, id, d, req.user.id));
  await audit(req, 'oportunidade_criada_manual', 'opportunity', row.id, { contact_id: id });
  res.json(row);
}));

/** Ajuste manual de oportunidade (ano, produto, classificação de registros em revisão). Nunca automático. */
r.patch('/opportunities/:oppId', requireAdmin, ah(async (req, res) => {
  const oppId = intParam(req.params.oppId);
  const d = parse(z.object({
    product_id: z.number().int().nullable().optional(),
    ref_year: z.number().int().min(1990).max(2100).nullable().optional(),
    historical_status: z.enum(['ganho', 'perdido', 'aberto', 'revisao']).optional(),
    note: z.string().trim().max(500).optional(),
  }), req.body);
  const cur = await one('SELECT * FROM opportunities WHERE id=$1', [oppId]);
  if (!cur) throw notFound();
  await query(`UPDATE opportunities SET
      product_id = CASE WHEN $2 THEN $3 ELSE product_id END,
      ref_year = CASE WHEN $4 THEN $5 ELSE ref_year END,
      year_source = CASE WHEN $4 THEN 'manual' ELSE year_source END,
      year_inferred = CASE WHEN $4 THEN FALSE ELSE year_inferred END,
      historical_status = COALESCE($6, historical_status),
      status_manual = status_manual OR $6 IS NOT NULL,
      review_reasons = CASE WHEN $6 IS NOT NULL THEN review_reasons || jsonb_build_array('Classificado manualmente: ' || $6 || COALESCE(' — ' || $7, '')) ELSE review_reasons END,
      updated_at=now() WHERE id=$1`,
  [oppId, 'product_id' in d, d.product_id ?? null, 'ref_year' in d, d.ref_year ?? null, d.historical_status ?? null, d.note ?? null]);
  await audit(req, 'oportunidade_ajustada', 'opportunity', oppId, { before: { product_id: cur.product_id, ref_year: cur.ref_year, historical_status: cur.historical_status }, after: d });
  res.json({ ok: true });
}));

/** Situação atual como cliente: 'ativo', 'inativo' (ex-cliente confirmado) ou null (não confirmada). */
r.post('/:id/client-status', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const { status } = parse(z.object({ status: z.enum(['ativo', 'inativo']).nullable() }), req.body);
  if (req.user.role !== 'admin') {
    const ok = await one('SELECT 1 FROM campaign_contacts WHERE contact_id=$1 AND assigned_to=$2', [id, req.user.id]);
    if (!ok) throw forbidden();
  }
  const cur = await one('SELECT client_status FROM contacts WHERE id=$1', [id]);
  if (!cur) throw notFound();
  await query(`UPDATE contacts SET client_status=$2, client_status_at=now(), client_status_by=$3, updated_at=now() WHERE id=$1`, [id, status, req.user.id]);
  await audit(req, 'situacao_cliente_alterada', 'contact', id, { from: cur.client_status, to: status });
  res.json({ ok: true });
}));

r.post('/:id/opt-out', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const { reason } = parse(z.object({ reason: z.string().trim().max(500).optional() }), req.body);
  if (req.user.role !== 'admin') {
    const ok = await one('SELECT 1 FROM campaign_contacts WHERE contact_id=$1 AND assigned_to=$2', [id, req.user.id]);
    if (!ok) throw forbidden();
  }
  await tx(async (c) => {
    await c.query(`UPDATE contacts SET do_not_contact=TRUE, dnc_at=now(), dnc_by=$2, dnc_reason=$3, updated_at=now() WHERE id=$1`, [id, req.user.id, reason || 'Pedido de não contato']);
    const open = (await c.query(`SELECT * FROM campaign_contacts WHERE contact_id=$1 AND status NOT IN ('convertido','sem_interesse','sem_resposta','opt_out')`, [id])).rows;
    for (const p of open) {
      await c.query(`UPDATE campaign_contacts SET status='opt_out', closed_at=now(), updated_at=now() WHERE id=$1`, [p.id]);
      await c.query(`UPDATE followups SET status='cancelado', status_reason='opt-out', completed_at=now(), completed_by=$2 WHERE campaign_contact_id=$1 AND status='pendente'`, [p.id, req.user.id]);
      await c.query(`INSERT INTO interactions(campaign_contact_id, campaign_id, contact_id, user_id, type, from_status, to_status, note, is_demo)
        VALUES ($1,$2,$3,$4,'opt_out',$5,'opt_out',$6,$7)`, [p.id, p.campaign_id, id, req.user.id, p.status, reason || 'Pedido de não contato', p.is_demo]);
    }
  });
  await audit(req, 'opt_out', 'contact', id, { reason });
  res.json({ ok: true });
}));

r.delete('/:id/opt-out', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
  await query(`UPDATE contacts SET do_not_contact=FALSE, dnc_reason=NULL, updated_at=now() WHERE id=$1`, [id]);
  await audit(req, 'opt_out_revogado', 'contact', id, { reason });
  res.json({ ok: true });
}));

/** LGPD: exportação dos dados de um titular. */
r.get('/:id/export', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const contact = await one('SELECT * FROM contacts WHERE id=$1', [id]);
  if (!contact) throw notFound();
  const opportunities = await many('SELECT * FROM opportunities WHERE contact_id=$1', [id]);
  const participations = await many(`SELECT cc.*, c.name AS campaign_name FROM campaign_contacts cc JOIN campaigns c ON c.id=cc.campaign_id WHERE cc.contact_id=$1`, [id]);
  const interactions = await many(`SELECT type, created_at, message_text, note, from_status, to_status FROM interactions WHERE contact_id=$1 AND type <> 'copia' ORDER BY created_at`, [id]);
  await audit(req, 'dados_titular_exportados', 'contact', id);
  res.setHeader('Content-Disposition', `attachment; filename="contato-${id}.json"`);
  res.json({ exported_at: new Date().toISOString(), contact, opportunities, participations, interactions });
}));

/** LGPD: anonimização (mantém números agregados, remove dados pessoais). */
r.post('/:id/anonymize', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const { confirm } = parse(z.object({ confirm: z.literal('ANONIMIZAR') }), req.body);
  if (!confirm) throw bad('Confirmação obrigatória.');
  await tx(async (c) => {
    await c.query(`UPDATE contacts SET full_name='Contato anonimizado', first_name=NULL, company=NULL, phone=NULL, phone_norm=NULL, email=NULL, email_norm=NULL,
      notes=NULL, extra='{}', do_not_contact=TRUE, dnc_at=COALESCE(dnc_at, now()), dnc_reason='Dados anonimizados (LGPD)', anonymized_at=now(), updated_at=now() WHERE id=$1`, [id]);
    await c.query(`UPDATE opportunities SET raw='{}', notes=NULL WHERE contact_id=$1`, [id]);
    await c.query(`UPDATE interactions SET message_text=NULL, note=NULL WHERE contact_id=$1`, [id]);
    await c.query(`UPDATE campaign_contacts SET notes=NULL WHERE contact_id=$1`, [id]);
    await c.query(`UPDATE import_rows SET raw='{}', mapped='{}' WHERE result_contact_id=$1 OR match_contact_id=$1`, [id]);
  });
  await audit(req, 'contato_anonimizado', 'contact', id);
  res.json({ ok: true });
}));

export default r;
