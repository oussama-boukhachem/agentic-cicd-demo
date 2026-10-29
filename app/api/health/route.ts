import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: 'ok', db: 'up' });
  } catch (error) {
    return Response.json(
      { status: 'error', db: 'down', message: (error as Error).message },
      { status: 503 }
    );
  }
}
