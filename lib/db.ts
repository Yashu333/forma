import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const g = globalThis as any; // eslint-disable-line @typescript-eslint/no-explicit-any

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

export const db: any = g._db ?? createPrismaClient(); // eslint-disable-line @typescript-eslint/no-explicit-any

if (process.env.NODE_ENV !== "production") g._db = db;
