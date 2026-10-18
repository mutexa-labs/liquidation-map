#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { run } from "./run";

process.exitCode = await run(process.argv.slice(2), {
  writeFile: (p, d) => writeFile(p, d),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
