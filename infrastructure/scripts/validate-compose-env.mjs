#!/usr/bin/env node
// validate-compose-env.mjs
//
// B-028 fix 3 — CI env-validator pre-flight.
//
// Compares every `process.env.X` reference in the API and AQL source
// trees with the env block of the corresponding service in
// `docker-compose.ec2-dev.yml`. Exits 1 with a clear diff when a code
// reference is not declared (or allowlisted), 0 otherwise.
//
// This catches the B-028 failure mode (running container missing a
// required env var because compose YAML drifted from code) at PR review
// time instead of at runtime on the dev box.
//
// Pure Node — no deps, no install step. Run with:
//   node infrastructure/scripts/validate-compose-env.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPOSE_FILE = join(REPO_ROOT, 'infrastructure', 'docker', 'docker-compose.ec2-dev.yml');
const ALLOWLIST_FILE = join(REPO_ROOT, 'infrastructure', 'scripts', 'compose-env-allowlist.txt');

// Each entry: (compose service name) ↔ (source dir whose process.env refs must match)
const SERVICES = [
  { service: 'api',          srcDir: join(REPO_ROOT, 'apps', 'api', 'src') },
  { service: 'agent-query',  srcDir: join(REPO_ROOT, 'apps', 'agent-query', 'src') },
];

// ---------------------------------------------------------------------------
// Compose YAML — extract the `environment:` block for each service. We don't
// pull in a full YAML parser; the indentation of these compose files is
// well-known (2 spaces for services, 4 for service keys, 6 for env entries).
// ---------------------------------------------------------------------------

function extractComposeEnv(composeText, serviceName) {
  const lines = composeText.split('\n');
  const declared = new Set();

  // Find the service block: a line matching /^  <name>:\s*$/
  const serviceHeader = new RegExp(`^  ${escapeRegex(serviceName)}:\\s*$`);
  let i = lines.findIndex((line) => serviceHeader.test(line));
  if (i < 0) {
    throw new Error(`service "${serviceName}" not found in compose file`);
  }

  // Walk forward to the `    environment:` line, stopping if we hit the next
  // service header (another /^  \w+:\s*$/) without finding it.
  for (i++; i < lines.length; i++) {
    if (/^  [a-z0-9_-]+:\s*$/i.test(lines[i])) break; // next service — no env block
    if (/^    environment:\s*$/.test(lines[i])) {
      // Collect subsequent lines indented at 6+ spaces; stop on indent drop.
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === '' || /^\s*#/.test(line)) continue;
        if (!/^      \S/.test(line)) break; // indent dropped below 6 spaces
        // Match "KEY: value", "KEY:", or "- KEY=value" (list form, rare)
        const m = /^      ([A-Z_][A-Z0-9_]*)\s*:/.exec(line);
        if (m) declared.add(m[1]);
      }
      return declared;
    }
  }
  return declared; // service exists but has no environment block
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Source scan — collect every `process.env.X` and `process.env['X']`.
// ---------------------------------------------------------------------------

function* walkTs(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__' || entry.startsWith('.')) continue;
      yield* walkTs(full);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test.ts')) {
      yield full;
    }
  }
}

const ENV_DOT     = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
const ENV_BRACKET = /process\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g;
// Both apps load config via a `z.object({ KEY: z.string()... })` schema
// against `process.env`. The schema keys are env-var references just as
// surely as `process.env.X` is — and they're the pattern that caused
// B-028 to be missed in code review of the Domain 12 PRs (AQL_INTERNAL_TOKEN
// was added to the schema without being added to the compose env block).
// Match a top-level zod schema property: indented `NAME: z` on a line.
const ENV_ZOD     = /^\s+([A-Z_][A-Z0-9_]*)\s*:\s*z\b/gm;

function collectEnvRefs(srcDir) {
  const refs = new Map(); // var -> Set of files referencing it
  for (const file of walkTs(srcDir)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(REPO_ROOT, file);
    for (const re of [ENV_DOT, ENV_BRACKET, ENV_ZOD]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (!refs.has(m[1])) refs.set(m[1], new Set());
        refs.get(m[1]).add(rel);
      }
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

function loadAllowlist() {
  let text;
  try { text = readFileSync(ALLOWLIST_FILE, 'utf8'); }
  catch { return new Set(); }
  return new Set(
    text.split('\n')
        .map((l) => l.replace(/#.*$/, '').trim())
        .filter((l) => l.length > 0),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const composeText = readFileSync(COMPOSE_FILE, 'utf8');
  const allowlist = loadAllowlist();

  let failed = false;
  const sectionLines = [];

  for (const { service, srcDir } of SERVICES) {
    sectionLines.push(`\n=== ${service} (${relative(REPO_ROOT, srcDir)}) ===`);
    const declared = extractComposeEnv(composeText, service);
    const refs = collectEnvRefs(srcDir);

    const missing = [];
    for (const [name, files] of refs.entries()) {
      if (declared.has(name) || allowlist.has(name)) continue;
      missing.push({ name, files: Array.from(files) });
    }
    missing.sort((a, b) => a.name.localeCompare(b.name));

    sectionLines.push(`compose declares ${declared.size} env keys; code references ${refs.size} unique vars; ${missing.length} undeclared.`);

    if (missing.length > 0) {
      failed = true;
      for (const { name, files } of missing) {
        sectionLines.push(`  MISSING: ${name}`);
        for (const f of files.slice(0, 3)) sectionLines.push(`    referenced in ${f}`);
        if (files.length > 3) sectionLines.push(`    ...and ${files.length - 3} more file(s)`);
      }
    }
  }

  console.log(sectionLines.join('\n'));

  if (failed) {
    console.log('\nFAIL: code references env vars that are NOT declared in docker-compose.ec2-dev.yml');
    console.log('Fix by either adding the var to the service\'s environment block in the compose file,');
    console.log(`or by adding the var to ${relative(REPO_ROOT, ALLOWLIST_FILE)} with a comment explaining why.`);
    process.exit(1);
  }

  console.log('\nOK: every code-referenced env var is declared in compose or allowlisted.');
}

main();
