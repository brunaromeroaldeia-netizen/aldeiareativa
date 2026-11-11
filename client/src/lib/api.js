export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

async function request(method, url, body, { raw } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'aldeia-reativa', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (raw) return res;
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
    if (res.status === 403 && data?.details?.code === 'MUST_CHANGE_PASSWORD') window.dispatchEvent(new Event('auth:must-change'));
    throw new ApiError(res.status, data?.error || 'Falha na comunicação com o servidor.', data?.details);
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  put: (u, b) => request('PUT', u, b ?? {}),
  patch: (u, b) => request('PATCH', u, b ?? {}),
  del: (u, b) => request('DELETE', u, b),
  upload: (u, form) => request('POST', u, form),
};

export function qs(params) {
  const s = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    s.set(k, Array.isArray(v) ? v.join(',') : String(v));
  });
  const str = s.toString();
  return str ? `?${str}` : '';
}

/** Baixa arquivo de uma rota GET autenticada. */
export async function download(url) {
  const res = await request('GET', url, undefined, { raw: true });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new ApiError(res.status, d.error || 'Falha ao baixar arquivo.');
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const name = decodeURIComponent((cd.match(/filename="?([^"]+)"?/) || [])[1] || 'arquivo');
  if (window.__aldeiaSave) return window.__aldeiaSave(blob, name); // versão de testes publicada
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Copia texto preservando quebras de linha e emojis (com alternativa para navegadores sem Clipboard API). */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* usa alternativa */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}
