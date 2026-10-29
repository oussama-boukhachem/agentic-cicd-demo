import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error('POSTGRES_URL is not set');
  process.exit(1);
}

const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: './lib/db/migrations' });
  console.log('migrations: up to date');
} finally {
  await client.end();
}
