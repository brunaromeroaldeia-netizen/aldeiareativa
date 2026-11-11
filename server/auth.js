import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { one, query } from './db.js';
import { HttpError } from './lib/http.js';

export const COOKIE = 'ar_session';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = sha256;

export const hashPassword = (pw) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);

export function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'A senha deve combinar letras e números.';
  if (pw.length > 200) return 'Senha longa demais.';
  return null;
}

export async function createSession(res, user, req) {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  await query(
    'INSERT INTO sessions(token_hash, user_id, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
    [sha256(token), user.id, expires, req.ip, String(req.headers['user-agent'] || '').slice(0, 300)],
  );
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, expires, path: '/',
  });
}

export async function destroySession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) await query('DELETE FROM sessions WHERE token_hash=$1', [sha256(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Carrega a usuária da sessão (se houver). */
export async function loadUser(req, _res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return next();
    const row = await one(
      `SELECT s.id AS sid, s.last_seen_at, u.id, u.name, u.email, u.role, u.active, u.must_change_password
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash=$1 AND s.expires_at > now()`,
      [sha256(token)],
    );
    if (!row || !row.active) return next();
    const idleMs = Date.now() - new Date(row.last_seen_at).getTime();
    if (idleMs > config.sessionIdleHours * 3600000) {
      await query('DELETE FROM sessions WHERE id=$1', [row.sid]);
      return next();
    }
    if (idleMs > 60000) query('UPDATE sessions SET last_seen_at=now() WHERE id=$1', [row.sid]).catch(() => {});
    req.user = { id: row.id, name: row.name, email: row.email, role: row.role, mustChangePassword: row.must_change_password };
    req.sessionId = row.sid;
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada. Faça login novamente.'));
  if (req.user.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) {
    return next(new HttpError(403, 'Defina uma nova senha para continuar.', { code: 'MUST_CHANGE_PASSWORD' }));
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Acesso restrito à administradora.'));
  next();
}

export const isAdmin = (req) => req.user?.role === 'admin';

let dummyHash;
/** Comparação "falsa" para igualar o tempo de resposta quando o e-mail não existe. */
export async function dummyVerify(pw) {
  dummyHash ||= await bcrypt.hash('dummy-password-0', 12);
  await bcrypt.compare(pw, dummyHash);
}
