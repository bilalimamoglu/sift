import { execSync } from "node:child_process";
import path from "node:path";

export default function globalSetupE2E(): void {
  execSync("npm run build", {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: "pipe"
  });
}
