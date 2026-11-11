// Aplica o pacote da Black Friday (modelos, condições e regras) à campanha Black Friday de Mesa.
// Uso: npm run pacote:black-friday            -> campanhas Black Friday de Mesa não encerradas
//      npm run pacote:black-friday -- 12      -> campanha de id 12
import { pool, tx } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { applyBlackFridayPackage, findBlackFridayCampaigns } from '../server/services/blackFriday.js';

await migrate({ log: () => {} });
const id = Number(process.argv[2]) || null;
try {
  const out = await tx(async (c) => {
    const admin = (await c.query(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`)).rows[0];
    const targets = id ? [{ id }] : await findBlackFridayCampaigns(c);
    if (!targets.length) throw new Error('Nenhuma campanha Black Friday de Mesa encontrada. Crie a campanha ou informe o id.');
    const res = [];
    for (const t of targets) res.push(await applyBlackFridayPackage(c, t.id, admin?.id ?? null));
    return res;
  });
  console.log(JSON.stringify(out, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
await pool.end();
