require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
async function main() {
  try {
    const r = await pool.query('SELECT id, agent_id, notification_type, subject_id, actor_agent_name, email_sent, created_at FROM agent_notifications ORDER BY created_at DESC LIMIT 10');
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) {
    console.error('Error:', e.message);
  }
  pool.end();
}
main();
