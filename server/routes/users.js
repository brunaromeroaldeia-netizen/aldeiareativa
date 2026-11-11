import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { ah, bad, parse, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAdmin, hashPassword, randomToken } from '../auth.js';
import { createResetLink } from './auth.js';

const r = Router();

// Lista básica (todas as usuárias podem ver nomes para filtros/comparativos)
r.get('/', ah(async (req, res) => {
  const admin = req.user.role === 'admin';
  const rows = await many(`SELECT id, name, role, active ${admin ? ', email, last_login_at, must_change_password, created_at' : ''}
    FROM users ORDER BY role, name`);
  res.json(rows);
}));

r.get('/access-requests', requireAdmin, ah(async (_req, res) => {
  res.json(await many(`SELECT a.id, a.created_at, u.id AS user_id, u.name, u.email FROM access_requests a
    JOIN users u ON u.id=a.user_id WHERE a.resolved_at IS NULL ORDER BY a.created_at`));
}));

const userSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['admin', 'vendedora']),
});

r.post('/', requireAdmin, ah(async (req, res) => {
  const data = parse(userSchema, req.body);
  if (await one('SELECT 1 FROM users WHERE lower(email)=$1', [data.email])) throw bad('Já existe uma usuária com este e-mail.');
  // senha aleatória inutilizável; o acesso é definido pelo link de convite
  const u = await one(`INSERT INTO users(name, email, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,FALSE) RETURNING id`,
    [data.name, data.email, data.role, await hashPassword(randomToken())]);
  const link = await createResetLink(u.id, req.user.id);
  await audit(req, 'usuaria_criada', 'user', u.id, { email: data.email, role: data.role });
  res.json({ id: u.id, link });
}));

r.patch('/:id', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  const data = parse(userSchema.partial().extend({ active: z.boolean().optional() }), req.body);
  const u = await one('SELECT * FROM users WHERE id=$1', [id]);
  if (!u) throw notFound();
  if (id === req.user.id && (data.active === false || (data.role && data.role !== 'admin'))) throw bad('Você não pode desativar ou rebaixar o próprio acesso.');
  if (data.email && data.email !== u.email && await one('SELECT 1 FROM users WHERE lower(email)=$1 AND id<>$2', [data.email, id])) throw bad('E-mail já utilizado.');
  await query(`UPDATE users SET name=COALESCE($2,name), email=COALESCE($3,email), role=COALESCE($4,role), active=COALESCE($5,active), updated_at=now() WHERE id=$1`,
    [id, data.name ?? null, data.email ?? null, data.role ?? null, data.active ?? null]);
  if (data.active === false) await query('DELETE FROM sessions WHERE user_id=$1', [id]);
  await audit(req, 'usuaria_editada', 'user', id, data);
  res.json({ ok: true });
}));

r.post('/:id/reset-link', requireAdmin, ah(async (req, res) => {
  const id = intParam(req.params.id);
  if (!(await one('SELECT 1 FROM users WHERE id=$1', [id]))) throw notFound();
  const link = await createResetLink(id, req.user.id);
  await query('UPDATE access_requests SET resolved_at=now(), resolved_by=$2 WHERE user_id=$1 AND resolved_at IS NULL', [id, req.user.id]);
  await audit(req, 'link_redefinicao_gerado', 'user', id);
  res.json({ link, expiresInHours: 2 });
}));

export default r;
