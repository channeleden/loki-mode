#!/usr/bin/env node
/**
 * Loki Mode postinstall script
 * Sets up the skill symlink for Claude Code, Codex CLI, and Gemini CLI
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = os.homedir();
const skillDir = path.join(homeDir, '.claude', 'skills', 'loki-mode');
const packageDir = path.join(__dirname, '..');

const version = (() => {
  try { return fs.readFileSync(path.join(packageDir, 'VERSION'), 'utf8').trim(); }
  catch { return require(path.join(packageDir, 'package.json')).version; }
})();

console.log('');
console.log(`Loki Mode v${version} installed!`);
console.log('');

// Try to create skill symlink
try {
  const skillParent = path.dirname(skillDir);

  if (!fs.existsSync(skillParent)) {
    fs.mkdirSync(skillParent, { recursive: true });
  }

  // Remove existing symlink/directory
  if (fs.existsSync(skillDir)) {
    const stats = fs.lstatSync(skillDir);
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(skillDir);
    } else {
      // Existing real directory (not a symlink) - back it up and replace
      const backupDir = skillDir + '.backup.' + Date.now();
      console.log(`[WARNING] Existing non-symlink installation found at ${skillDir}`);
      console.log(`  Active version: ${skillDir}`);
      console.log(`  npm version:    ${packageDir}`);
      console.log('');
      console.log(`Backing up existing installation to: ${backupDir}`);
      try {
        fs.renameSync(skillDir, backupDir);
        console.log('Backup complete. Creating symlink to npm installation.');
        console.log('');
        console.log(`To restore the old installation later:`);
        console.log(`  rm "${skillDir}" && mv "${backupDir}" "${skillDir}"`);
        console.log('');
      } catch (backupErr) {
        console.log(`Could not back up existing installation: ${backupErr.message}`);
        console.log('');
        console.log('To fix manually, remove the existing directory and reinstall:');
        console.log(`  rm -rf "${skillDir}"`);
        console.log('  npm install -g loki-mode');
        console.log('');
      }
    }
  }

  // Create symlink
  if (!fs.existsSync(skillDir)) {
    fs.symlinkSync(packageDir, skillDir);
    console.log(`Skill installed to: ${skillDir}`);
  }
} catch (err) {
  console.log(`Could not auto-install skill: ${err.message}`);
  console.log('');
  console.log('Manual installation:');
  console.log(`  ln -sf "${packageDir}" "${skillDir}"`);
}

console.log('');
console.log('Usage:');
console.log('  loki start [PRD]              - Start with Claude (default)');
console.log('  loki start --provider codex   - Start with OpenAI Codex');
console.log('  loki start --provider gemini  - Start with Google Gemini');
console.log('  loki status                   - Check status');
console.log('  loki --help                   - Show all commands');
console.log('');
console.log('Providers:');
console.log('  claude  - Full features (parallel agents, Task tool, MCP)');
console.log('  codex   - Degraded mode (sequential only)');
console.log('  gemini  - Degraded mode (sequential only)');
console.log('');
console.log('Or in Claude Code:');
console.log('  claude --dangerously-skip-permissions');
console.log('  Then say: "Loki Mode"');
console.log('');

// Anonymous install telemetry (fire-and-forget, silent)
try {
  if (process.env.LOKI_TELEMETRY_DISABLED !== 'true' && process.env.DO_NOT_TRACK !== '1') {
    const https = require('https');
    const crypto = require('crypto');
    const idFile = path.join(homeDir, '.loki-telemetry-id');
    let distinctId;
    try {
      distinctId = fs.readFileSync(idFile, 'utf8').trim();
    } catch {
      distinctId = crypto.randomUUID();
      try { fs.writeFileSync(idFile, distinctId + '\n'); } catch {}
    }
    const payload = JSON.stringify({
      api_key: 'phc_ya0vGBru41AJWtGNfZZ8H9W4yjoZy4KON0nnayS7s87',
      event: 'install',
      distinct_id: distinctId,
      properties: {
        os: os.platform(),
        arch: os.arch(),
        version: version,
        channel: 'npm',
        node_version: process.version,
      },
    });
    const req = https.request({
      hostname: 'us.i.posthog.com',
      path: '/capture/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      timeout: 3000,
    });
    req.on('error', () => {});
    req.end(payload);
  }
} catch {}
