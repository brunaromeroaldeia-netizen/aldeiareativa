// Adaptador do driver "pg" para o PostgreSQL do navegador (PGlite).
let dbPromise = null;
export function setDatabase(promise) { dbPromise = promise; }

async function run(text, params) {
  const db = await dbPromise;
  const r = await db.query(text, params || []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length, fields: r.fields };
}

class Client {
  query(text, params) { return run(text, params); }
  release() {}
}

export class Pool {
  constructor() {}
  query(text, params) { return run(text, params); }
  async connect() { return new Client(); }
  on() {}
  async end() {}
}

export const types = { setTypeParser() {} };
export default { Pool, types };
