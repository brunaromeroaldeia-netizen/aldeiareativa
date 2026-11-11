import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { ah, bad, parse, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAdmin } from '../auth.js';
import { renderTemplate, templateData, VARIABLES } from '../lib/template.js';
import { getSettings } from './settings.js';

const r = Router();

r.get('/variables', (_req, res) => res.json(VARIABLES));

r.get('/', ah(async (req, res) => {
  const params = [];
  let where = 'TRUE';
  if (req.query.library === '1') where = 't.campaign_id IS NULL';
  else if (req.query.campaign_id) { params.push(Number(req.query.campaign_id)); where = `t.campaign_id=$1`; }
  if (req.query.include_inactive !== '1') where += ' AND t.active';
  res.json(await many(`SELECT t.*, p.name AS product_name, c.name AS campaign_name, u.name AS created_by_name
    FROM message_templates t LEFT JOIN products p ON p.id=t.product_id LEFT JOIN campaigns c ON c.id=t.campaign_id LEFT JOIN users u ON u.id=t.created_by
    WHERE ${where} ORDER BY t.campaign_id NULLS FIRST, t.step, t.product_id NULLS FIRST, t.ref_year NULLS FIRST, t.historical_status NULLS FIRST, t.id`, params));
}));

const schema = z.object({
  campaign_id: z.number().int().nullable(),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['inicial', 'followup']),
  step: z.number().int().min(1).max(10),
  product_id: z.number().int().nullable(),
  ref_year: z.number().int().nullable(),
  historical_status: z.enum(['ganho', 'perdido', 'aberto', 'revisao']).nullable(),
  body: z.string().min(2).max(4000),
});

function normalizeStep(d) {
  if (d.kind === 'inicial') d.step = 1;
  else if (d.step < 2) d.step = 2;
  return d;
}

async function checkCampaignEditable(campaignId) {
  if (!campaignId) return;
  const c = await one('SELECT status FROM campaigns WHERE id=$1', [campaignId]);
  if (!c) throw notFound('Campanha não encontrada.');
  if (c.status === 'encerrada') throw bad('Campanha encerrada: as mensagens ficam preservadas para consulta.');
}

r.post('/', requireAdmin, ah(async (req, res) => {
  const d = normalizeStep(parse(schema, req.body));
  await checkCampaignEditable(d.campaign_id);
  const t = await tx(async (c) => {
    const row = (await c.query(`INSERT INTO message_templates(campaign_id, name, kind, step, product_id, ref_year, historical_status, body, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [d.campaign_id, d.name, d.kind, d.step, d.product_id, d.ref_year, d.historical_status, d.body, req.user.id])).rows[0];
    await c.query('INSERT INTO message_template_versions(template_id, version, body, created_by) VALUES ($1,1,$2,$3)', [row.id, d.body, req.user.id]);
    return row;
  });
  await audit(req, 'mensagem_criada', 'template', t.id, { name: d.name });
  res.json(t);
}));

r.patch('/:id', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const cur = await one('SELECT * FROM message_templates WHERE id=$1', [id]);
  if (!cur) throw notFound();
  await checkCampaignEditable(cur.campaign_id);
  const d = normalizeStep(parse(schema.omit({ campaign_id: true }), req.body));
  const t = await tx(async (c) => {
    const bodyChanged = d.body !== cur.body;
    const row = (await c.query(`UPDATE message_templates SET name=$2, kind=$3, step=$4, product_id=$5, ref_year=$6, historical_status=$7, body=$8,
        version = version + $9, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, d.name, d.kind, d.step, d.product_id, d.ref_year, d.historical_status, d.body, bodyChanged ? 1 : 0])).rows[0];
    if (bodyChanged) await c.query('INSERT INTO message_template_versions(template_id, version, body, created_by) VALUES ($1,$2,$3,$4)', [id, row.version, d.body, req.user.id]);
    return row;
  });
  await audit(req, 'mensagem_editada', 'template', id, { version: t.version });
  res.json(t);
}));

r.delete('/:id', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const cur = await one('SELECT * FROM message_templates WHERE id=$1', [id]);
  if (!cur) throw notFound();
  await checkCampaignEditable(cur.campaign_id);
  // desativa (preserva o histórico de mensagens enviadas)
  await query('UPDATE message_templates SET active=FALSE, updated_at=now() WHERE id=$1', [id]);
  await audit(req, 'mensagem_desativada', 'template', id);
  res.json({ ok: true });
}));

r.get('/:id/versions', ah(async (req, res) => {
  res.json(await many(`SELECT v.*, u.name AS created_by_name FROM message_template_versions v LEFT JOIN users u ON u.id=v.created_by
    WHERE v.template_id=$1 ORDER BY v.version DESC`, [intParam(req.params.id)]));
}));

/** Copia um modelo (da biblioteca ou de outra campanha) para uma campanha ou para a biblioteca. */
r.post('/:id/copy', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const { campaign_id } = parse(z.object({ campaign_id: z.number().int().nullable() }), req.body);
  await checkCampaignEditable(campaign_id);
  const t = await one('SELECT * FROM message_templates WHERE id=$1', [id]);
  if (!t) throw notFound();
  const row = await one(`INSERT INTO message_templates(campaign_id, name, kind, step, product_id, ref_year, historical_status, body, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [campaign_id, t.name, t.kind, t.step, t.product_id, t.ref_year, t.historical_status, t.body, req.user.id]);
  await query('INSERT INTO message_template_versions(template_id, version, body, created_by) VALUES ($1,1,$2,$3)', [row.id, t.body, req.user.id]);
  res.json(row);
}));

/** Pré-visualização com dados reais de um contato (ou de um exemplo). */
r.post('/preview', ah(async (req, res) => {
  const d = parse(z.object({ body: z.string().max(4000), contact_id: z.number().int().nullable().optional(), campaign_id: z.number().int().nullable().optional() }), req.body);
  const settings = await getSettings();
  let data;
  if (d.contact_id) {
    if (req.user.role !== 'admin') {
      const ok = await one('SELECT 1 FROM campaign_contacts WHERE contact_id=$1 AND assigned_to=$2', [d.contact_id, req.user.id]);
      if (!ok) throw notFound();
    }
    const contact = await one('SELECT * FROM contacts WHERE id=$1', [d.contact_id]);
    const opportunity = await one('SELECT * FROM opportunities WHERE contact_id=$1 ORDER BY ref_year DESC NULLS LAST, id DESC LIMIT 1', [d.contact_id]);
    const product = opportunity?.product_id ? await one('SELECT name FROM products WHERE id=$1', [opportunity.product_id]) : null;
    const campaign = d.campaign_id ? await one('SELECT name FROM campaigns WHERE id=$1', [d.campaign_id]) : null;
    data = templateData({ contact, opportunity, product, campaign, seller: req.user, unit: settings.unidade_padrao });
  } else {
    data = { primeiro_nome: 'Mariana', nome_completo: 'Mariana Ferreira', empresa: 'Ferreira Design', produto: 'Mesa / Plano Full',
      unidade: settings.unidade_padrao, vendedora: req.user.name.split(' ')[0], campanha: 'Campanha', ano: 2024 };
  }
  res.json(renderTemplate(d.body, data));
}));

/** Contatos para escolher na pré-visualização. */
r.get('/sample-contacts', requireAdmin, ah(async (req, res) => {
  const params = [];
  let where = 'ct.anonymized_at IS NULL';
  if (req.query.campaign_id) { params.push(Number(req.query.campaign_id)); where += ` AND EXISTS (SELECT 1 FROM campaign_contacts x WHERE x.contact_id=ct.id AND x.campaign_id=$${params.length})`; }
  if (req.query.q) { params.push(`%${req.query.q}%`); where += ` AND ct.full_name ILIKE $${params.length}`; }
  res.json(await many(`SELECT ct.id, ct.full_name, ct.company FROM contacts ct WHERE ${where} ORDER BY ct.full_name LIMIT 20`, params));
}));

export default r;
