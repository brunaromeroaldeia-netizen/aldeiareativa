// Normalização de dados de contato (telefone BR, e-mail, nomes, cabeçalhos)

export function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normKey(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function cleanText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a' ? null : s;
}

/** Normaliza telefone brasileiro para DDD + número (10/11 dígitos). Outros formatos ficam só com dígitos. */
export function normalizePhone(v) {
  if (v === null || v === undefined) return null;
  // planilhas às vezes trazem vários números: usa o primeiro
  const first = String(v).split(/[\/;|,]| ou /i)[0];
  let d = first.replace(/\D/g, '');
  if (!d) return null;
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1); // 0 + DDD + 9 + 8
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2); // celular sem o 9
  if (d.length < 8) return null;
  return d;
}

export function formatPhone(norm) {
  if (!norm) return '';
  if (norm.length === 11) return `(${norm.slice(0, 2)}) ${norm.slice(2, 7)}-${norm.slice(7)}`;
  if (norm.length === 10) return `(${norm.slice(0, 2)}) ${norm.slice(2, 6)}-${norm.slice(6)}`;
  return norm;
}

export function normalizeEmail(v) {
  const s = cleanText(v);
  if (!s) return null;
  const e = s.toLowerCase().split(/[\s;,]+/)[0];
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

const LOWER_WORDS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'van', 'von']);

export function titleCaseName(v) {
  const s = cleanText(v);
  if (!s) return null;
  const hasLower = /[a-zà-ÿ]/.test(s);
  const hasUpper = /[A-ZÀ-Þ]/.test(s);
  if (hasLower && hasUpper) return s; // já está com caixa mista: respeita
  return s.toLowerCase().split(' ').map((w, i) =>
    i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function firstNameOf(fullName) {
  const s = cleanText(fullName);
  if (!s) return null;
  const tok = s.split(' ').find((t) => /[A-Za-zÀ-ÿ]/.test(t));
  if (!tok) return null;
  const clean = tok.replace(/[^A-Za-zÀ-ÿ'-]/g, '');
  if (!clean) return null;
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

/** Similaridade simples entre nomes: compara primeiro nome e tokens em comum. */
export function nameSimilar(a, b) {
  if (!a || !b) return true; // sem nome não dá para contradizer
  const ta = normKey(a).split(' ').filter((t) => t.length > 1);
  const tb = normKey(b).split(' ').filter((t) => t.length > 1);
  if (!ta.length || !tb.length) return true;
  if (ta[0] === tb[0]) return true;
  const set = new Set(ta);
  return tb.some((t) => set.has(t) && t.length > 2);
}

export function parseMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = String(v).replace(/[R$\s]/gi, '');
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
