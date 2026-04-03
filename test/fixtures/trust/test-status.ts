import { readFileSync } from "node:fs";
import path from "node:path";

export interface TrustDiagnoseFixture {
  rawOutput: string;
  remainingSubsetAvailable?: boolean;
  includeTestIds?: boolean;
  resolvedTests?: string[];
  remainingTests?: string[];
}

function readRepoFixture(relativePath: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", relativePath), "utf8");
}

export const diagnoseSearchOnlyAnchorFixture: TrustDiagnoseFixture = {
  rawOutput: readRepoFixture("bench/test-status/real/mixed-full-suite.txt"),
  remainingSubsetAvailable: false
};

export const diagnoseExactWindowTracebackFixture: TrustDiagnoseFixture = {
  rawOutput: [
    "1 error during collection",
    "_ ERROR collecting tests/contracts/test_db_schema_freeze.py _",
    "tests/conftest.py:374: in _postgres_schema_isolation",
    "    raise RuntimeError(\"DB-isolated tests require PGTEST_POSTGRES_DSN\")",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users."
  ].join("\n"),
  remainingSubsetAvailable: false
};
