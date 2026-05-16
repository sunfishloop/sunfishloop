const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required. Set it in .env or the server environment.");
}

const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_SIZE || 10),
  idleTimeoutMillis: 30_000,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined
});

function query(text, params = []) {
  return pool.query(text, params);
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaction };
