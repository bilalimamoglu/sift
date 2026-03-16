import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchFixture } from "./fixtures.js";

const REAL_DIR = join(import.meta.dirname, "real");

function load(name: string): string {
  return readFileSync(join(REAL_DIR, name), "utf-8");
}

export function buildRealFixtures(): BenchFixture[] {
  const singleBlockerRaw = load("single-blocker-short.txt");
  const mixedFullRaw = load("mixed-full-suite.txt");
  const mixedFullTbno = load("mixed-full-suite-tbno.txt");
  const openApiDiff = load("openapi-diff.txt");
  const manifestTbshort = load("manifest-tbshort.txt");
  const snapshotDriftRaw = load("snapshot-drift-only.txt");

  return [
    {
      name: "single-blocker-short-real",
      description:
        "Real project: single DB env blocker with pytest-asyncio traceback.",
      rawOutput: singleBlockerRaw,
      rawRecipe: [
        {
          command: "python -m pytest tests/ -x",
          output: singleBlockerRaw
        }
      ],
      rawRecipeStopAfter: 1,
      completion: {
        expectedBuckets: ["shared_environment_blocker"],
        expectedEntitiesAny: ["PGTEST_POSTGRES_DSN"],
        expectedMaxDetail: "standard"
      }
    },
    {
      name: "mixed-full-suite-real",
      description:
        "Real project full suite: 124 DB errors + 3 contract drift failures.",
      rawOutput: mixedFullRaw,
      rawRecipe: [
        {
          command: "python -m pytest tests/",
          output: mixedFullRaw
        },
        {
          command: "python -m pytest tests/ --tb=no -q",
          output: mixedFullTbno
        },
        {
          command:
            'python -m pytest tests/contracts/test_openapi_contract_freeze.py --tb=long | grep -A10 "Left contains"',
          output: openApiDiff
        },
        {
          command:
            "python -m pytest tests/contracts/test_feature_manifest_freeze.py --tb=short",
          output: manifestTbshort
        }
      ],
      rawRecipeStopAfter: 4,
      completion: {
        expectedBuckets: ["shared_environment_blocker", "contract_snapshot_drift"],
        expectedEntitiesAny: [
          "PGTEST_POSTGRES_DSN",
          "openai-gpt-image-1.5",
          "/api/v1/admin/landing-gallery"
        ],
        expectedMaxDetail: "standard"
      }
    },
    {
      name: "snapshot-drift-only-real",
      description:
        "Real project: 3 freeze tests with full assertion diff output.",
      rawOutput: snapshotDriftRaw,
      rawRecipe: [
        {
          command:
            "python -m pytest tests/contracts/test_feature_manifest_freeze.py tests/contracts/test_openapi_contract_freeze.py tests/contracts/test_task_matrix_snapshot_freeze.py",
          output: snapshotDriftRaw
        },
        {
          command:
            'python -m pytest tests/contracts/test_openapi_contract_freeze.py --tb=long | grep -A10 "Left contains"',
          output: openApiDiff
        }
      ],
      rawRecipeStopAfter: 2,
      completion: {
        expectedBuckets: ["contract_snapshot_drift"],
        expectedEntitiesAny: ["openai-gpt-image-1.5", "/api/v1/admin/landing-gallery"],
        expectedMaxDetail: "standard"
      }
    }
  ];
}
