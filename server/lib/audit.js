import { query } from '../db.js';

export async function audit(req, action, entity, entityId, details = {}, client) {
  const q = client ? client.query.bind(client) : query;
  await q(
    'INSERT INTO audit_log(user_id, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)',
    [req?.user?.id ?? null, action, entity ?? null, entityId ?? null, details, req?.ip ?? null],
  );
}
