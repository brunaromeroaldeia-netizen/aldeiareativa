import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { many, one, query, tx } from '../db.js';
import { ah, bad, parse, intParam, notFound } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { normKey } from '../lib/normalize.js';
import { parseWorkbook, autoMap, detectYear, matchProduct, analyzeImport, importStats, commitImport, FIELDS } from '../services/importer.js';

const r = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : bad('Formato não suportado. Envie .xlsx, .xls ou .csv.'), ok);
  },
});

r.get('/fields', (_req, res) => res.json(FIELDS.map(({ key, label }) => ({ key, label }))));

r.get('/', ah(async (_req, res) => {
  res.json(await many(`SELECT i.id, i.filename, i.status, i.created_at, i.committed_at, i.is_demo, i.file_size, i.update_rule,
      i.stats->'commit' AS commit, (i.stats->>'total')::int AS total, u.name AS created_by_name, cu.name AS committed_by_name,
      (SELECT array_agg(name ORDER BY position) FROM import_sheets s WHERE s.import_id=i.id AND s.include) AS sheets
    FROM imports i LEFT JOIN users u ON u.id=i.created_by LEFT JOIN users cu ON cu.id=i.committed_by
    WHERE i.status <> 'cancelada' ORDER BY i.id DESC`));
}));

r.post('/', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('Nenhum arquivo enviado.');
  const sheets = parseWorkbook(req.file.buffer, req.file.originalname);
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const previous = await one(`SELECT id, created_at FROM imports WHERE file_hash=$1 AND status='concluida' ORDER BY id DESC LIMIT 1`, [hash]);
  const safeName = req.file.originalname.replace(/[^\w.\- ]+/g, '_').slice(-120);
  const stored = `${Date.now()}-${hash.slice(0, 10)}-${safeName}`;
  const products = await many('SELECT id, name, aliases FROM products WHERE active');
  const fileYear = detectYear(req.file.originalname);
  const fileProduct = matchProduct(req.file.originalname.replace(/\.\w+$/, ''), products);

  const id = await tx(async (c) => {
    // o arquivo original fica guardado no banco (consultável depois, sobrevive a atualizações do site)
    const imp = (await c.query(`INSERT INTO imports(filename, stored_path, file_hash, file_size, created_by, file_data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.file.originalname, stored, hash, req.file.size, req.user.id, Buffer.from(req.file.buffer)])).rows[0];
    for (const s of sheets) {
      await c.query(`INSERT INTO import_sheets(import_id, name, position, headers, rows, row_numbers, include, mapping, default_product_id, default_year)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [imp.id, s.name, s.position, JSON.stringify(s.headers), JSON.stringify(s.rows), JSON.stringify(s.rowNumbers), s.rows.length > 0,
          autoMap(s.headers), matchProduct(s.name, products) || fileProduct, detectYear(s.name) || fileYear]);
    }
    return imp.id;
  });
  await audit(req, 'importacao_enviada', 'import', id, { filename: req.file.originalname, sheets: sheets.length });
  res.json({ id, previousImport: previous });
}));

async function loadImport(id) {
  const imp = await one(`SELECT i.id, i.filename, i.stored_path, i.file_hash, i.file_size, i.status, i.update_rule, i.stats, i.is_demo, i.created_by, i.created_at,
      i.committed_at, i.committed_by, (i.file_data IS NOT NULL) AS has_file, u.name AS created_by_name FROM imports i LEFT JOIN users u ON u.id=i.created_by WHERE i.id=$1`, [id]);
  if (!imp) throw notFound('Importação não encontrada.');
  const sheets = await many(`SELECT id, name, position, headers, include, mapping, default_product_id, default_year, product_value_map,
      jsonb_array_length(rows) AS row_count, (SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements(rows) x LIMIT 6) t) AS sample
    FROM import_sheets WHERE import_id=$1 ORDER BY position`, [id]);
  return { ...imp, stored_path: undefined, sheets };
}

r.get('/:id', ah(async (req, res) => res.json(await loadImport(intParam(req.params.id)))));

const configSchema = z.object({
  update_rule: z.enum(['nao_atualizar', 'preencher_vazios', 'sobrescrever']),
  sheets: z.array(z.object({
    id: z.number().int(),
    include: z.boolean(),
    mapping: z.record(z.string(), z.number().int().min(0).nullable()),
    default_product_id: z.number().int().nullable(),
    default_year: z.number().int().min(1990).max(2100).nullable(),
    product_value_map: z.record(z.string(), z.number().int().nullable()).optional(),
  })),
});

r.post('/:id/analyze', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const d = parse(configSchema, req.body);
  const imp = await one('SELECT status FROM imports WHERE id=$1', [id]);
  if (!imp) throw notFound();
  if (imp.status === 'concluida' || imp.status === 'cancelada') throw bad('Esta importação não pode mais ser alterada.');
  await query('UPDATE imports SET update_rule=$2 WHERE id=$1', [id, d.update_rule]);
  for (const s of d.sheets) {
    const mapping = Object.fromEntries(Object.entries(s.mapping).filter(([, v]) => v !== null));
    const pvm = Object.fromEntries(Object.entries(s.product_value_map || {}).map(([k, v]) => [normKey(k), v]));
    await query(`UPDATE import_sheets SET include=$3, mapping=$4, default_product_id=$5, default_year=$6, product_value_map=$7 WHERE id=$1 AND import_id=$2`,
      [s.id, id, s.include, mapping, s.default_product_id, s.default_year, pvm]);
  }
  const stats = await analyzeImport(id);
  res.json(stats);
}));

r.get('/:id/rows', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const filter = String(req.query.filter || 'todos');
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = 50;
  const where = {
    todos: 'TRUE',
    novos: `match_type IN ('novo','interno')`,
    existentes: `match_type='existente'`,
    ambiguos: `match_type='ambiguo'`,
    duplicados: `(match_type='interno' OR (dup_opportunity_id IS NOT NULL AND jsonb_array_length(opp_changes)=0) OR decision='ignorar')`,
    situacao: `jsonb_array_length(opp_changes) > 0`,
    problemas: `EXISTS (SELECT 1 FROM jsonb_array_elements(issues) x WHERE x->>'level' IN ('erro','revisao','aviso') AND x->>'msg' <> 'Sem telefone')`,
    revisao: `historical_status='revisao'`,
    sem_telefone: `mapped->>'phone_norm' IS NULL`,
    atualizacoes: `jsonb_array_length(changes) > 0`,
  }[filter] || 'TRUE';
  const rows = await many(`SELECT r.id, r.sheet_name, r.row_number, r.mapped, r.issues, r.historical_status, r.ref_year, r.year_source, r.product_id,
      r.match_type, r.match_contact_id, r.candidates, r.dup_opportunity_id, r.changes, r.opp_changes, r.decision, r.decision_contact_id, p.name AS product_name
    FROM import_rows r LEFT JOIN products p ON p.id=r.product_id WHERE r.import_id=$1 AND ${where} ORDER BY r.id LIMIT ${size} OFFSET ${(page - 1) * size}`, [id]);
  const { n } = await one(`SELECT count(*)::int AS n FROM import_rows WHERE import_id=$1 AND ${where}`, [id]);
  res.json({ rows, total: n, page, pageSize: size });
}));

r.patch('/:id/rows/:rowId', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const d = parse(z.object({ decision: z.enum(['auto', 'criar', 'vincular', 'ignorar', 'nova_oportunidade']), contact_id: z.number().int().nullable().optional() }), req.body);
  const row = await one('SELECT r.*, i.status FROM import_rows r JOIN imports i ON i.id=r.import_id WHERE r.id=$1 AND r.import_id=$2', [intParam(req.params.rowId), id]);
  if (!row) throw notFound();
  if (row.status !== 'analisada') throw bad('Importação não está em análise.');
  if (d.decision === 'vincular') {
    if (!d.contact_id || !(await one('SELECT 1 FROM contacts WHERE id=$1', [d.contact_id]))) throw bad('Selecione o contato a vincular.');
  }
  await query('UPDATE import_rows SET decision=$2, decision_contact_id=$3 WHERE id=$1', [row.id, d.decision, d.decision === 'vincular' ? d.contact_id : null]);
  res.json(await importStats(id));
}));

r.post('/:id/bulk-decision', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const d = parse(z.object({ scope: z.enum(['ambiguos', 'duplicados_existentes', 'atualizacoes']), decision: z.enum(['auto', 'criar', 'ignorar', 'vincular_sugerido']) }), req.body);
  if (d.scope === 'ambiguos') {
    if (d.decision === 'vincular_sugerido') {
      await query(`UPDATE import_rows SET decision='vincular', decision_contact_id=COALESCE(match_contact_id, (candidates->0->>'id')::int)
        WHERE import_id=$1 AND match_type='ambiguo'`, [id]);
    } else await query(`UPDATE import_rows SET decision=$2, decision_contact_id=NULL WHERE import_id=$1 AND match_type='ambiguo'`, [id, d.decision]);
  } else if (d.scope === 'atualizacoes') {
    await query(`UPDATE import_rows SET decision=$2 WHERE import_id=$1 AND jsonb_array_length(opp_changes) > 0`, [id, d.decision === 'ignorar' ? 'ignorar' : 'auto']);
  } else {
    await query(`UPDATE import_rows SET decision=$2 WHERE import_id=$1 AND dup_opportunity_id IS NOT NULL AND jsonb_array_length(opp_changes) = 0`, [id, d.decision === 'ignorar' ? 'ignorar' : 'auto']);
  }
  res.json(await importStats(id));
}));

r.post('/:id/commit', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const result = await commitImport(id, req.user);
  res.json(result);
}));

r.delete('/:id', ah(async (req, res) => {
  const id = intParam(req.params.id);
  const imp = await one('SELECT * FROM imports WHERE id=$1', [id]);
  if (!imp) throw notFound();
  if (imp.status === 'concluida') throw bad('Importações concluídas não podem ser canceladas (o histórico é preservado).');
  await query(`UPDATE imports SET status='cancelada' WHERE id=$1`, [id]);
  await query('DELETE FROM import_rows WHERE import_id=$1', [id]);
  await query(`UPDATE import_sheets SET rows='[]' WHERE import_id=$1`, [id]);
  await query(`UPDATE imports SET file_data=NULL WHERE id=$1`, [id]);
  if (imp.stored_path) fs.rm(path.join(config.uploadDir, imp.stored_path), { force: true }, () => {});
  await audit(req, 'importacao_cancelada', 'import', id);
  res.json({ ok: true });
}));

r.get('/:id/file', ah(async (req, res) => {
  const imp = await one('SELECT filename, stored_path, file_data FROM imports WHERE id=$1', [intParam(req.params.id)]);
  if (imp?.file_data) {
    await audit(req, 'arquivo_importacao_baixado', 'import', Number(req.params.id));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(imp.filename)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.send(imp.file_data);
  }
  if (!imp?.stored_path) throw notFound('Arquivo de origem indisponível.');
  const file = path.join(config.uploadDir, path.basename(imp.stored_path));
  if (!fs.existsSync(file)) throw notFound('Arquivo de origem indisponível.');
  await audit(req, 'arquivo_importacao_baixado', 'import', Number(req.params.id));
  res.download(file, imp.filename);
}));

export default r;
