#!/usr/bin/env node
import { main } from "../dist/server/cli.js";

await main(process.argv.slice(2));
