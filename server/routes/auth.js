import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { one, query, tx } from '../db.js';
import { ah, bad, parse, HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import {
  createSession, destroySession, verifyPassword, hashPassword, validatePasswordStrength,
  randomToken, hashToken, requireAuth, dummyVerify,
} from '../auth.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' } });

r.post('/login', limiter, ah(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().trim().toLowerCase().min(3), password: z.string().min(1) }), req.body);
  const user = await one('SELECT * FROM users WHERE lower(email)=$1', [email]);
  const generic = new HttpError(401, 'E-mail ou senha incorretos.');
  if (!user || !user.active) { await dummyVerify(password); throw generic; }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new HttpError(423, 'Acesso temporariamente bloqueado por excesso de tentativas. Tente novamente em 15 minutos.');
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    const fails = user.failed_logins + 1;
    await query(`UPDATE users SET failed_logins=$2, locked_until=CASE WHEN $2>=8 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1`, [user.id, fails >= 8 ? 0 : fails]);
    await audit({ ip: req.ip, user: { id: user.id } }, 'login_falhou', 'user', user.id);
    throw generic;
  }
  await query('UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [user.id]);
  await createSession(res, user, req);
  await audit({ ip: req.ip, user }, 'login', 'user', user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.must_change_password } });
}));

r.post('/logout', ah(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

r.get('/me', (req, res) => res.json({ user: req.user || null }));

/** Primeiro acesso: enquanto não existe nenhuma usuária, o site permite criar a conta da administradora. */
r.get('/setup', ah(async (_req, res) => {
  const { n } = await one('SELECT count(*)::int AS n FROM users');
  res.json({ needsSetup: n === 0, codeRequired: !!config.setupCode || config.isProd });
}));

r.post('/setup', limiter, ah(async (req, res) => {
  const d = parse(z.object({
    name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email(),
    password: z.string(), code: z.string().trim().optional(),
  }), req.body);
  if (config.isProd && !config.setupCode) throw bad('Instalação bloqueada: defina a variável SETUP_CODE no servidor.');
  if (config.setupCode && d.code !== config.setupCode) throw new HttpError(403, 'Código de instalação incorreto.');
  const err = validatePasswordStrength(d.password);
  if (err) throw bad(err);
  const user = await tx(async (c) => {
    await c.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const { n } = (await c.query('SELECT count(*)::int AS n FROM users')).rows[0];
    if (n > 0) throw bad('O primeiro acesso já foi feito. Entre com seu e-mail e senha.');
    return (await c.query(`INSERT INTO users(name, email, role, password_hash, must_change_password) VALUES ($1,$2,'admin',$3,FALSE) RETURNING *`,
      [d.name, d.email, await hashPassword(d.password)])).rows[0];
  });
  await createSession(res, user, req);
  await audit({ ip: req.ip, user }, 'primeiro_acesso_administradora', 'user', user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: false } });
}));

r.post('/change-password', requireAuth, ah(async (req, res) => {
  const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string(), newPassword: z.string() }), req.body);
  const user = await one('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!(await verifyPassword(currentPassword, user.password_hash))) throw bad('Senha atual incorreta.');
  const err = validatePasswordStrength(newPassword);
  if (err) throw bad(err);
  if (await verifyPassword(newPassword, user.password_hash)) throw bad('A nova senha deve ser diferente da atual.');
  await query('UPDATE users SET password_hash=$2, must_change_password=FALSE, updated_at=now() WHERE id=$1', [user.id, await hashPassword(newPassword)]);
  // encerra as outras sessões
  await query('DELETE FROM sessions WHERE user_id=$1 AND id<>$2', [user.id, req.sessionId]);
  await audit(req, 'senha_alterada', 'user', user.id);
  res.json({ ok: true });
}));

/** Cria um link de redefinição (uso único, 2 horas). */
export async function createResetLink(userId, createdBy) {
  const token = randomToken();
  await query(`UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL`, [userId]);
  await query(`INSERT INTO password_resets(user_id, token_hash, expires_at, created_by) VALUES ($1,$2, now()+interval '2 hours', $3)`,
    [userId, hashToken(token), createdBy ?? null]);
  return `${config.appUrl.replace(/\/$/, '')}/redefinir-senha?token=${token}`;
}

r.post('/forgot', limiter, ah(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase() }), req.body);
  const user = await one('SELECT id, name, email FROM users WHERE lower(email)=$1 AND active', [email]);
  // resposta sempre igual, para não revelar se o e-mail existe
  const reply = { ok: true, message: config.smtp
    ? 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.'
    : 'Pedido registrado. A administradora receberá a solicitação e enviará um link seguro de redefinição.' };
  if (!user) return res.json(reply);
  if (config.smtp) {
    const link = await createResetLink(user.id, null);
    const transport = nodemailer.createTransport(config.smtp);
    await transport.sendMail({
      from: config.smtp.from, to: user.email, subject: 'Aldeia Reativa — redefinição de senha',
      text: `Olá, ${user.name.split(' ')[0]}!\n\nPara definir uma nova senha, acesse o link abaixo (válido por 2 horas, uso único):\n${link}\n\nSe você não pediu, ignore este e-mail.`,
    }).catch((e) => console.error('[smtp]', e.message));
  } else {
    const open = await one('SELECT id FROM access_requests WHERE user_id=$1 AND resolved_at IS NULL', [user.id]);
    if (!open) await query('INSERT INTO access_requests(user_id) VALUES ($1)', [user.id]);
  }
  await audit({ ip: req.ip }, 'recuperacao_solicitada', 'user', user.id);
  res.json(reply);
}));

r.get('/reset/:token', ah(async (req, res) => {
  const row = await one(`SELECT u.name FROM password_resets p JOIN users u ON u.id=p.user_id
    WHERE p.token_hash=$1 AND p.used_at IS NULL AND p.expires_at>now() AND u.active`, [hashToken(req.params.token)]);
  if (!row) throw bad('Link inválido ou expirado. Solicite um novo link.');
  res.json({ name: row.name });
}));

r.post('/reset', limiter, ah(async (req, res) => {
  const { token, newPassword } = parse(z.object({ token: z.string().min(10), newPassword: z.string() }), req.body);
  const err = validatePasswordStrength(newPassword);
  if (err) throw bad(err);
  await tx(async (c) => {
    const row = (await c.query(`SELECT p.id, p.user_id FROM password_resets p JOIN users u ON u.id=p.user_id
      WHERE p.token_hash=$1 AND p.used_at IS NULL AND p.expires_at>now() AND u.active FOR UPDATE`, [hashToken(token)])).rows[0];
    if (!row) throw bad('Link inválido ou expirado. Solicite um novo link.');
    await c.query('UPDATE password_resets SET used_at=now() WHERE id=$1', [row.id]);
    await c.query('UPDATE users SET password_hash=$2, must_change_password=FALSE, failed_logins=0, locked_until=NULL, updated_at=now() WHERE id=$1',
      [row.user_id, await hashPassword(newPassword)]);
    await c.query('DELETE FROM sessions WHERE user_id=$1', [row.user_id]);
    await c.query('UPDATE access_requests SET resolved_at=now() WHERE user_id=$1 AND resolved_at IS NULL', [row.user_id]);
    await audit({ ip: req.ip, user: { id: row.user_id } }, 'senha_redefinida', 'user', row.user_id, {}, c);
  });
  res.json({ ok: true });
}));

export default r;
