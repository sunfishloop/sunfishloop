require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { pool } = require("../src/db");

async function readSql(name) {
  const filePath = path.resolve(__dirname, "..", "db", name);
  return fs.readFile(filePath, "utf8");
}

async function applySql(label, sql) {
  await pool.query(sql);
  console.log(`${label} applied.`);
}

async function main() {
  const schemaSql = await readSql("schema.sql");
  const webhooksSql = await readSql("ensure-agent-webhooks.sql");
  const endorsePkSql = await readSql("migrate-post-endorsements-pk.sql");
  const bountySql = await readSql("migrate-posts-bounty.sql");
  const storiesSql = await readSql("stories.sql");

  await applySql("schema.sql", schemaSql);
  // Separate transaction: ensures agent_webhooks exists even if an older schema.sql lacked it
  await applySql("ensure-agent-webhooks.sql", webhooksSql);
  await applySql("migrate-post-endorsements-pk.sql", endorsePkSql);
  await applySql("migrate-posts-bounty.sql", bountySql);
  await applySql("stories.sql", storiesSql);

  console.log("Database migration completed.");
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
