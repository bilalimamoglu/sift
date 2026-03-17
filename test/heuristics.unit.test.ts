import { describe, expect, it } from "vitest";
import {
  analyzeTestStatus,
  applyHeuristicPolicy,
  classifyFailureReasonForTest
} from "../src/core/heuristics.js";
import {
  buildTestStatusDiagnoseContract,
  buildTestStatusPublicDiagnoseContract
} from "../src/core/testStatusDecision.js";

function buildMixedFailureOutput(): string {
  return [
    "platform darwin -- Python 3.11.4",
    "collecting ... collected 640 items",
    "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen ERROR [  1%]",
    "tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen FAILED [  1%]",
    "tests/contracts/test_frontend_catalog_payload.py::test_provider_capabilities_payload_matches_response_schema ERROR [  2%]",
    "tests/e2e/test_core_functionality.py::test_health_and_provider_capabilities ERROR [  4%]",
    "tests/unit/providers/test_provider_capabilities_and_schema.py::test_scene_reference_schema_auto_migrates ERROR [  5%]",
    "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen FAILED [  6%]",
    "tests/contracts/test_task_matrix_snapshot_freeze.py::test_task_matrix_snapshot_is_frozen FAILED [  7%]",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users.",
    "python scripts/update_contract_snapshots.py",
    "E     Left contains 4 more items:",
    "E     {'/api/v1/admin/landing-gallery': ['GET'],",
    "E      '/api/v1/admin/landing-gallery/drafts/{draft_id}/discard': ['POST'],",
    "E      '/api/v1/admin/landing-gallery/publish': ['PUT'],",
    "E      '/api/v1/admin/landing-gallery/uploads/stream': ['POST']}",
    "  -             'openai-gpt-image-1.5',",
    "============= 3 failed, 511 passed, 2 skipped, 124 errors in 3.46s ============="
  ].join("\n");
}

function buildCollectionImportOutput(): string {
  return [
    "114 errors during collection",
    "_ ERROR collecting tests/unit/test_auth.py _",
    "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
    "E   ModuleNotFoundError: No module named 'pydantic'",
    "_ ERROR collecting tests/unit/test_api.py _",
    "ImportError while importing test module '/tmp/tests/unit/test_api.py'.",
    "E   ModuleNotFoundError: No module named 'fastapi'",
    "_ ERROR collecting tests/unit/test_jobs.py _",
    "ImportError while importing test module '/tmp/tests/unit/test_jobs.py'.",
    "E   ModuleNotFoundError: No module named 'botocore'"
  ].join("\n");
}

function buildObservedAnchorOutput(): string {
  return [
    "1 error during collection",
    "_ ERROR collecting tests/contracts/test_db_schema_freeze.py _",
    "tests/conftest.py:374: in _postgres_schema_isolation",
    "    raise RuntimeError(\"DB-isolated tests require PGTEST_POSTGRES_DSN\")",
    "E   RuntimeError: DB-isolated tests require PGTEST_POSTGRES_DSN (or --pgtest-dsn). Refusing to fall back to DATABASE_URL to avoid polluting non-test users."
  ].join("\n");
}

function buildSingleFailureOutput(args: {
  status: "FAILED" | "ERROR";
  label: string;
  detail: string;
  summary?: string;
}): string {
  return [
    `${args.status} ${args.label} - ${args.detail}`,
    `============= ${args.summary ?? (args.status === "ERROR" ? "1 error" : "1 failed")} in 0.10s =============`
  ].join("\n");
}

function buildVitestAllPassedOutput(): string {
  return [
    " RUN  v2.1.0 /repo",
    "",
    " ✓ src/button.test.ts (2 tests) 12ms",
    " ✓ src/input.test.ts (1 test) 5ms",
    "",
    " Test Files  2 passed (2)",
    "      Tests  3 passed (3)",
    "   Start at  10:00:00",
    "   Duration  220ms"
  ].join("\n");
}

function buildVitestSnapshotFailureOutput(): string {
  return [
    " RUN  v2.1.0 /repo",
    "",
    " ❯ src/components/button.test.ts > Button > renders primary FAILED [ 50%]",
    "",
    "⎯⎯⎯ Failed Tests 1 ⎯⎯⎯",
    "",
    " FAIL  src/components/button.test.ts > Button > renders primary",
    "Error: Snapshot `Button > renders primary` mismatched",
    "❯ src/components/button.test.ts:42:19",
    "  40|   expect(rendered).toMatchSnapshot()",
    "",
    " Test Files  1 failed (1)",
    "      Tests  1 failed | 1 passed (2)",
    "  Snapshots  1 failed (1)"
  ].join("\n");
}

function buildVitestImportBlockerOutput(): string {
  return [
    " RUN  v2.1.0 /repo",
    "",
    "⎯⎯⎯ Failed Suites 1 ⎯⎯⎯",
    "",
    " FAIL  src/setup/auth.test.ts [ src/setup/auth.test.ts ]",
    "Error: Failed to resolve import \"@/missing-client\" from \"src/setup/auth.test.ts\". Does the file exist?",
    "❯ src/setup/auth.test.ts:1:1",
    "",
    " Test Files  1 failed (1)",
    "      Tests  no tests"
  ].join("\n");
}

function buildVitestMatcherAssertionOutput(): string {
  return [
    " RUN  v2.1.0 /repo",
    "",
    " ❯ src/auth/refresh.test.ts > refresh token > rotates token FAILED [ 50%]",
    " ❯ src/routes/landing.test.ts > landing page > renders hero FAILED [100%]",
    "",
    "⎯⎯⎯ Failed Tests 2 ⎯⎯⎯",
    "",
    " FAIL  src/auth/refresh.test.ts > refresh token > rotates token",
    "expect(received).toBe(expected)",
    "Expected: \"next-token\"",
    "Received: \"same-token\"",
    "❯ src/auth/refresh.test.ts:27:15",
    "",
    " FAIL  src/routes/landing.test.ts > landing page > renders hero",
    "expect(received).toEqual(expected)",
    "Expected: {\"cta\":\"Try now\"}",
    "Received: {\"cta\":\"Learn more\"}",
    "❯ src/routes/landing.test.ts:14:7",
    "",
    " Test Files  2 failed (2)",
    "      Tests  2 failed | 1 passed (3)"
  ].join("\n");
}

function buildPytestNetworkResetOutput(): string {
  return [
    "============================= test session starts ==============================",
    "platform darwin -- Python 3.11.4, pytest-9.0.2",
    "collecting ... collected 3 items",
    "tests/integration/test_stream.py::test_socket_flush ERROR [ 33%]",
    "tests/integration/test_feed.py::test_feed_sync ERROR [ 66%]",
    "tests/integration/test_api.py::test_remote_fallback ERROR [100%]",
    "",
    "==================================== ERRORS ====================================",
    "E   ConnectionResetError: [Errno 54] Connection reset by peer",
    "E   BrokenPipeError: [Errno 32] Broken pipe",
    "E   HTTPError: 502 Server Error: Bad Gateway for url: https://api.example.com/feed",
    "",
    "=========================== short test summary info ============================",
    "ERROR tests/integration/test_stream.py::test_socket_flush - ConnectionResetError: [Errno 54] Connection reset by peer",
    "ERROR tests/integration/test_feed.py::test_feed_sync - BrokenPipeError: [Errno 32] Broken pipe",
    "ERROR tests/integration/test_api.py::test_remote_fallback - HTTPError: 502 Server Error: Bad Gateway for url: https://api.example.com/feed",
    "============================== 3 errors in 0.14s =============================="
  ].join("\n");
}

function buildPytestOSErrorSetupOutput(): string {
  return [
    "============================= test session starts ==============================",
    "platform darwin -- Python 3.11.4, pytest-9.0.2",
    "collecting ... collected 2 items",
    "tests/storage/test_tmpdir.py::test_tmpdir_bootstrap ERROR [ 50%]",
    "tests/storage/test_lockfile.py::test_lockfile_cleanup ERROR [100%]",
    "",
    "==================================== ERRORS ====================================",
    "E   OSError: [Errno 28] No space left on device: '/tmp/pytest-scratch'",
    "E   OSError: [Errno 13] Permission denied: '/tmp/pytest-lock'",
    "",
    "=========================== short test summary info ============================",
    "ERROR tests/storage/test_tmpdir.py::test_tmpdir_bootstrap - OSError: [Errno 28] No space left on device: '/tmp/pytest-scratch'",
    "ERROR tests/storage/test_lockfile.py::test_lockfile_cleanup - OSError: [Errno 13] Permission denied: '/tmp/pytest-lock'",
    "============================== 2 errors in 0.11s =============================="
  ].join("\n");
}

function buildVitestWorkerCrashOutput(): string {
  return [
    " RUN  v2.1.0 /repo",
    "",
    "⎯⎯⎯ Failed Suites 1 ⎯⎯⎯",
    "",
    " FAIL  src/workers/render.test.ts [ src/workers/render.test.ts ]",
    "Error: Worker exited unexpectedly",
    "❯ src/workers/render.test.ts:3:1",
    "",
    " Test Files  1 failed (1)",
    "      Tests  no tests"
  ].join("\n");
}

function buildVitestMixedFailureOutput(): string {
  return [
    " RUN  v2.1.0 /repo",
    "",
    " ❯ src/components/button.test.ts > Button > renders primary FAILED [ 25%]",
    " ❯ src/hooks/timeout.test.ts > useSlowHook > resolves FAILED [ 50%]",
    " ❯ src/setup/auth.test.ts ERROR [ 75%]",
    "",
    "⎯⎯⎯ Failed Tests 2 ⎯⎯⎯",
    "",
    " FAIL  src/components/button.test.ts > Button > renders primary",
    "Error: Snapshot `Button > renders primary` mismatched",
    "❯ src/components/button.test.ts:42:19",
    "",
    " FAIL  src/hooks/timeout.test.ts > useSlowHook > resolves",
    "Error: Test timed out in 5000ms.",
    "❯ src/hooks/timeout.test.ts:21:9",
    "",
    "⎯⎯⎯ Failed Suites 1 ⎯⎯⎯",
    "",
    " FAIL  src/setup/auth.test.ts [ src/setup/auth.test.ts ]",
    "Error: Failed to resolve import \"@/missing-client\" from \"src/setup/auth.test.ts\". Does the file exist?",
    "❯ src/setup/auth.test.ts:1:1",
    "",
    " Test Files  2 failed | 1 passed (3)",
    "      Tests  2 failed | 1 passed (3)",
    "  Snapshots  1 failed (1)"
  ].join("\n");
}

function buildJestMixedFailureOutput(): string {
  return [
    "FAIL src/components/card.test.ts",
    "  ✕ renders the card",
    "",
    "  ● renders the card",
    "",
    "    Error: Snapshot `renders the card` mismatched",
    "    at Object.<anonymous> (src/components/card.test.ts:12:7)",
    "",
    "FAIL src/config/setup.test.ts",
    "  ● Test suite failed to run",
    "",
    "    Cannot use import statement outside a module",
    "",
    "Test Suites: 2 failed, 1 passed, 3 total",
    "Tests:       1 failed, 2 passed, 3 total"
  ].join("\n");
}

function buildContractVsSnapshotOutput(): string {
  return [
    " RUN  v2.1.0 /repo",
    "",
    " ❯ tests/contracts/task_matrix_snapshot_freeze.test.ts > task matrix > is frozen FAILED [ 50%]",
    " ❯ src/components/button.test.ts > Button > renders primary FAILED [100%]",
    "",
    "python scripts/update_contract_snapshots.py",
    "  -             'openai-gpt-image-1.5',",
    "",
    "⎯⎯⎯ Failed Tests 2 ⎯⎯⎯",
    "",
    " FAIL  tests/contracts/task_matrix_snapshot_freeze.test.ts > task matrix > is frozen",
    "AssertionError: expected task matrix to stay frozen",
    "",
    " FAIL  src/components/button.test.ts > Button > renders primary",
    "Error: Snapshot `Button > renders primary` mismatched",
    "",
    " Test Files  2 failed (2)",
    "      Tests  2 failed (2)",
    "  Snapshots  1 failed (1)"
  ].join("\n");
}

function buildTscStandardErrors(): string {
  return [
    "src/components/UserCard.tsx(12,3): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/components/UserCard.tsx(18,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/types/user.ts(4,5): error TS2741: Property 'id' is missing in type '{ name: string; }' but required in type 'User'.",
    "Found 3 errors in 2 files."
  ].join("\n");
}

function buildTscPrettyErrors(): string {
  return [
    "src/components/UserCard.tsx:12:3 - error TS2322: Type 'string' is not assignable to type 'number'.",
    "",
    "12   const age: number = name;",
    "     ~~~~~~~~~~~~~~~~~~~~~~~~",
    "",
    "src/types/user.ts:4:5 - error TS2741: Property 'id' is missing in type '{ name: string; }' but required in type 'User'.",
    "",
    "4    id: string;",
    "     ~~",
    "",
    "Found 2 errors in 2 files."
  ].join("\n");
}

function buildTscSingleError(): string {
  return [
    "src/app.ts(1,1): error TS2304: Cannot find name 'missingValue'.",
    "Found 1 error."
  ].join("\n");
}

function buildTscManyGroupedErrors(): string {
  return [
    "src/components/UserCard.tsx(12,3): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/components/UserCard.tsx(18,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/routes/api.ts(2,4): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/forms/user.ts(9,1): error TS2741: Property 'id' is missing.",
    "src/forms/admin.ts(10,1): error TS2741: Property 'role' is missing.",
    "src/utils/assert.ts(3,9): error TS2304: Cannot find name 'expectType'.",
    "src/utils/env.ts(6,2): error TS2304: Cannot find name 'processEnv'.",
    "error TS5083: Cannot read file '/Users/bilalimamoglu/repos/sift/tsconfig.base.json'.",
    "Found 8 errors in 6 files."
  ].join("\n");
}

function buildTscTopLevelConfigError(): string {
  return [
    "error TS5083: Cannot read file '/Users/bilalimamoglu/repos/sift/tsconfig.json'.",
    "Found 1 error."
  ].join("\n");
}

function buildTscTruncatedErrors(): string {
  return [
    "src/components/UserCard.tsx:12:3 - error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/components/UserCard.tsx:18:7 - error TS2322: Type 'string' is not assignable to type 'number'."
  ].join("\n");
}

function buildTscZeroErrors(): string {
  return "Found 0 errors.";
}

function buildEslintStylishErrors(): string {
  return [
    "src/app.ts",
    "  1:12  error    Unexpected any                     @typescript-eslint/no-explicit-any",
    "  5:1   warning  Unexpected console statement      no-console",
    "",
    "src/routes/api.ts",
    "  4:10  error  Unexpected any  @typescript-eslint/no-explicit-any",
    "",
    "\u2716 3 problems (2 errors, 1 warning)",
    "  1 error and 1 warning are potentially fixable with the `--fix` option."
  ].join("\n");
}

function buildEslintErrorsOnly(): string {
  return [
    "src/app.ts",
    "  1:12  error  Unexpected any  @typescript-eslint/no-explicit-any",
    "",
    "src/routes/api.ts",
    "  4:10  error  Unexpected any  @typescript-eslint/no-explicit-any",
    "",
    "\u2716 2 problems (2 errors, 0 warnings)"
  ].join("\n");
}

function buildEslintWarningsOnly(): string {
  return [
    "src/app.ts",
    "  5:1  warning  Unexpected console statement  no-console",
    "src/routes/api.ts",
    "  7:3  warning  Unexpected console statement  no-console",
    "",
    "\u2716 2 problems (0 errors, 2 warnings)"
  ].join("\n");
}

function buildEslintParsingError(): string {
  return [
    "src/app.ts",
    "  1:1  error  Parsing error: Unexpected token",
    "",
    "\u2716 1 problem (1 error, 0 warnings)"
  ].join("\n");
}

function buildEslintManyRulesOutput(): string {
  return [
    "src/app.ts",
    "  1:12  error    Unexpected any                     @typescript-eslint/no-explicit-any",
    "  2:1   error    Missing return type                @typescript-eslint/explicit-function-return-type",
    "  3:1   warning  Unexpected console statement       no-console",
    "",
    "src/routes/api.ts",
    "  4:10  error  Unexpected any  @typescript-eslint/no-explicit-any",
    "  6:4   error  Missing return type  @typescript-eslint/explicit-function-return-type",
    "  8:2   warning  Strings must use singlequote  quotes",
    "",
    "src/components/card.tsx",
    "  3:1  warning  Prop spreading is forbidden  react/jsx-props-no-spreading",
    "",
    "\u2716 7 problems (4 errors, 3 warnings)"
  ].join("\n");
}

function buildEslintZeroProblems(): string {
  return "\u2716 0 problems (0 errors, 0 warnings)";
}

const directClassificationCases = [
  {
    name: "timeout",
    line: "Failed: Timeout >5.0s",
    prefix: "timeout:"
  },
  {
    name: "permission denied",
    line: "PermissionError: [Errno 13] Permission denied: '/tmp/socket'",
    prefix: "permission:"
  },
  {
    name: "async event loop",
    line: "RuntimeError: Event loop is closed",
    prefix: "async loop:"
  },
  {
    name: "fixture teardown",
    line: "ERROR at teardown of fixture_cache",
    prefix: "fixture teardown:"
  },
  {
    name: "db migration",
    line: "psycopg.errors.UndefinedTable: relation \"users\" does not exist",
    prefix: "db migration:"
  },
  {
    name: "configuration",
    line: "INTERNALERROR> pluggy._manager.PluginValidationError: bad config",
    prefix: "configuration:"
  },
  {
    name: "xdist worker crash",
    line: "worker 'gw0' crashed while running tests",
    prefix: "xdist worker crash:"
  },
  {
    name: "type error",
    line: "TypeError: unsupported operand type(s) for +: 'int' and 'NoneType'",
    prefix: "type error:"
  },
  {
    name: "resource leak",
    line: "ResourceWarning: unclosed socket <socket.socket fd=12>",
    prefix: "resource leak:"
  },
  {
    name: "django db access",
    line: "Database access not allowed, use the \"django_db\" mark",
    prefix: "django db access:"
  },
  {
    name: "network",
    line: "requests.exceptions.ConnectionError: Max retries exceeded with url: https://api.example.com",
    prefix: "network:"
  },
  {
    name: "segfault",
    line: "Segmentation fault",
    prefix: "segfault:"
  },
  {
    name: "flaky",
    line: "RERUN 1 time because the test was flaky",
    prefix: "flaky:"
  },
  {
    name: "serialization",
    line: "JSONDecodeError: Expecting value: line 1 column 1 (char 0)",
    prefix: "serialization:"
  },
  {
    name: "file not found",
    line: "FileNotFoundError: [Errno 2] No such file or directory: '/tmp/data.json'",
    prefix: "file not found:"
  },
  {
    name: "memory",
    line: "MemoryError: unable to allocate 2.0 GiB",
    prefix: "memory:"
  },
  {
    name: "deprecation as error",
    line: "DeprecationWarning: old_api() is deprecated",
    prefix: "deprecation as error:"
  },
  {
    name: "strict xfail",
    line: "XPASS(strict) test started passing unexpectedly",
    prefix: "xfail strict:"
  },
  {
    name: "snapshot mismatch",
    line: "Error: Snapshot `Button > renders primary` mismatched",
    prefix: "snapshot mismatch:"
  },
  {
    name: "vitest timeout",
    line: "Error: Test timed out in 5000ms.",
    prefix: "timeout:"
  },
  {
    name: "resolve import",
    line: "Error: Failed to resolve import \"@/missing-client\" from \"src/setup/auth.test.ts\". Does the file exist?",
    prefix: "missing module:"
  },
  {
    name: "err module not found",
    line: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'undici' imported from /repo/src/client.ts",
    prefix: "missing module:"
  },
  {
    name: "esm commonjs mismatch",
    line: "Named export 'render' not found. The requested module '@testing-library/react' is a CommonJS module",
    prefix: "configuration:"
  },
  {
    name: "worker exited unexpectedly",
    line: "Error: Worker exited unexpectedly",
    prefix: "xdist worker crash:"
  },
  {
    name: "worker memory limit",
    line: "Worker terminated due to reaching memory limit",
    prefix: "memory:"
  },
  {
    name: "vitest unhandled",
    line: "Vitest caught 1 unhandled error during the test run.",
    prefix: "RuntimeError:"
  },
  {
    name: "localStorage unavailable",
    line: "localStorage is not available for opaque origins",
    prefix: "configuration:"
  },
  {
    name: "failed to load config",
    line: "failed to load config from /repo/vitest.config.ts",
    prefix: "configuration:"
  }
] as const;

const pipelineClassificationCases = [
  {
    name: "timeout",
    input: buildSingleFailureOutput({
      status: "FAILED",
      label: "tests/async/test_timeout.py::test_slow",
      detail: "Failed: Timeout >5.0s"
    }),
    label: "timeout",
    prefix: "timeout:"
  },
  {
    name: "permission denied",
    input: buildSingleFailureOutput({
      status: "ERROR",
      label: "tests/fs/test_permissions.py::test_write",
      detail: "PermissionError: [Errno 13] Permission denied: '/tmp/output.txt'"
    }),
    label: "permission denied",
    prefix: "permission:"
  },
  {
    name: "async event loop",
    input: buildSingleFailureOutput({
      status: "ERROR",
      label: "tests/async/test_loop.py::test_closed_loop",
      detail: "RuntimeError: Event loop is closed"
    }),
    label: "async event loop",
    prefix: "async loop:"
  },
  {
    name: "fixture teardown",
    input: buildSingleFailureOutput({
      status: "ERROR",
      label: "tests/fixtures/test_cleanup.py::test_tempdir",
      detail: "ERROR at teardown of fixture_cache"
    }),
    label: "fixture teardown",
    prefix: "fixture teardown:"
  },
  {
    name: "db migration",
    input: buildSingleFailureOutput({
      status: "ERROR",
      label: "tests/db/test_users.py::test_query",
      detail: "psycopg.errors.UndefinedTable: relation \"users\" does not exist"
    }),
    label: "db migration",
    prefix: "db migration:"
  },
  {
    name: "configuration",
    input: [
      "collecting ... collected 0 items / 1 error",
      "INTERNALERROR> pluggy._manager.PluginValidationError: bad config",
      "============= 1 error in 0.01s ============="
    ].join("\n"),
    label: "configuration error",
    prefix: "configuration:"
  },
  {
    name: "xdist worker crash",
    input: buildSingleFailureOutput({
      status: "ERROR",
      label: "tests/parallel/test_jobs.py::test_worker_state",
      detail: "worker 'gw0' crashed while running tests"
    }),
    label: "xdist worker crash",
    prefix: "xdist worker crash:"
  },
  {
    name: "type error",
    input: buildSingleFailureOutput({
      status: "FAILED",
      label: "tests/unit/test_types.py::test_coerce",
      detail: "TypeError: unsupported operand type(s) for +: 'int' and 'NoneType'"
    }),
    label: "type error",
    prefix: "type error:"
  },
  {
    name: "resource leak",
    input: buildSingleFailureOutput({
      status: "ERROR",
      label: "tests/io/test_streams.py::test_reader",
      detail: "ResourceWarning: unclosed file <_io.TextIOWrapper name='/tmp/data.txt'>"
    }),
    label: "resource leak",
    prefix: "resource leak:"
  },
  {
    name: "django db access",
    input: buildSingleFailureOutput({
      status: "ERROR",
      label: "tests/django/test_models.py::test_insert",
      detail: "Database access not allowed, use the \"django_db\" mark"
    }),
    label: "django db access",
    prefix: "django db access:"
  },
  {
    name: "network",
    input: buildSingleFailureOutput({
      status: "ERROR",
      label: "tests/http/test_client.py::test_fetch",
      detail: "requests.exceptions.ConnectionError: Max retries exceeded with url: https://api.example.com"
    }),
    label: "network failure",
    prefix: "network:"
  },
  {
    name: "segfault",
    input: buildSingleFailureOutput({
      status: "ERROR",
      label: "tests/native/test_extension.py::test_render",
      detail: "Segmentation fault"
    }),
    label: "segfault",
    prefix: "segfault:"
  },
  {
    name: "flaky",
    input: buildSingleFailureOutput({
      status: "FAILED",
      label: "tests/flaky/test_retry.py::test_eventual_consistency",
      detail: "RERUN 1 time because the test was flaky"
    }),
    label: "flaky test",
    prefix: "flaky:"
  },
  {
    name: "serialization",
    input: buildSingleFailureOutput({
      status: "FAILED",
      label: "tests/json/test_decode.py::test_invalid_payload",
      detail: "JSONDecodeError: Expecting value: line 1 column 1 (char 0)"
    }),
    label: "serialization or encoding",
    prefix: "serialization:"
  },
  {
    name: "file not found",
    input: buildSingleFailureOutput({
      status: "FAILED",
      label: "tests/fs/test_loader.py::test_fixture_file",
      detail: "FileNotFoundError: [Errno 2] No such file or directory: '/tmp/data.json'"
    }),
    label: "file not found",
    prefix: "file not found:"
  },
  {
    name: "memory",
    input: buildSingleFailureOutput({
      status: "ERROR",
      label: "tests/perf/test_memory.py::test_large_alloc",
      detail: "MemoryError: unable to allocate 2.0 GiB"
    }),
    label: "memory error",
    prefix: "memory:"
  },
  {
    name: "deprecation as error",
    input: buildSingleFailureOutput({
      status: "FAILED",
      label: "tests/warnings/test_deprecations.py::test_old_api",
      detail: "DeprecationWarning: old_api() is deprecated"
    }),
    label: "deprecation as error",
    prefix: "deprecation as error:"
  },
  {
    name: "strict xfail",
    input: buildSingleFailureOutput({
      status: "FAILED",
      label: "tests/xfail/test_status.py::test_known_bug",
      detail: "XPASS(strict) test started passing unexpectedly"
    }),
    label: "strict xfail unexpected pass",
    prefix: "xfail strict:"
  },
  {
    name: "vitest snapshot mismatch",
    input: buildVitestSnapshotFailureOutput(),
    label: "snapshot mismatch",
    prefix: "snapshot mismatch:"
  },
  {
    name: "vitest import blocker",
    input: buildVitestImportBlockerOutput(),
    label: "import dependency failure",
    prefix: "missing module:"
  },
  {
    name: "vitest worker crash",
    input: buildVitestWorkerCrashOutput(),
    label: "xdist worker crash",
    prefix: "xdist worker crash:"
  },
  {
    name: "jest snapshot mismatch",
    input: buildJestMixedFailureOutput(),
    label: "configuration error",
    prefix: "configuration:"
  }
] as const;

describe("heuristic policies", () => {
  it("returns null when no policy is active", () => {
    expect(applyHeuristicPolicy(undefined, "anything")).toBeNull();
  });

  it("keeps simple success and no-test summaries short", () => {
    expect(applyHeuristicPolicy("test-status", "12 passed, 0 failed, 2 skipped")).toBe(
      "- Tests passed.\n- 12 tests, 2 skips."
    );

    expect(
      applyHeuristicPolicy(
        "test-status",
        "collected 0 items\n\n============================ no tests ran in 0.01s ============================"
      )
    ).toBe("- Tests did not run.\n- Collected 0 items.");
  });

  it("renders a decision-complete standard summary for mixed blockers and drift", () => {
    const output = applyHeuristicPolicy("test-status", buildMixedFailureOutput());

    expect(output).toContain("- Tests did not pass.");
    expect(output).toContain("- 3 tests failed. 124 errors occurred.");
    expect(output).toContain("Shared blocker: 124 errors require PGTEST_POSTGRES_DSN");
    expect(output).toContain(
      "Anchor: search PGTEST_POSTGRES_DSN in tests/contracts/test_db_schema_freeze.py"
    );
    expect(output).toContain(
      "Fix: Set PGTEST_POSTGRES_DSN (or pass --pgtest-dsn) before rerunning DB-isolated tests."
    );
    expect(output).toContain("Contract drift: 3 freeze tests are out of sync");
    expect(output).toContain(
      "Anchor: search /api/v1/admin/landing-gallery in tests/contracts/test_feature_manifest_freeze.py"
    );
    expect(output).toContain(
      "Fix: If these changes are intentional, run python scripts/update_contract_snapshots.py and rerun the freeze tests."
    );
    expect(output).toContain("Next: Fix bucket 1 first, then rerun the full suite at standard.");
    expect(output).toContain(
      "Next: Fix bucket 1 first, then rerun the full suite at standard. Secondary buckets are already visible behind it."
    );
    expect(output).toContain("Stop signal: diagnosis complete; raw not needed.");
  });

  it("keeps focused and verbose output monotonic while adding evidence depth", () => {
    const focused = applyHeuristicPolicy("test-status", buildMixedFailureOutput(), "focused");
    const verbose = applyHeuristicPolicy("test-status", buildMixedFailureOutput(), "verbose");

    expect(focused).not.toBeNull();
    expect(verbose).not.toBeNull();

    if (focused === null || verbose === null) {
      throw new Error("Expected focused and verbose summaries");
    }

    expect(focused).toContain("Shared blocker: 124 errors require PGTEST_POSTGRES_DSN");
    expect(focused).toContain(
      "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen -> missing test env: PGTEST_POSTGRES_DSN"
    );
    expect(focused.indexOf("Shared blocker:")).toBeLessThan(
      focused.indexOf("Contract drift:")
    );

    expect(verbose).toContain("Shared blocker: 124 errors require PGTEST_POSTGRES_DSN");
    expect(verbose).toContain(
      "tests/contracts/test_task_matrix_snapshot_freeze.py::test_task_matrix_snapshot_is_frozen -> removed model: openai-gpt-image-1.5"
    );
    expect(verbose).toContain('mini-diff: {"removed_models":1}');
    expect(verbose.indexOf("Shared blocker:")).toBeLessThan(
      verbose.indexOf("Contract drift:")
    );
  });

  it("keeps collection-time import blockers grouped and actionable", () => {
    const output = applyHeuristicPolicy("test-status", buildCollectionImportOutput(), "focused");

    expect(output).toContain("- Tests did not complete.");
    expect(output).toContain("- 114 errors occurred during collection.");
    expect(output).toContain(
      "Import/dependency blocker: 114 errors are caused by missing dependencies during test collection."
    );
    expect(output).toContain("Missing modules include pydantic, fastapi, botocore.");
    expect(output).toContain("tests/unit/test_auth.py -> missing module: pydantic");
  });

  it("classifies service, db, fixture, and auth setup failures into first-class buckets", () => {
    const input = [
      "ERROR tests/api/test_health.py::test_ready - 503 Service Unavailable",
      "ERROR tests/db/test_users.py::test_refresh - ConnectionRefusedError: could not connect to server on port 5432",
      "ERROR tests/auth/test_session.py::test_impersonation - auth bypass missing for integration tests",
      "ERROR tests/fixtures/test_bootstrap.py::test_env - FixtureLookupError: capsys fixture not available",
      "============= 4 errors in 0.40s ============="
    ].join("\n");

    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    expect(decision.contract.main_buckets.map((bucket) => bucket.root_cause)).toEqual(
      expect.arrayContaining([
        "auth bypass absent: test auth bypass is missing",
        "db refused: database connection was refused",
        "service unavailable: dependency service is unavailable"
      ])
    );
    expect(analysis.inlineItems.map((item) => item.reason)).toContain("fixture guard: capsys");

    const serviceOnlyInput = [
      "ERROR tests/api/test_health.py::test_ready - 503 Service Unavailable",
      "============= 1 error in 0.10s ============="
    ].join("\n");
    const serviceOnlyDecision = buildTestStatusDiagnoseContract({
      input: serviceOnlyInput,
      analysis: analyzeTestStatus(serviceOnlyInput)
    });
    expect(serviceOnlyDecision.contract.main_buckets[0]?.root_cause).toBe(
      "service unavailable: dependency service is unavailable"
    );
  });

  for (const testCase of directClassificationCases) {
    it(`classifies ${testCase.name} via direct helper`, () => {
      const classification = classifyFailureReasonForTest(testCase.line);
      expect(classification?.reason).toMatch(new RegExp(`^${testCase.prefix}`));
    });
  }

  for (const testCase of pipelineClassificationCases) {
    it(`classifies ${testCase.name} through the diagnose pipeline`, () => {
      const analysis = analyzeTestStatus(testCase.input);
      const decision = buildTestStatusDiagnoseContract({
        input: testCase.input,
        analysis
      });

      expect(decision.contract.main_buckets[0]).toMatchObject({
        label: testCase.label
      });
      expect(decision.contract.main_buckets[0]?.root_cause).toMatch(
        new RegExp(`^${testCase.prefix}`)
      );
    });
  }

  it("renders bucket-specific titles for new runtime families in standard output", () => {
    const timeoutOutput = applyHeuristicPolicy(
      "test-status",
      buildSingleFailureOutput({
        status: "FAILED",
        label: "tests/async/test_timeout.py::test_slow",
        detail: "Failed: Timeout >5.0s"
      })
    );
    const networkOutput = applyHeuristicPolicy(
      "test-status",
      buildSingleFailureOutput({
        status: "ERROR",
        label: "tests/http/test_client.py::test_fetch",
        detail: "requests.exceptions.ConnectionError: Max retries exceeded with url: https://api.example.com"
      })
    );

    expect(timeoutOutput).toContain(
      "Timeout failures: 1 test exceeded the configured timeout threshold."
    );
    expect(networkOutput).toContain("Network failures: 1 visible failure share network:");
  });

  it("keeps tier 1 bucket ordering from stealing existing env and service buckets", () => {
    const input = [
      "ERROR tests/env/test_bootstrap.py::test_env - KeyError: 'REDIS_URL'",
      "FAILED tests/async/test_timeout.py::test_slow - Failed: Timeout >5.0s",
      "ERROR tests/http/test_health.py::test_ready - 503 Service Unavailable",
      "============= 1 failed, 2 errors in 0.10s ============="
    ].join("\n");

    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis: analyzeTestStatus(input)
    });

    expect(decision.contract.main_buckets.map((bucket) => bucket.root_cause)).toEqual(
      expect.arrayContaining([
        "missing test env: REDIS_URL",
        expect.stringMatching(/^timeout:/),
        "service unavailable: dependency service is unavailable"
      ])
    );
  });

  it("keeps tier 2 bucket ordering from stealing import and fixture buckets", () => {
    const input = [
      "ERROR tests/network/test_client.py::test_fetch - requests.exceptions.ConnectionError: Max retries exceeded with url: https://api.example.com",
      "ERROR tests/django/test_models.py::test_insert - Database access not allowed, use the \"django_db\" mark",
      "ERROR tests/fixtures/test_bootstrap.py::test_env - FixtureLookupError: capsys fixture not available",
      "============= 3 errors in 0.10s ============="
    ].join("\n");

    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis: analyzeTestStatus(input)
    });

    expect(decision.contract.main_buckets.map((bucket) => bucket.root_cause)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^network:/),
        "django db access: Database access not allowed, use the \"django_db\" mark",
        "fixture guard: capsys"
      ])
    );
  });

  it("keeps tier 3 bucket ordering from stealing assertion buckets", () => {
    const input = [
      "FAILED tests/fs/test_loader.py::test_fixture_file - FileNotFoundError: [Errno 2] No such file or directory: '/tmp/data.json'",
      "FAILED tests/xfail/test_status.py::test_known_bug - XPASS(strict) test started passing unexpectedly",
      "FAILED tests/core/test_response.py::test_response - AssertionError: expected 200 to equal 201",
      "============= 3 failed in 0.10s ============="
    ].join("\n");

    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis: analyzeTestStatus(input)
    });

    expect(decision.contract.main_buckets.map((bucket) => bucket.root_cause)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^file not found:/),
        expect.stringMatching(/^xfail strict:/),
        "assertion failed: expected 200 to equal 201"
      ])
    );
  });

  it("detects generic env blockers beyond repo-specific literals", () => {
    const input = [
      "ERROR tests/cache/test_bootstrap.py::test_cache - KeyError: 'REDIS_URL'",
      "ERROR tests/api/test_auth.py::test_login - ValidationError: MISSING_API_KEY is not set",
      "============= 2 errors in 0.10s ============="
    ].join("\n");

    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis: analyzeTestStatus(input)
    });

    expect(decision.contract.main_buckets.map((bucket) => bucket.root_cause)).toEqual(
      expect.arrayContaining(["missing test env: REDIS_URL", "missing test env: MISSING_API_KEY"])
    );
  });

  it("adds conservative unknown buckets when visible counts are not fully explained", () => {
    const input = [
      "src/auth.test.ts > refresh token ERROR [ 20%]",
      "src/routes.test.ts > landing page FAILED [ 40%]",
      "src/tasks.test.ts > task payload FAILED [ 60%]",
      "============= 2 failed, 3 errors in 0.10s ============="
    ].join("\n");

    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis: analyzeTestStatus(input)
    });

    expect(decision.contract.diagnosis_complete).toBe(false);
    expect(decision.contract.decision).toBe("zoom");
    expect(decision.contract.main_buckets.map((bucket) => bucket.label)).toEqual(
      expect.arrayContaining(["unknown setup blocker", "unknown failure family"])
    );
  });

  it("maps setup override failures into configuration errors without changing generic type-error behavior", () => {
    expect(
      classifyFailureReasonForTest(
        "AttributeError: property 'scene_references_dir' of 'Settings' object has no setter"
      )
    ).toMatchObject({
      reason: expect.stringMatching(/^configuration: invalid test setup override/),
      group: "test configuration failures"
    });

    expect(
      classifyFailureReasonForTest(
        "TypeError: monkeypatch settings override failed for preview_dir"
      )
    ).toMatchObject({
      reason: expect.stringMatching(/^configuration: invalid test setup override/),
      group: "test configuration failures"
    });

    expect(classifyFailureReasonForTest("TypeError: refresh token payload is undefined")).toMatchObject(
      {
        reason: "type error: refresh token payload is undefined",
        group: "type errors"
      }
    );
  });

  it("classifies property-setter setup failures as configuration errors", () => {
    const input = [
      "============================= test session starts ==============================",
      "collecting ... collected 2 items",
      "tests/unit/services/test_scene_reference_preview.py::test_generate_scene_reference_preview_returns_relative_url_in_local_mode ERROR [ 50%]",
      "tests/unit/services/test_scene_reference_preview.py::test_generate_scene_reference_preview_uses_preview_dir ERROR [100%]",
      "E   AttributeError: property 'scene_references_dir' of 'Settings' object has no setter",
      "E   AttributeError: property 'scene_references_dir' of 'Settings' object has no setter",
      "============================== 2 errors in 0.12s =============================="
    ].join("\n");

    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    expect(analysis.buckets.map((bucket) => bucket.type)).toContain("configuration_error");
    expect(decision.contract.main_buckets[0]).toMatchObject({
      label: "configuration error"
    });
    expect(decision.contract.main_buckets[0]?.root_cause).toMatch(
      /^configuration: invalid test setup override/
    );
  });

  it("shows the first concrete signal for unknown buckets in every text detail", () => {
    const input = [
      "src/auth.test.ts > refresh token ERROR [ 20%]",
      "E   custom setup override exploded in helper layer",
      "src/routes.test.ts > landing page FAILED [ 40%]",
      "src/tasks.test.ts > task payload FAILED [ 60%]",
      "============= 2 failed, 3 errors in 0.10s ============="
    ].join("\n");

    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis: analyzeTestStatus(input)
    });

    expect(decision.standardText).toContain(
      "First concrete signal: custom setup override exploded in helper layer"
    );
    expect(decision.focusedText).toContain(
      "First concrete signal: custom setup override exploded in helper layer"
    );
    expect(decision.verboseText).toContain(
      "First concrete signal: custom setup override exploded in helper layer"
    );
  });

  it("surfaces failed-item anchors when unknown failed buckets have a concrete inline reason", () => {
    const input = [
      "tests/unit/test_routes.py::test_landing_page FAILED [ 50%]",
      "tests/unit/test_tasks.py::test_task_payload FAILED [100%]",
      "FAILED tests/unit/test_routes.py::test_landing_page - custom matcher exploded for hero CTA",
      "============= 2 failed in 0.10s ============="
    ].join("\n");

    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis: analyzeTestStatus(input)
    });

    expect(decision.standardText).toContain(
      "First concrete signal: custom matcher exploded for hero CTA"
    );
  });

  it("classifies matcher assertions, network resets, and setup oserrors into actionable buckets", () => {
    expect(
      classifyFailureReasonForTest("expect(received).toStrictEqual(expected)")
    ).toMatchObject({
      reason: "assertion failed: expect(received).toStrictEqual(expected)",
      group: "assertion failures"
    });

    expect(
      classifyFailureReasonForTest("OSError: [Errno 28] No space left on device: '/tmp/pytest-scratch'")
    ).toMatchObject({
      reason: expect.stringMatching(/^configuration: disk full \(/),
      group: "test configuration failures"
    });

    expect(
      classifyFailureReasonForTest("OSError: [Errno 13] Permission denied: '/tmp/pytest-lock'")
    ).toMatchObject({
      reason: expect.stringMatching(/^permission:/),
      group: "permission or locked resource failures"
    });

    expect(
      classifyFailureReasonForTest(
        "HTTPError: 502 Server Error: Bad Gateway for url: https://api.example.com/feed"
      )
    ).toMatchObject({
      reason: expect.stringMatching(/^network:/),
      group: "network dependency failures"
    });
  });

  it("groups matcher assertions and network resets into deterministic buckets", () => {
    const matcherDecision = buildTestStatusDiagnoseContract({
      input: buildVitestMatcherAssertionOutput(),
      analysis: analyzeTestStatus(buildVitestMatcherAssertionOutput())
    });
    const networkDecision = buildTestStatusDiagnoseContract({
      input: buildPytestNetworkResetOutput(),
      analysis: analyzeTestStatus(buildPytestNetworkResetOutput())
    });
    const osErrorDecision = buildTestStatusDiagnoseContract({
      input: buildPytestOSErrorSetupOutput(),
      analysis: analyzeTestStatus(buildPytestOSErrorSetupOutput())
    });

    expect(matcherDecision.contract.main_buckets[0]).toMatchObject({
      label: "assertion failure"
    });
    expect(matcherDecision.contract.main_buckets[0]?.root_cause).toMatch(/^assertion failed:/);

    expect(networkDecision.contract.main_buckets[0]).toMatchObject({
      label: "network failure"
    });
    expect(networkDecision.contract.main_buckets[0]?.root_cause).toMatch(/^network:/);

    expect(osErrorDecision.contract.main_buckets.map((bucket) => bucket.label)).toEqual(
      expect.arrayContaining(["configuration error", "permission denied"])
    );
  });

  it("treats small low-confidence concrete suites as complete once the bucket is anchored", () => {
    const input = [
      "FAILED tests/unit/test_payloads.py::test_payload_round_trip",
      "============================== 1 failed in 0.10s =============================="
    ].join("\n");

    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis: analyzeTestStatus(input),
      providerBucketSupplements: [
        {
          label: "runtime failure",
          count: 1,
          root_cause: "RuntimeError: payload subject missing",
          anchor: {
            file: "tests/unit/test_payloads.py",
            line: 48,
            search_hint: "payload subject missing"
          },
          fix_hint: null,
          confidence: 0.55
        }
      ]
    });

    expect(decision.contract.diagnosis_complete).toBe(true);
    expect(decision.contract.decision).toBe("read_source");
    expect(decision.contract.next_best_action.code).toBe("read_source_for_bucket");
  });

  it("detects vitest and jest runners through analyzeTestStatus", () => {
    expect(analyzeTestStatus(buildMixedFailureOutput()).runner).toBe("pytest");
    expect(analyzeTestStatus(buildVitestAllPassedOutput()).runner).toBe("vitest");
    expect(analyzeTestStatus(buildJestMixedFailureOutput()).runner).toBe("jest");
    expect(analyzeTestStatus("plain failure text without a runner footer").runner).toBe("unknown");
  });

  it("parses vitest and jest summary counts", () => {
    const vitest = analyzeTestStatus(buildVitestSnapshotFailureOutput());
    const jest = analyzeTestStatus(buildJestMixedFailureOutput());

    expect(vitest).toMatchObject({
      failed: 1,
      passed: 1,
      snapshotFailures: 1
    });
    expect(jest).toMatchObject({
      failed: 1,
      passed: 2
    });
  });

  it("extracts vitest anchors and snapshot mismatch buckets", () => {
    const input = buildVitestSnapshotFailureOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    expect(analysis.inlineItems[0]).toMatchObject({
      label: "src/components/button.test.ts > Button > renders primary",
      file: "src/components/button.test.ts",
      line: 42,
      anchor_kind: "traceback"
    });
    expect(analysis.buckets[0]?.type).toBe("snapshot_mismatch");
    expect(decision.contract.main_buckets[0]).toMatchObject({
      label: "snapshot mismatch"
    });
    expect(decision.standardText).toContain(
      "Update the snapshots if these output changes are intentional."
    );
  });

  it("creates a dedicated vitest import blocker bucket", () => {
    const input = buildVitestImportBlockerOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    expect(analysis.buckets.map((bucket) => bucket.type)).toContain("import_dependency_failure");
    expect(decision.contract.main_buckets[0]).toMatchObject({
      label: "import dependency failure"
    });
    expect(decision.contract.main_buckets[0]?.root_cause).toMatch(/^missing module:/);
  });

  it("parses mixed vitest failures into multiple buckets", () => {
    const input = buildVitestMixedFailureOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    expect(analysis.visibleFailedLabels).toEqual(
      expect.arrayContaining([
        "src/components/button.test.ts > Button > renders primary",
        "src/hooks/timeout.test.ts > useSlowHook > resolves"
      ])
    );
    expect(analysis.visibleErrorLabels).toContain("src/setup/auth.test.ts");
    expect(analysis.buckets.map((bucket) => bucket.type)).toEqual(
      expect.arrayContaining(["import_dependency_failure", "snapshot_mismatch", "timeout_failure"])
    );
    expect(decision.contract.main_buckets.map((bucket) => bucket.label)).toEqual(
      expect.arrayContaining(["import dependency failure", "snapshot mismatch", "timeout"])
    );
  });

  it("keeps generic snapshot mismatches out of contract drift buckets", () => {
    const input = buildContractVsSnapshotOutput();
    const analysis = analyzeTestStatus(input);

    expect(analysis.buckets.map((bucket) => bucket.type)).toEqual(
      expect.arrayContaining(["contract_snapshot_drift", "snapshot_mismatch"])
    );

    const contractBucket = analysis.buckets.find((bucket) => bucket.type === "contract_snapshot_drift");
    const snapshotBucket = analysis.buckets.find((bucket) => bucket.type === "snapshot_mismatch");

    expect(contractBucket?.representativeItems.map((item) => item.label)).toEqual(
      expect.arrayContaining(["tests/contracts/task_matrix_snapshot_freeze.test.ts > task matrix > is frozen"])
    );
    expect(snapshotBucket?.representativeItems.map((item) => item.label)).toEqual(
      expect.arrayContaining(["src/components/button.test.ts > Button > renders primary"])
    );
    expect(contractBucket?.representativeItems.map((item) => item.label)).not.toContain(
      "src/components/button.test.ts > Button > renders primary"
    );
  });

  it("parses mixed jest failures into configuration and snapshot buckets", () => {
    const input = buildJestMixedFailureOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    expect(analysis.buckets.map((bucket) => bucket.type)).toEqual(
      expect.arrayContaining(["configuration_error", "snapshot_mismatch"])
    );
    expect(decision.contract.main_buckets.map((bucket) => bucket.label)).toEqual(
      expect.arrayContaining(["configuration error", "snapshot mismatch"])
    );
  });

  it("builds a structured diagnose contract with dominant blocker and remaining tests", () => {
    const input = buildMixedFailureOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis,
      resolvedTests: ["tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen"],
      remainingTests: [
        "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen",
        "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen"
      ]
    });

    expect(decision.contract.diagnosis_complete).toBe(true);
    expect(decision.contract.raw_needed).toBe(false);
    expect(decision.contract.dominant_blocker_bucket_index).toBe(1);
    expect(decision.contract.resolved_tests).toHaveLength(1);
    expect(decision.contract.remaining_tests).toHaveLength(2);
    expect(decision.contract.main_buckets[0]).toMatchObject({
      bucket_index: 1,
      label: "missing test env",
      dominant: true
    });
    expect(decision.contract.main_buckets[1]?.mini_diff).toEqual({
      removed_models: 1
    });
    expect(decision.contract.next_best_action.code).toBe("fix_dominant_blocker");
    expect(decision.contract.read_targets).toMatchObject([
      {
        file: "tests/contracts/test_db_schema_freeze.py",
        line: null,
        bucket_index: 1
      },
      {
        file: "tests/contracts/test_feature_manifest_freeze.py",
        line: null
      }
    ]);
    expect(new Set(decision.contract.read_targets.map((target) => target.bucket_index)).size).toBe(
      decision.contract.read_targets.length
    );
    expect(decision.contract.next_best_action.note).toContain(
      "Fix bucket 1 first, then rerun the full suite at standard."
    );
    expect(decision.contract.read_targets[0]?.context_hint).toEqual({
      start_line: null,
      end_line: null,
      search_hint: "PGTEST_POSTGRES_DSN"
    });
  });

  it("builds a summary-first public diagnose contract and keeps full ids opt-in", () => {
    const input = buildMixedFailureOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis,
      resolvedTests: ["tests/contracts/test_feature_manifest_freeze.py::test_feature_manifest_is_frozen"],
      remainingTests: [
        "tests/contracts/test_db_schema_freeze.py::test_database_schema_snapshot_is_frozen",
        "tests/contracts/test_openapi_contract_freeze.py::test_openapi_paths_and_methods_are_frozen",
        "worker/test_job.py::test_other_failure",
        "opaque-id"
      ]
    });

    const summaryFirst = buildTestStatusPublicDiagnoseContract({
      contract: decision.contract,
      remainingSubsetAvailable: true
    });
    expect(summaryFirst.resolved_summary).toEqual({
      count: 1,
      families: [{ prefix: "tests/contracts/", count: 1 }]
    });
    expect(summaryFirst.remaining_summary).toEqual({
      count: 4,
      families: [
        { prefix: "tests/contracts/", count: 2 },
        { prefix: "other", count: 1 },
        { prefix: "worker/", count: 1 }
      ]
    });
    expect(summaryFirst.remaining_subset_available).toBe(true);
    expect(summaryFirst).not.toHaveProperty("resolved_tests");
    expect(summaryFirst).not.toHaveProperty("remaining_tests");

    const withIds = buildTestStatusPublicDiagnoseContract({
      contract: decision.contract,
      remainingSubsetAvailable: true,
      includeTestIds: true
    });
    expect(withIds.resolved_tests).toHaveLength(1);
    expect(withIds.remaining_tests).toHaveLength(4);
  });

  it("prefers observed traceback anchors for read targets without inventing line numbers", () => {
    const input = buildObservedAnchorOutput();
    const analysis = analyzeTestStatus(input);
    const decision = buildTestStatusDiagnoseContract({
      input,
      analysis
    });

    expect(analysis.collectionItems[0]).toMatchObject({
      file: "tests/conftest.py",
      line: 374,
      anchor_kind: "traceback"
    });
    expect(decision.contract.read_targets[0]).toEqual({
      file: "tests/conftest.py",
      line: 374,
      why: "it contains the PGTEST_POSTGRES_DSN setup guard",
      bucket_index: 1,
      context_hint: {
        start_line: 369,
        end_line: 379,
        search_hint: null
      }
    });
    expect(decision.contract.next_best_action.note).toContain(
      "Fix bucket 1 first, then rerun the full suite at standard."
    );
  });

  it("summarizes standard TypeScript diagnostics deterministically", () => {
    const output = applyHeuristicPolicy("typecheck-summary", buildTscStandardErrors());

    expect(output).toContain("- Typecheck failed: 3 errors in 2 files.");
    expect(output).toContain("TS2322 (type mismatch): 2 occurrences");
    expect(output).toContain("src/components/UserCard.tsx");
    expect(output).toContain("TS2741 (missing required property): 1 occurrence");
  });

  it("parses pretty TypeScript diagnostics without echoing context lines", () => {
    const output = applyHeuristicPolicy("typecheck-summary", buildTscPrettyErrors());

    expect(output).toContain("- Typecheck failed: 2 errors in 2 files.");
    expect(output).toContain("TS2322 (type mismatch): 1 occurrence");
    expect(output).toContain("TS2741 (missing required property): 1 occurrence");
    expect(output).not.toContain("const age: number = name");
  });

  it("keeps single TypeScript errors short and singular", () => {
    const output = applyHeuristicPolicy("typecheck-summary", buildTscSingleError());

    expect(output).toContain("- Typecheck failed: 1 error in 1 file.");
    expect(output).toContain("TS2304 (cannot find name): 1 occurrence");
  });

  it("groups repeated TypeScript codes and adds an overflow summary", () => {
    const output = applyHeuristicPolicy("typecheck-summary", buildTscManyGroupedErrors());

    expect(output).toContain("- Typecheck failed: 8 errors in 6 files.");
    expect(output).toContain("TS2322 (type mismatch): 3 occurrences");
    expect(output).toContain("TS2741 (missing required property): 2 occurrences");
    expect(output).toContain("TS2304 (cannot find name): 2 occurrences");
    expect(output).toContain("- 1 more error code.");
  });

  it("handles top-level TypeScript compiler errors without inventing files", () => {
    const output = applyHeuristicPolicy("typecheck-summary", buildTscTopLevelConfigError());

    expect(output).toContain("- Typecheck failed: 1 error.");
    expect(output).toContain("TS5083 (config file error): 1 occurrence.");
  });

  it("summarizes truncated TypeScript output from parsed diagnostics", () => {
    const output = applyHeuristicPolicy("typecheck-summary", buildTscTruncatedErrors());

    expect(output).toContain("- Typecheck failed: 2 errors in 1 file.");
    expect(output).toContain("TS2322 (type mismatch): 2 occurrences");
  });

  it("returns explicit zero-error TypeScript success and ignores unrelated text", () => {
    expect(applyHeuristicPolicy("typecheck-summary", buildTscZeroErrors())).toBe("No type errors.");
    expect(applyHeuristicPolicy("typecheck-summary", "compiler booted successfully")).toBeNull();
  });

  it("summarizes stylish ESLint output with fixable hints", () => {
    const output = applyHeuristicPolicy("lint-failures", buildEslintStylishErrors());

    expect(output).toContain("- Lint failed: 3 problems (2 errors, 1 warning).");
    expect(output).toContain("2 problems potentially fixable with --fix.");
    expect(output).toContain("@typescript-eslint/no-explicit-any: 2 errors");
    expect(output).toContain("no-console: 1 warning");
  });

  it("summarizes errors-only ESLint output", () => {
    const output = applyHeuristicPolicy("lint-failures", buildEslintErrorsOnly());

    expect(output).toContain("- Lint failed: 2 problems (2 errors, 0 warnings).");
    expect(output).toContain("@typescript-eslint/no-explicit-any: 2 errors");
  });

  it("keeps warnings-only ESLint output non-pass and explicit", () => {
    const output = applyHeuristicPolicy("lint-failures", buildEslintWarningsOnly());

    expect(output).toContain("- No lint errors visible: 2 warnings.");
    expect(output).toContain("no-console: 2 warnings");
    expect(output).not.toContain("passed");
  });

  it("normalizes rule-less ESLint parsing errors", () => {
    const output = applyHeuristicPolicy("lint-failures", buildEslintParsingError());

    expect(output).toContain("- Lint failed: 1 problem (1 error, 0 warnings).");
    expect(output).toContain("parsing error: 1 error");
  });

  it("groups repeated ESLint rules and adds an overflow summary", () => {
    const output = applyHeuristicPolicy("lint-failures", buildEslintManyRulesOutput());

    expect(output).toContain("- Lint failed: 7 problems (4 errors, 3 warnings).");
    expect(output).toContain("@typescript-eslint/no-explicit-any: 2 errors");
    expect(output).toContain("@typescript-eslint/explicit-function-return-type: 2 errors");
    expect(output).toContain("no-console: 1 warning");
    expect(output).toContain("- 2 more rules across 2 files.");
  });

  it("returns explicit zero-problem ESLint success and null for unsupported inputs", () => {
    expect(applyHeuristicPolicy("lint-failures", buildEslintZeroProblems())).toBe(
      "No lint failures."
    );
    expect(
      applyHeuristicPolicy(
        "lint-failures",
        '[{"filePath":"src/app.ts","messages":[{"ruleId":"no-console"}]}]'
      )
    ).toBeNull();
    expect(applyHeuristicPolicy("lint-failures", "random shell noise")).toBeNull();
  });

  it("keeps audit-critical and infra-risk heuristics intact", () => {
    expect(
      applyHeuristicPolicy(
        "audit-critical",
        ["lodash: critical vulnerability", "axios: high severity advisory"].join("\n")
      )
    ).toContain('"status": "ok"');

    expect(applyHeuristicPolicy("infra-risk", "Plan: 1 to add, 2 to destroy")).toContain(
      '"verdict": "fail"'
    );
    expect(applyHeuristicPolicy("infra-risk", "Plan: 1 to add, 0 to destroy")).toContain(
      '"verdict": "pass"'
    );
    expect(applyHeuristicPolicy("infra-risk", "safe to apply")).toContain('"verdict": "pass"');
    expect(applyHeuristicPolicy("infra-risk", "unrelated noise")).toBeNull();
  });
});
