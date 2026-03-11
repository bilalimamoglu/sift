import { describe, expect, it } from "vitest";
import { applyHeuristicPolicy } from "../src/core/heuristics.js";

describe("heuristic policies", () => {
  it("returns null when no policy is active", () => {
    expect(applyHeuristicPolicy(undefined, "anything")).toBeNull();
  });

  it("covers test-status success, skipped, failure, collection error, and empty input", () => {
    expect(applyHeuristicPolicy("test-status", "")).toBeNull();

    expect(
      applyHeuristicPolicy("test-status", "12 passed, 0 failed, 2 skipped")
    ).toContain("2 skips");

    const failed = applyHeuristicPolicy(
      "test-status",
      "1 passed, 2 failed\nFAILED test_one\nERROR test_two"
    );
    expect(failed).toContain("Tests did not pass.");
    expect(failed).toContain("2 tests failed.");
    expect(failed).toContain("FAILED test_one");

    const collection = applyHeuristicPolicy(
      "test-status",
      "134 errors during collection"
    );
    expect(collection).toContain("Tests did not complete.");
    expect(collection).toContain("134 errors occurred during collection.");

    const singularCollection = applyHeuristicPolicy(
      "test-status",
      "1 error during collection"
    );
    expect(singularCollection).toContain("1 error occurred during collection.");

    const errorOnly = applyHeuristicPolicy(
      "test-status",
      "1 passed, 0 failed, 2 errors\nERROR setup failed"
    );
    expect(errorOnly).toContain("2 errors occurred.");

    const noTests = applyHeuristicPolicy(
      "test-status",
      "collected 0 items\n\n============================ no tests ran in 0.01s ============================"
    );
    expect(noTests).toContain("Tests did not run.");
    expect(noTests).toContain("Collected 0 items.");

    const interrupted = applyHeuristicPolicy(
      "test-status",
      "KeyboardInterrupt\nInterrupted: 1 error during collection"
    );
    expect(interrupted).toContain("1 error occurred during collection.");

    expect(applyHeuristicPolicy("test-status", "KeyboardInterrupt")).toBe(
      "- Test run was interrupted."
    );

    expect(applyHeuristicPolicy("test-status", "test output with no summary")).toBeNull();
  });

  it("groups repeated collection-time import failures and missing modules", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
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
      ].join("\n")
    );

    expect(output).toContain("Tests did not complete.");
    expect(output).toContain("114 errors occurred during collection.");
    expect(output).toContain("Most failures are import/dependency errors during test collection.");
    expect(output).toContain("Missing modules include pydantic, fastapi, botocore.");
  });

  it("groups repeated missing modules in generic failed runs", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "1 passed, 0 failed, 3 errors",
        "E   ModuleNotFoundError: No module named 'numpy'",
        "E   ModuleNotFoundError: No module named 'numpy'",
        "ERROR setup failed"
      ].join("\n")
    );

    expect(output).toContain("Tests did not pass.");
    expect(output).toContain("3 errors occurred.");
    expect(output).toContain("Most failures are import/dependency errors.");
    expect(output).toContain("Missing module repeated across failures: numpy.");
  });

  it("caps repeated missing-module lists and merges node-style module errors", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "0 passed, 0 failed, 8 errors",
        "E   ModuleNotFoundError: No module named 'alpha'",
        "E   ModuleNotFoundError: No module named 'beta'",
        "E   ModuleNotFoundError: No module named 'gamma'",
        "E   ModuleNotFoundError: No module named 'delta'",
        "E   ModuleNotFoundError: No module named 'epsilon'",
        "E   ModuleNotFoundError: No module named 'zeta'",
        "E   ModuleNotFoundError: No module named 'eta'",
        "Error: Cannot find module 'chalk'",
        "ERROR setup failed"
      ].join("\n")
    );

    expect(output).toContain(
      "Missing modules include alpha, beta, gamma, delta, epsilon, zeta, chalk."
    );
    expect(output).not.toContain("Missing modules include alpha, beta, gamma, delta, epsilon, zeta, eta");
  });

  it("surfaces repeated generic error types when dependency grouping is not stronger", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "0 passed, 0 failed, 4 errors",
        "AssertionError: expected status 200",
        "RuntimeError: worker crashed",
        "AssertionError: expected payload",
        "RuntimeError: worker crashed"
      ].join("\n")
    );

    expect(output).toContain("Tests did not pass.");
    expect(output).toContain("4 errors occurred.");
    expect(output).toContain("Repeated error types include AssertionError, RuntimeError.");
  });

  it("returns focused collection failures when mapping is visible", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "4 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
        "E   ModuleNotFoundError: No module named 'pydantic'",
        "_ ERROR collecting tests/unit/test_api.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_api.py'.",
        "E   ModuleNotFoundError: No module named 'fastapi'"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("Tests did not complete.");
    expect(output).toContain("4 errors occurred during collection.");
    expect(output).toContain("import/dependency errors during collection");
    expect(output).toContain("tests/unit/test_auth.py -> missing module: pydantic");
    expect(output).toContain("tests/unit/test_api.py -> missing module: fastapi");
    expect(output).not.toContain("and 2 more failing modules");
  });

  it("returns focused collection failures with generic import reasons when no specific cause is shown", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "2 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
        "_ ERROR collecting tests/unit/test_api.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_api.py'."
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("Tests did not complete.");
    expect(output).toContain("import/dependency errors during collection");
    expect(output).toContain("tests/unit/test_auth.py -> import error during collection");
    expect(output).toContain("tests/unit/test_api.py -> import error during collection");
  });

  it("uses a generic collection/import group when only non-specific collection text is visible", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "2 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "setup hook failed before import finished",
        "_ ERROR collecting tests/unit/test_api.py _",
        "loader crashed before test import"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("collection/import errors");
    expect(output).toContain("tests/unit/test_auth.py -> setup hook failed before import finished");
    expect(output).toContain("tests/unit/test_api.py -> loader crashed before test import");
  });

  it("returns focused inline failures when mapping is visible", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "0 passed, 2 failed, 1 error",
        "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token",
        "ERROR tests/unit/test_api.py::test_smoke - ModuleNotFoundError: No module named 'httpx'"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("Tests did not pass.");
    expect(output).toContain("2 tests failed.");
    expect(output).toContain("1 error occurred.");
    expect(output).toContain("assertion failures");
    expect(output).toContain("missing dependency/module errors");
    expect(output).toContain(
      "tests/unit/test_auth.py::test_refresh -> assertion failed: expected token"
    );
    expect(output).toContain(
      "tests/unit/test_api.py::test_smoke -> missing module: httpx"
    );
  });

  it("supports node-style module failures and generic inline reasons in focused mode", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "0 passed, 2 failed, 0 errors",
        "ERROR tests/unit/test_cli.js::test_help - Error: Cannot find module 'chalk'",
        "FAILED tests/unit/test_worker.py::test_retry - RuntimeError: worker crashed",
        "FAILED tests/unit/test_db.py::test_ping - database unavailable"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("missing dependency/module errors");
    expect(output).toContain("RuntimeError failures");
    expect(output).toContain("other failures");
    expect(output).toContain("tests/unit/test_cli.js::test_help -> missing module: chalk");
    expect(output).toContain("tests/unit/test_worker.py::test_retry -> RuntimeError: worker crashed");
    expect(output).toContain("tests/unit/test_db.py::test_ping -> database unavailable");
  });

  it("groups node-style collection failures under import/dependency errors", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "2 errors during collection",
        "_ ERROR collecting tests/unit/test_cli.js _",
        "Error: Cannot find module 'chalk'",
        "_ ERROR collecting tests/unit/test_render.js _",
        "Error: Cannot find module 'kleur'"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("import/dependency errors during collection");
    expect(output).toContain("tests/unit/test_cli.js -> missing module: chalk");
    expect(output).toContain("tests/unit/test_render.js -> missing module: kleur");
  });

  it("groups ImportError collection failures under import/dependency errors", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "2 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "ImportError: cannot import name 'AuthService' from 'app.auth'",
        "_ ERROR collecting tests/unit/test_api.py _",
        "ImportError: cannot import name 'Router' from 'app.api'"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("import/dependency errors during collection");
    expect(output).toContain(
      "tests/unit/test_auth.py -> ImportError: cannot import name 'AuthService' from 'app.auth'"
    );
    expect(output).toContain(
      "tests/unit/test_api.py -> ImportError: cannot import name 'Router' from 'app.api'"
    );
  });

  it("ignores focused inline failures whose reason cannot be normalized", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "0 passed, 1 failed, 0 errors",
        "FAILED tests/unit/test_auth.py::test_refresh - ---"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("Tests did not pass.");
    expect(output).toContain("1 test failed.");
    expect(output).not.toContain("->");
  });

  it("ignores non-signal collection lines and deduplicates repeated focused failures", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "3 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "---",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
        "_ ERROR collecting tests/unit/test_api.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_api.py'."
      ].join("\n"),
      "focused"
    );

    expect(output).not.toBeNull();
    if (!output) {
      throw new Error("Expected focused output.");
    }
    expect(output).toContain("import/dependency errors during collection");
    expect(output).toContain("tests/unit/test_auth.py -> import error during collection");
    expect(output).toContain("tests/unit/test_api.py -> import error during collection");
    const authMatches = output.match(
      /tests\/unit\/test_auth\.py -> import error during collection/g
    );
    expect(authMatches).not.toBeNull();
    expect(authMatches?.length).toBe(1);
  });

  it("caps focused collection items at six entries and reports the remainder", () => {
    const lines = ["10 errors during collection"];
    const modules = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    for (const moduleName of modules) {
      lines.push(`_ ERROR collecting tests/unit/test_${moduleName}.py _`);
      lines.push(
        `E   ModuleNotFoundError: No module named '${moduleName}'`
      );
    }

    const output = applyHeuristicPolicy("test-status", lines.join("\n"), "focused");

    expect(output).toContain("tests/unit/test_a.py -> missing module: a");
    expect(output).toContain("tests/unit/test_f.py -> missing module: f");
    expect(output).not.toContain("tests/unit/test_g.py -> missing module: g");
    expect(output).toContain("and 4 more failing modules");
  });

  it("caps focused output to a few visible error groups", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "4 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "E   ModuleNotFoundError: No module named 'pydantic'",
        "_ ERROR collecting tests/unit/test_runtime.py _",
        "RuntimeError: worker crashed",
        "_ ERROR collecting tests/unit/test_assert.py _",
        "AssertionError: expected token",
        "_ ERROR collecting tests/unit/test_value.py _",
        "ValueError: invalid id"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("import/dependency errors during collection");
    expect(output).toContain("RuntimeError failures");
    expect(output).toContain("assertion failures");
    expect(output).toContain("- and 1 more error group");
    expect(output).not.toContain("ValueError failures");
  });

  it("pluralizes hidden focused error groups when more than one is omitted", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "5 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "E   ModuleNotFoundError: No module named 'pydantic'",
        "_ ERROR collecting tests/unit/test_runtime.py _",
        "RuntimeError: worker crashed",
        "_ ERROR collecting tests/unit/test_assert.py _",
        "AssertionError: expected token",
        "_ ERROR collecting tests/unit/test_value.py _",
        "ValueError: invalid id",
        "_ ERROR collecting tests/unit/test_key.py _",
        "KeyError: missing key"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("- and 2 more error groups");
  });

  it("prefers concrete missing-module reasons over generic pytest hint lines", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "3 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
        "Hint: make sure your test modules/packages have valid Python names.",
        "E   ModuleNotFoundError: No module named 'pydantic'",
        "_ ERROR collecting tests/unit/test_api.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_api.py'.",
        "Hint: make sure your test modules/packages have valid Python names.",
        "E   ModuleNotFoundError: No module named 'fastapi'"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("tests/unit/test_auth.py -> missing module: pydantic");
    expect(output).toContain("tests/unit/test_api.py -> missing module: fastapi");
    expect(output).not.toContain("make sure your test modules/packages have valid Python names");
  });

  it("filters low-value pytest and importlib frames from focused reasons", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "3 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "Traceback:",
        "../.venv/lib/python3.13/site-packages/_pytest/python.py:507: in importtestmodule",
        "/opt/homebrew/Cellar/python@3.13/3.13.0_1/Frameworks/Python.framework/Versions/3.13/lib/python3.13/importlib/__init__.py:88: in import_module",
        "E   ModuleNotFoundError: No module named 'pydantic'",
        "_ ERROR collecting tests/unit/test_api.py _",
        "../.venv/lib/python3.13/site-packages/_pytest/python.py:507: in importtestmodule",
        "E   ModuleNotFoundError: No module named 'fastapi'"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("tests/unit/test_auth.py -> missing module: pydantic");
    expect(output).toContain("tests/unit/test_api.py -> missing module: fastapi");
    expect(output).not.toContain("_pytest/python.py:507: in importtestmodule");
    expect(output).not.toContain("importlib/__init__.py:88: in import_module");
  });

  it("falls back to grouped standard causes when focused mapping is unclear", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "5 errors during collection",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
        "E   ModuleNotFoundError: No module named 'pydantic'",
        "ImportError while importing test module '/tmp/tests/unit/test_api.py'.",
        "E   ModuleNotFoundError: No module named 'fastapi'"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("Most failures are import/dependency errors during test collection.");
    expect(output).toContain("Missing modules include pydantic, fastapi.");
    expect(output).not.toContain("->");
  });

  it("returns verbose collection output as a flat failing-module list", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "4 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
        "E   ModuleNotFoundError: No module named 'pydantic'",
        "_ ERROR collecting tests/unit/test_api.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_api.py'.",
        "E   ModuleNotFoundError: No module named 'fastapi'"
      ].join("\n"),
      "verbose"
    );

    expect(output).toContain("Tests did not complete.");
    expect(output).toContain("4 errors occurred during collection.");
    expect(output).toContain("- tests/unit/test_auth.py -> missing module: pydantic");
    expect(output).toContain("- tests/unit/test_api.py -> missing module: fastapi");
    expect(output).not.toContain("import/dependency errors during collection");
  });

  it("returns verbose inline failure output as a flat list in source order", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "0 passed, 2 failed, 1 error",
        "FAILED tests/unit/test_auth.py::test_refresh - AssertionError: expected token",
        "ERROR tests/unit/test_api.py::test_smoke - ModuleNotFoundError: No module named 'httpx'",
        "FAILED tests/unit/test_worker.py::test_retry - RuntimeError: worker crashed"
      ].join("\n"),
      "verbose"
    );

    expect(output).toContain("- 2 tests failed.");
    expect(output).toContain("- 1 error occurred.");
    expect(output).toContain(
      "- tests/unit/test_auth.py::test_refresh -> assertion failed: expected token"
    );
    expect(output).toContain(
      "- tests/unit/test_api.py::test_smoke -> missing module: httpx"
    );
    expect(output).toContain(
      "- tests/unit/test_worker.py::test_retry -> RuntimeError: worker crashed"
    );
  });

  it("prefers the strongest visible reason per label in verbose mode", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "2 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'.",
        "E   ModuleNotFoundError: No module named 'pydantic'",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "ImportError while importing test module '/tmp/tests/unit/test_auth.py'."
      ].join("\n"),
      "verbose"
    );

    const matches = output?.match(/tests\/unit\/test_auth\.py ->/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(output).toContain("tests/unit/test_auth.py -> missing module: pydantic");
  });

  it("replaces a weaker generic reason with a stronger later reason for the same label", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "2 errors during collection",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "some generic collection failure text",
        "_ ERROR collecting tests/unit/test_auth.py _",
        "E   ModuleNotFoundError: No module named 'pydantic'"
      ].join("\n"),
      "verbose"
    );

    const matches = output?.match(/tests\/unit\/test_auth\.py ->/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(output).toContain("tests/unit/test_auth.py -> missing module: pydantic");
    expect(output).not.toContain("tests/unit/test_auth.py -> some generic collection failure text");
  });

  it("keeps generic textual reasons when no stronger classifier matches", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "2 failed",
        "FAILED tests/unit/test_auth.py::test_login - some generic failure text",
        "FAILED tests/unit/test_profile.py::test_refresh - another generic failure text"
      ].join("\n"),
      "focused"
    );

    expect(output).toContain("- other failures");
    expect(output).toContain(
      "- tests/unit/test_auth.py::test_login -> some generic failure text"
    );
    expect(output).toContain(
      "- tests/unit/test_profile.py::test_refresh -> another generic failure text"
    );
  });

  it("prefers assertion failures over weaker generic reasons for the same test", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "2 failed",
        "FAILED tests/unit/test_auth.py::test_login - some generic failure text",
        "FAILED tests/unit/test_auth.py::test_login - AssertionError: expected token"
      ].join("\n"),
      "verbose"
    );

    expect(output).toContain(
      "- tests/unit/test_auth.py::test_login -> assertion failed: expected token"
    );
    expect(output).not.toContain("some generic failure text");
  });

  it("prefers Error or Exception reasons over weaker generic reasons for the same test", () => {
    const output = applyHeuristicPolicy(
      "test-status",
      [
        "2 failed",
        "FAILED tests/unit/test_worker.py::test_retry - some generic failure text",
        "FAILED tests/unit/test_worker.py::test_retry - RuntimeError: worker crashed"
      ].join("\n"),
      "verbose"
    );

    expect(output).toContain(
      "- tests/unit/test_worker.py::test_retry -> RuntimeError: worker crashed"
    );
    expect(output).not.toContain("some generic failure text");
  });

  it("covers audit-critical sparse parsing branches", () => {
    expect(
      applyHeuristicPolicy(
        "audit-critical",
        "lodash: critical vulnerability\naxios: high severity advisory"
      )
    ).toContain('"package": "lodash"');

    expect(
      applyHeuristicPolicy("audit-critical", "critical vulnerability with no package")
    ).toBeNull();
    expect(applyHeuristicPolicy("audit-critical", "low severity only")).toBeNull();
    expect(
      applyHeuristicPolicy("audit-critical", "lodash: critical vulnerability")
    ).toContain("One critical vulnerability found in lodash.");
  });

  it("covers infra-risk fail, pass, safe, and null branches", () => {
    expect(
      applyHeuristicPolicy("infra-risk", "Plan: 1 to destroy")
    ).toContain('"verdict": "fail"');
    expect(
      applyHeuristicPolicy("infra-risk", "Plan: 0 to destroy")
    ).toContain('"verdict": "pass"');
    expect(
      applyHeuristicPolicy("infra-risk", "No changes. Infrastructure is safe to apply.")
    ).toContain('"verdict": "pass"');
    expect(applyHeuristicPolicy("infra-risk", "added one bucket")).toBeNull();
  });

  it("returns null for unsupported policy names", () => {
    expect(applyHeuristicPolicy("lint-failures", "lint failed")).toBeNull();
  });
});
