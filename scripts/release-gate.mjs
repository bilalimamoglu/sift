import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseTier(argv) {
  const tierFlag = argv.find((arg) => arg.startsWith("--tier="));
  if (tierFlag) {
    return tierFlag.slice("--tier=".length);
  }

  const flagIndex = argv.indexOf("--tier");
  if (flagIndex >= 0) {
    return argv[flagIndex + 1];
  }

  return "full";
}

function commandsForTier(tier) {
  switch (tier) {
    case "core":
      return [
        ["npm", ["run", "typecheck"]],
        ["npm", ["run", "test:coverage"]],
        ["npm", ["run", "test:smoke"]]
      ];
    case "e2e":
      return [["npm", ["run", "test:e2e"]]];
    case "full":
      return [
        ["npm", ["run", "typecheck"]],
        ["npm", ["run", "test:coverage"]],
        ["npm", ["run", "test:smoke"]],
        ["npm", ["run", "test:e2e"]],
        ["npm", ["run", "build"]]
      ];
    default:
      throw new Error(
        `Unknown release gate tier '${tier}'. Expected one of: core, e2e, full.`
      );
  }
}

function makeCiParityEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-release-gate-"));
  const npmrcPath = path.join(tempDir, ".npmrc");

  // Force the same noisy npm warning class seen on GitHub runners so
  // wrapper-normalization regressions fail locally before push.
  fs.writeFileSync(npmrcPath, "always-auth=true\n", "utf8");

  return {
    cleanup() {
      fs.rmSync(tempDir, { force: true, recursive: true });
    },
    env: {
      ...process.env,
      CI: "1",
      npm_config_userconfig: npmrcPath
    }
  };
}

function runCommand(command, args, env) {
  const rendered = [command, ...args].join(" ");
  console.log(`\n> ${rendered}`);

  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit"
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  if (result.error) {
    throw result.error;
  }

  return 1;
}

function main() {
  const tier = parseTier(process.argv.slice(2));

  if (
    process.env.SIFT_RELEASE_GATE_ALREADY_RAN === "1" &&
    tier === "full"
  ) {
    console.log(
      "Skipping duplicate full release gate because SIFT_RELEASE_GATE_ALREADY_RAN=1."
    );
    return 0;
  }

  const commands = commandsForTier(tier);
  const { env, cleanup } = makeCiParityEnv();

  try {
    for (const [command, args] of commands) {
      const status = runCommand(command, args, env);
      if (status !== 0) {
        return status;
      }
    }

    return 0;
  } finally {
    cleanup();
  }
}

process.exitCode = main();
