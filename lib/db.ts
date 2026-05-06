// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = g._db ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") g._db = db;
