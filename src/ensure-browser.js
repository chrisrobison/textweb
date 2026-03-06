'use strict';

/**
 * ensure-browser.js
 *
 * Checks whether Playwright's Chromium is installed and, when running
 * in an interactive terminal, offers to install it automatically.
 *
 * All output goes to stderr so it never pollutes stdout-based protocols
 * (e.g. the MCP JSON-RPC transport).
 */

const fs = require('fs');
const { spawnSync } = require('child_process');
const readline = require('readline');

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function log(msg) {
  process.stderr.write(msg + '\n');
}

function isInstalled() {
  try {
    const { chromium } = require('playwright');
    const execPath = chromium.executablePath();
    return fs.existsSync(execPath);
  } catch {
    return false;
  }
}

function install() {
  // Prefer the local playwright CLI (bundled with the dep) over npx
  let cliPath = null;
  try {
    cliPath = require.resolve('playwright/cli.js');
  } catch { /* fall through to npx */ }

  const result = cliPath
    ? spawnSync(process.execPath, [cliPath, 'install', 'chromium'], { stdio: 'inherit' })
    : spawnSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit', shell: true });

  return result.status === 0;
}

async function ensureBrowser() {
  if (isInstalled()) return;

  log('');
  log('⚠  Playwright Chromium is not installed — textweb needs it to browse the web.');

  if (process.stdin.isTTY) {
    const answer = await ask('   Install it now? (Y/n) ');
    if (answer.toLowerCase() === 'n') {
      log('');
      log('   Run manually:  npx playwright install chromium');
      log('');
      process.exit(1);
    }
  } else {
    log('');
    log('   Run:  npx playwright install chromium');
    log('');
    process.exit(1);
  }

  log('');
  log('   Installing Chromium — this takes ~30 seconds the first time…');
  log('');

  if (!install()) {
    log('');
    log('   Installation failed. Run manually:  npx playwright install chromium');
    log('');
    process.exit(1);
  }

  log('');
  log('✓  Chromium installed successfully!');
  log('');
}

module.exports = { ensureBrowser };
