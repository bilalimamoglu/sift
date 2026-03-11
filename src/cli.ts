#!/usr/bin/env node
import { handleCliError, runCli } from "./cli-app.js";

runCli().catch((error: unknown) => {
  handleCliError(error);
});
