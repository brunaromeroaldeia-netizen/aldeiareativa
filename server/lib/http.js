export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const bad = (msg, details) => new HttpError(400, msg, details);
export const forbidden = (msg = 'Você não tem permissão para esta ação.') => new HttpError(403, msg);
export const notFound = (msg = 'Registro não encontrado.') => new HttpError(404, msg);
export const conflict = (msg, details) => new HttpError(409, msg, details);

/** Envolve handlers assíncronos do Express. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Valida com zod e lança 400 com mensagens legíveis. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'dados'}: ${i.message}`).join('; ');
    throw bad(`Dados inválidos — ${msg}`);
  }
  return r.data;
}

export function intParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad('Identificador inválido.');
  return n;
}

export function intList(v) {
  if (v === undefined || v === null || v === '') return [];
  return String(v).split(',').map(Number).filter((n) => Number.isInteger(n));
}
export function strList(v) {
  if (v === undefined || v === null || v === '') return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}
