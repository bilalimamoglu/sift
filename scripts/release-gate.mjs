import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLEAN_ROOM_EXCLUDES = new Set([
  ".git",
  ".local",
  ".planning",
  "coverage",
  "dist",
  "node_modules"
]);

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
        `Unknown release gate tier '${tier}'. Expected one of: core, e2e, full, clean.`
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

function runCommand(command, args, env, cwd = process.cwd()) {
  const rendered = [command, ...args].join(" ");
  console.log(`\n> ${rendered}`);

  const result = spawnSync(command, args, {
    cwd,
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

function copyRepoToCleanRoom(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter(src) {
      const relativePath = path.relative(sourceDir, src);
      if (relativePath === "") {
        return true;
      }

      const topLevel = relativePath.split(path.sep)[0];
      return !CLEAN_ROOM_EXCLUDES.has(topLevel);
    }
  });
}

function runCleanRoomGate() {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-clean-room-"));
  const cleanDir = path.join(parentDir, "repo");

  try {
    copyRepoToCleanRoom(process.cwd(), cleanDir);
    const { env, cleanup } = makeCiParityEnv();

    try {
      const npmCiEnv = { ...env };
      delete npmCiEnv.npm_config_userconfig;

      const npmCiStatus = runCommand("npm", ["ci"], npmCiEnv, cleanDir);
      if (npmCiStatus !== 0) {
        return npmCiStatus;
      }

      return runCommand(
        "node",
        ["scripts/release-gate.mjs", "--tier", "core"],
        env,
        cleanDir
      );
    } finally {
      cleanup();
    }
  } finally {
    fs.rmSync(parentDir, { force: true, recursive: true });
  }
}

function main() {
  const tier = parseTier(process.argv.slice(2));

  if (tier === "clean") {
    return runCleanRoomGate();
  }

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
