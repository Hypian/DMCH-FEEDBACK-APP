import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.NEON_DATABASE_URL;

if (!databaseUrl) {
  console.log('ℹ NEON_DATABASE_URL is not set in environment or .env.');
  console.log('To apply migrations to your Neon database:');
  console.log('1. Set NEON_DATABASE_URL in .env, or');
  console.log('2. Copy and paste backend/neon/all-migrations.sql into the Neon SQL Editor.');
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl });

async function runMigrations() {
  const migrationPath = path.join(__dirname, 'neon', 'all-migrations.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('Applying database migrations from backend/neon/all-migrations.sql…');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log('✔ All migrations applied successfully!');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    console.error('✖ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
