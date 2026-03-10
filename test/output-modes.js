#!/usr/bin/env node
/**
 * TextWeb Test Suite — CLI Output Modes
 * Verifies backward-compatible default behavior and new --output modes.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs } = require('../src/cli');

const CLI_PATH = path.join(__dirname, '..', 'src', 'cli.js');
const FORM_URL = `file://${path.join(__dirname, 'fixtures', 'form.html')}`;

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}`);
  }
}

function runCli(args) {
  return spawnSync('node', [CLI_PATH, ...args], {
    encoding: 'utf8',
    timeout: 120000,
  });
}

function withArgv(argv, fn) {
  const prev = process.argv;
  try {
    process.argv = argv;
    return fn();
  } finally {
    process.argv = prev;
  }
}

function testParseArgsDefaults() {
  console.log('\n[parse] defaults');
  const options = withArgv(['node', 'cli.js', FORM_URL], () => parseArgs());
  assert(options.output === 'grid', 'default output mode is grid');
  assert(options.json === false, 'default json flag is false');
}

function testParseArgsOutputSemantic() {
  console.log('\n[parse] --output semantic');
  const options = withArgv(['node', 'cli.js', '--output', 'semantic', FORM_URL], () => parseArgs());
  assert(options.output === 'semantic', 'parses --output semantic');
}

function testDefaultEqualsGridOutput() {
  console.log('\n[cli] default output equals --output grid');
  const base = runCli([FORM_URL]);
  const explicitGrid = runCli(['--output', 'grid', FORM_URL]);

  assert(base.status === 0, 'default render exits 0');
  assert(explicitGrid.status === 0, '--output grid render exits 0');
  assert(base.stdout === explicitGrid.stdout, 'default stdout matches --output grid stdout');
}

function testSemanticOutputJson() {
  console.log('\n[cli] --output semantic emits structured JSON');
  const semantic = runCli(['--output', 'semantic', FORM_URL]);
  assert(semantic.status === 0, '--output semantic exits 0');

  let payload = null;
  try {
    payload = JSON.parse(semantic.stdout);
  } catch (err) {
    payload = null;
  }

  assert(!!payload, 'semantic output is valid JSON');
  assert(payload && payload.mode === 'semantic', 'semantic payload mode is semantic');
  assert(payload && Array.isArray(payload.elements), 'semantic payload has elements array');
  assert(payload && payload.elements.length > 0, 'semantic payload contains elements');

  const interactive = payload && payload.elements.find(el => el.grid_ref !== null);
  assert(!!interactive, 'at least one semantic element maps to grid_ref');
}

function run() {
  console.log('TextWeb Test Suite - Output Modes');

  testParseArgsDefaults();
  testParseArgsOutputSemantic();
  testDefaultEqualsGridOutput();
  testSemanticOutputJson();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
