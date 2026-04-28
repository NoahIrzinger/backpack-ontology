#!/usr/bin/env node
import { run } from "../cli/router.js";
const argv = process.argv.slice(2);
const exitCode = await run(argv);
process.exit(exitCode);
