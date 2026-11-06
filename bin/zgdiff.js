#!/usr/bin/env node
import { createRequire } from 'node:module';
import { run } from '../src/server/cli.js';

const { version } = createRequire(import.meta.url)('../package.json');

run(process.argv.slice(2), version);
