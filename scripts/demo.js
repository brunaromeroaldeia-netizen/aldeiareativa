// Carrega ou remove os dados fictícios de demonstração. Uso: npm run demo:load | npm run demo:remove
import { pool, one } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { loadDemo, removeDemo } from '../server/services/demo.js';

await migrate({ log: () => {} });
const admin = await one(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
if (!admin) { console.error('Crie as usuárias primeiro: npm run setup'); process.exit(1); }
const action = process.argv[2];
try {
  const r = action === 'remove' ? await removeDemo(admin.id) : await loadDemo(admin.id);
  console.log(action === 'remove' ? 'Dados de demonstração removidos:' : 'Dados de demonstração carregados:', r);
} catch (e) { console.error(e.message); process.exitCode = 1; }
await pool.end();
