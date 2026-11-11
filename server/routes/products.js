import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { ah, bad, parse, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAdmin } from '../auth.js';

const r = Router();

r.get('/', ah(async (req, res) => {
  const all = req.query.all === '1';
  res.json(await many(`SELECT p.*,
      (SELECT count(*) FROM opportunities o WHERE o.product_id=p.id) AS opportunities,
      (SELECT count(DISTINCT o.contact_id) FROM opportunities o WHERE o.product_id=p.id) AS contacts,
      (SELECT count(*) FROM campaigns c WHERE p.id = ANY(c.product_ids) AND c.status='ativa') AS active_campaigns
    FROM products p ${all ? '' : 'WHERE p.active'} ORDER BY p.sort_order, p.name`));
}));

/** Panorama de um produto: matriz ano × status, campanhas e resultados. */
r.get('/:id/overview', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const product = await one('SELECT * FROM products WHERE id=$1', [id]);
  if (!product) throw notFound();
  const matrix = await many(`SELECT ref_year, historical_status, count(*)::int AS n, count(DISTINCT contact_id)::int AS contacts
    FROM opportunities WHERE product_id=$1 GROUP BY 1,2 ORDER BY 1 NULLS LAST`, [id]);
  const lostReasons = await many(`SELECT COALESCE(lost_reason,'(sem motivo)') AS reason, count(*)::int AS n FROM opportunities
    WHERE product_id=$1 AND historical_status='perdido' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [id]);
  const campaigns = await many(`SELECT c.id, c.name, c.status, c.start_date, c.end_date,
      count(cc.id)::int AS participants,
      count(cc.first_sent_at)::int AS sent,
      count(cc.responded_at)::int AS responded,
      count(cc.converted_at)::int AS converted,
      COALESCE(sum(cc.conversion_value),0) AS revenue
    FROM campaigns c LEFT JOIN campaign_contacts cc ON cc.campaign_id=c.id
    WHERE $1 = ANY(c.product_ids) GROUP BY c.id ORDER BY c.created_at DESC`, [id]);
  res.json({ product, matrix, lostReasons, campaigns });
}));

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

r.post('/', requireAdmin, ah(async (req, res) => {
  const d = parse(schema, req.body);
  if (await one('SELECT 1 FROM products WHERE lower(name)=lower($1)', [d.name])) throw bad('Já existe um produto com este nome.');
  const p = await one(`INSERT INTO products(name, description, aliases, color, active, sort_order)
    VALUES ($1,$2,$3,COALESCE($4,'#3f6b55'),COALESCE($5,TRUE),COALESCE($6,(SELECT COALESCE(max(sort_order),0)+1 FROM products))) RETURNING *`,
    [d.name, d.description ?? null, d.aliases ?? [], d.color ?? null, d.active ?? null, d.sort_order ?? null]);
  await audit(req, 'produto_criado', 'product', p.id, d);
  res.json(p);
}));

r.patch('/:id', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const d = parse(schema.partial(), req.body);
  if (d.name && await one('SELECT 1 FROM products WHERE lower(name)=lower($1) AND id<>$2', [d.name, id])) throw bad('Já existe um produto com este nome.');
  const p = await one(`UPDATE products SET name=COALESCE($2,name), description=CASE WHEN $8 THEN $3 ELSE description END,
      aliases=COALESCE($4,aliases), color=COALESCE($5,color), active=COALESCE($6,active), sort_order=COALESCE($7,sort_order), updated_at=now()
    WHERE id=$1 RETURNING *`, [id, d.name ?? null, d.description ?? null, d.aliases ?? null, d.color ?? null, d.active ?? null, d.sort_order ?? null, 'description' in d]);
  if (!p) throw notFound();
  await audit(req, 'produto_editado', 'product', id, d);
  res.json(p);
}));

export default r;
