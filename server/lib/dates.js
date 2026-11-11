import { config } from '../config.js';

/** Data de hoje (YYYY-MM-DD) no fuso da operação. */
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function valid(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Converte valores de planilha em data ISO. Retorna { date, error }.
 * Aceita Date, número serial do Excel, dd/mm/aaaa, aaaa-mm-dd, dd-mm-aaaa, dd.mm.aaaa (com ou sem hora).
 */
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return { date: null };
  if (v instanceof Date) {
    if (isNaN(v)) return { date: null, error: 'data inválida' };
    // SheetJS cria datas em horário local à meia-noite; somar 12h evita virar o dia
    const dt = new Date(v.getTime() + 12 * 3600 * 1000);
    return { date: valid(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()) || null };
  }
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      const ms = Math.round((v - 25569) * 86400 * 1000);
      const dt = new Date(ms);
      return { date: valid(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) };
    }
    return { date: null, error: `valor numérico não reconhecido como data (${v})` };
  }
  const s = String(v).trim();
  if (!s || s === '-') return { date: null };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = valid(+m[1], +m[2], +m[3]);
    return d ? { date: d } : { date: null, error: `data inválida (${s})` };
  }
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const d = valid(y, +m[2], +m[1]);
    return d ? { date: d } : { date: null, error: `data inválida (${s})` };
  }
  if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s));
  return { date: null, error: `data não reconhecida (${s})` };
}
