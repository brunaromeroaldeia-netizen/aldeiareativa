import { Router } from 'express';
import { z } from 'zod';
import { many, query } from '../db.js';
import { ah, parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireAdmin } from '../auth.js';

const r = Router();

export async function getSettings() {
  const rows = await many('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((x) => [x.key, x.value]));
}

r.get('/', ah(async (_req, res) => res.json(await getSettings())));

r.put('/', requireAdmin, ah(async (req, res) => {
  const d = parse(z.object({
    unidade_padrao: z.string().trim().min(1).max(80).optional(),
    janela_abordagem_recente_dias: z.number().int().min(0).max(365).optional(),
    followup_dias_padrao: z.number().int().min(1).max(60).optional(),
    max_tentativas_padrao: z.number().int().min(1).max(10).optional(),
    retencao_meses: z.number().int().min(6).max(240).optional(),
  }), req.body);
  for (const [k, v] of Object.entries(d)) {
    await query(`INSERT INTO settings(key, value, updated_at, updated_by) VALUES ($1,$2,now(),$3)
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`, [k, JSON.stringify(v), req.user.id]);
  }
  await audit(req, 'configuracoes_alteradas', 'settings', null, d);
  res.json(await getSettings());
}));

r.get('/audit', requireAdmin, ah(async (req, res) => {
  res.json(await many(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
    ORDER BY a.id DESC LIMIT 200`));
}));

export default r;
