require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
async function run() {
  const result = await pool.query("SELECT id, category, objective FROM topic_config WHERE objective LIKE 'Topic:%'");
  for (const row of result.rows) {
    const cleaned = row.objective.replace(/^Topic:\s*/, '');
    await pool.query('UPDATE topic_config SET objective = $1 WHERE id = $2', [cleaned, row.id]);
    console.log('Fixed:', row.category);
  }
  console.log('Done -', result.rows.length, 'updated');
  await pool.end();
}
run().catch(e => console.error(e.message));
