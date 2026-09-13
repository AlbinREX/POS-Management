import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';
export { PrismaClient, Prisma } from './generated/client';
export function createDatabase(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error('DATABASE_URL is required');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 12, connectionTimeoutMillis: 5000 }),
  });
}
