#!/usr/bin/env node
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const TEMPLATE = fileURLToPath(new URL('./template', import.meta.url));
const DEFAULT_DIR = '0xio-dapp';
const TEXT_FILES = /\.(json|md|html|ts|tsx|css)$|^_gitignore$/;

const HELP = `Usage: npm create @0xio/dapp [directory]

Creates a Vite, React and TypeScript dapp on @0xio/sdk.

Options:
  -h, --help   Show this help`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function packageName(dir) {
  const name = basename(resolve(dir))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]+/, '')
    .replace(/[^a-z0-9-~._]+/g, '-');
  return name || DEFAULT_DIR;
}

function title(name) {
  const words = name.replace(/[-_.~]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '0xio dapp';
}

async function askDir() {
  if (!process.stdin.isTTY) return DEFAULT_DIR;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`Project directory (${DEFAULT_DIR}): `)).trim();
    return answer || DEFAULT_DIR;
  } finally {
    rl.close();
  }
}

function fill(dir, values) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      fill(path, values);
    } else if (TEXT_FILES.test(entry)) {
      const text = readFileSync(path, 'utf8');
      const next = text.replace(/__NAME__|__TITLE__/g, (key) => values[key]);
      if (next !== text) writeFileSync(path, next);
    }
  }
}

function dotNames(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_')) renameSync(join(dir, entry), join(dir, `.${entry.slice(1)}`));
  }
}

function runCommand() {
  const agent = process.env.npm_config_user_agent ?? '';
  if (agent.startsWith('pnpm')) return { install: 'pnpm install', dev: 'pnpm dev' };
  if (agent.startsWith('yarn')) return { install: 'yarn', dev: 'yarn dev' };
  if (agent.startsWith('bun')) return { install: 'bun install', dev: 'bun run dev' };
  return { install: 'npm install', dev: 'npm run dev' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    return;
  }
  const unknown = args.find((a) => a.startsWith('-'));
  if (unknown) fail(`Unknown option ${unknown}\n\n${HELP}`);

  const dir = args[0] ?? (await askDir());
  const target = resolve(dir);
  if (existsSync(target) && readdirSync(target).length > 0) {
    fail(`${dir} is not empty`);
  }

  const name = packageName(dir);
  cpSync(TEMPLATE, target, { recursive: true });
  fill(target, { __NAME__: name, __TITLE__: title(name) });
  dotNames(target);

  const cmd = runCommand();
  const rel = relative(process.cwd(), target) || '.';
  console.log(`\nCreated ${rel}\n`);
  if (rel !== '.') console.log(`  cd ${rel}`);
  console.log(`  ${cmd.install}`);
  console.log(`  ${cmd.dev}\n`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
