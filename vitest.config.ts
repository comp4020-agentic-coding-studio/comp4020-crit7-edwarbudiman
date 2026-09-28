import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests that import src/lib directly (the catalogue loads into SQLite)
    // get a throwaway database, never your local data.
    env: { DATABASE_PATH: join(mkdtempSync(join(tmpdir(), "unit-db-")), "test.db") },
    include: ["spec/**/*.test.ts", "scripts/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
  },
});
