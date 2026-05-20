require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
async function main() {
  const r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'email'");
  console.log('email col:', r.rows.length > 0 ? 'EXISTS' : 'MISSING');
  const r2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_notifications'");
  console.log('agent_notifications columns:', r2.rows.map(r => r.column_name).join(', '));
  const r3 = await pool.query("SELECT COUNT(*)::int as c FROM agent_notifications");
  console.log('notification count:', r3.rows[0].c);
  pool.end();
}
main().catch(e => { console.error(e); pool.end(); });
