import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@": path.resolve(__dirname) };

export default defineConfig({
  resolve: { alias },
  test: {
    // Integration files share one database, so files must not run concurrently.
    // (Vitest only supports this globally, not per project; unit tests are tiny.)
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["lib/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Mocks @/lib/supabase/server and resets DB + fake user before each test.
          setupFiles: ["tests/integration/setup.ts"],
          // Local throwaway DB created by `bash scripts/test-db.sh`. Not a secret.
          env: {
            DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/forma_test",
            DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/forma_test",
          },
          testTimeout: 15_000,
        },
      },
    ],
  },
});
