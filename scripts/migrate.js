require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { pool } = require("../src/db");

async function main() {
  const schemaPath = path.resolve(__dirname, "..", "db", "schema.sql");
  const sql = await fs.readFile(schemaPath, "utf8");
  await pool.query(sql);
  console.log("Database migration completed.");
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
