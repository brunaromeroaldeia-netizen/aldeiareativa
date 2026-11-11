// Cria as usuárias iniciais (Administradora, Letícia e Giovana) com senhas temporárias aleatórias.
// As senhas são exibidas uma única vez no terminal e precisam ser trocadas no primeiro acesso.
// Uso: ADMIN_EMAIL=... LETICIA_EMAIL=... GIOVANA_EMAIL=... npm run setup
import crypto from 'node:crypto';
import { pool, one, query } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { hashPassword } from '../server/auth.js';

const users = [
  { name: process.env.ADMIN_NAME || 'Administradora', email: process.env.ADMIN_EMAIL || 'admin@aldeia.local', role: 'admin' },
  { name: 'Letícia', email: process.env.LETICIA_EMAIL || 'leticia@aldeia.local', role: 'vendedora' },
  { name: 'Giovana', email: process.env.GIOVANA_EMAIL || 'giovana@aldeia.local', role: 'vendedora' },
];

const tempPassword = () => `${crypto.randomBytes(9).toString('base64url')}${Math.floor(Math.random() * 90 + 10)}`;

await migrate({ log: () => {} });
console.log('\nUsuárias iniciais — anote as senhas temporárias (exibidas só agora):\n');
for (const u of users) {
  const exists = await one('SELECT id FROM users WHERE lower(email)=lower($1)', [u.email]);
  if (exists) { console.log(`  • ${u.name} <${u.email}> já existe — mantida.`); continue; }
  const pw = tempPassword();
  await query('INSERT INTO users(name, email, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,TRUE)', [u.name, u.email.toLowerCase(), u.role, await hashPassword(pw)]);
  console.log(`  • ${u.name.padEnd(15)} ${u.email.padEnd(28)} senha temporária: ${pw}`);
}
console.log('\nNo primeiro acesso, cada usuária será obrigada a definir uma senha própria.\n');
await pool.end();
