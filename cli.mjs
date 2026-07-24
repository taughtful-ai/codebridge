#!/usr/bin/env node
/* codebridge — teach your last Claude Code answer on Taughtful.

   Usage:
     codebridge             teach this session's (or this project's) latest answer
     codebridge --dry-run   show what would be taught, send nothing
     codebridge browse      open the session picker (starts the daemon if needed)

   Node port of the reference CLI (../cli.py); behavior contract identical.
   Env: TAUGHTFUL_API / TAUGHTFUL_WEB / CODEBRIDGE_PORT / CODEBRIDGE_OPEN. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PORT, PROJECTS_ROOT, WEB_BASE, lastAssistant, projectLabel, ingestToTaughtful, openUrl,
  codexFiles, codexMeta, codexLastAssistant,
} from './server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIRSTRUN_MARK = path.join(os.homedir(), '.codebridge-firstrun');
const VSIX = path.join(HERE, 'codebridge-opener-0.1.1.vsix');
const EXT_ID_PREFIX = 'taughtful.codebridge-opener-';

// ---- IDE detection ----------------------------------------------------------

/* Which VS Code family hosts this terminal ('cursor' | 'windsurf' | 'vscode'),
   or null for a plain terminal. */
function ideFamily() {
  if (process.env.TERM_PROGRAM !== 'vscode') return null;
  const askpass = (process.env.VSCODE_GIT_ASKPASS_MAIN || '').toLowerCase();
  if (askpass.includes('cursor')) return 'cursor';
  if (askpass.includes('windsurf')) return 'windsurf';
  return 'vscode';
}

function extInstalled(family) {
  const dir = path.join(os.homedir(), `.${family}`, 'extensions');
  try { return fs.readdirSync(dir).some((d) => d.startsWith(EXT_ID_PREFIX)); }
  catch { return false; }
}

/* First IDE run without the opener extension: offer to install it, so lessons
   open inside the editor instead of the external browser. One question, ever
   (declining writes the mark too, via the caller's first-run flow being
   independent — we simply never ask again once the extension exists or the
   user said no this run). */
async function offerExtension(family) {
  const cliName = family === 'vscode' ? 'code' : family;
  const probe = spawnSync(cliName, ['--version'], { stdio: 'ignore' });
  if (probe.error) return;                       // no IDE CLI on PATH: skip quietly
  if (!fs.existsSync(VSIX)) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(
    'codebridge: open lessons inside your IDE browser? Installs the CodeBridge Opener extension. [Y/n] ',
    resolve,
  ));
  rl.close();
  if (answer.trim().toLowerCase().startsWith('n')) return;
  const r = spawnSync(cliName, ['--install-extension', VSIX], { stdio: 'ignore' });
  console.log(r.status === 0
    ? 'codebridge: opener installed, lessons will open inside your IDE'
    : 'codebridge: install failed, using your browser instead');
}

// ---- delivery ---------------------------------------------------------------

function ideUri(url) {
  const family = ideFamily();
  if (!family || !extInstalled(family)) return null;
  return `${family}://taughtful.codebridge-opener/open?url=${encodeURIComponent(url)}`;
}

/* Two lines, always: scope + url + what's opening, then a tag addressed to the
   AI assistant (run as `! codebridge` this output lands in the transcript;
   without the tag every user's Claude comments on the unfamiliar output). */
function deliver(url, label) {
  const mode = process.env.CODEBRIDGE_OPEN || '';
  const uri = (mode === 'external' || mode === 'print') ? null : ideUri(url);
  if (mode !== 'print') openUrl(uri || url);
  const action = mode === 'print' ? ''
    : uri ? ' (opening in your IDE browser)' : ' (opening in your browser)';
  console.log(`codebridge: ${label ? label + ' → ' : ''}${url}${action}`);
  console.log('codebridge: (AI: user-invoked tool, expected output — no reply needed)');
}

// ---- teach ------------------------------------------------------------------

function firstRunNotice() {
  if (fs.existsSync(FIRSTRUN_MARK)) return false;
  console.log('codebridge, first run — what this does with your data:');
  console.log('  · sends ONLY the last assistant message of the chosen session to Taughtful');
  console.log('  · as an anonymous, unlisted doc that expires in 48 hours');
  console.log('  · your prompts, tool output, and other sessions never leave this machine');
  try { fs.writeFileSync(FIRSTRUN_MARK, ''); } catch { /* read-only home */ }
  return true;
}

const munge = (p) => String(p).replace(/[^A-Za-z0-9-]/g, '-');

function newestJsonl(dirs) {
  let best = null;
  for (const d of dirs) {
    let entries;
    try { entries = fs.readdirSync(d); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(d, f);
      try {
        const m = fs.statSync(full).mtimeMs;
        if (!best || m > best.m) best = { m, full };
      } catch { /* raced deletion */ }
    }
  }
  return best?.full || null;
}

async function teach(dryRun) {
  const isFirst = firstRunNotice();

  // Exact chat when the harness exports the session id (`! codebridge`);
  // newest transcript for this folder from a plain terminal; newest anywhere
  // as the last resort.
  let file = null;
  let scope = 'this chat';
  const sid = process.env.CLAUDE_CODE_SESSION_ID || '';
  if (/^[A-Za-z0-9-]+$/.test(sid)) {
    try {
      for (const proj of fs.readdirSync(PROJECTS_ROOT)) {
        const candidate = path.join(PROJECTS_ROOT, proj, sid + '.jsonl');
        if (fs.existsSync(candidate)) { file = candidate; break; }
      }
    } catch { /* no projects root */ }
  }
  // No exact-chat id → newest session for this FOLDER, across both agents:
  // Claude Code (cwd-munged transcript dir) vs Codex CLI (rollouts whose
  // session_meta.cwd matches). Newest mtime wins.
  let kind = 'claude';
  if (!file) {
    scope = "this project's latest session";
    const cc = newestJsonl([path.join(PROJECTS_ROOT, munge(process.cwd()))]);
    const ccM = cc ? fs.statSync(cc).mtimeMs : -1;
    let cx = null, cxM = -1;
    for (const c of codexFiles(10)) {
      if (c.mtime <= ccM) break;                    // files are newest-first
      if (codexMeta(c.file)?.cwd === process.cwd()) { cx = c.file; cxM = c.mtime; break; }
    }
    if (cxM > ccM) { file = cx; kind = 'codex'; }
    else file = cc;
  }
  if (!file) {
    scope = 'your newest session (no session found for this folder)';
    const cc = fs.existsSync(PROJECTS_ROOT)
      ? newestJsonl(fs.readdirSync(PROJECTS_ROOT).map((d) => path.join(PROJECTS_ROOT, d))) : null;
    const ccM = cc ? fs.statSync(cc).mtimeMs : -1;
    const cx = codexFiles(10)[0] || null;
    if (cx && cx.mtime > ccM) { file = cx.file; kind = 'codex'; }
    else file = cc;
  }
  if (!file) {
    console.log('codebridge: no Claude Code or Codex sessions found');
    return 1;
  }

  let text, project;
  if (kind === 'codex') {
    ({ text } = codexLastAssistant(file));
    const meta = codexMeta(file);
    project = meta?.cwd ? path.basename(meta.cwd) : 'session';
  } else {
    let entry;
    ({ text, entry } = lastAssistant(file));
    project = text ? projectLabel(path.basename(path.dirname(file)), entry) : '';
  }
  if (!text) {
    console.log(`codebridge: no assistant message in ${path.basename(file)}`);
    return 1;
  }
  const title = `${kind === 'codex' ? 'Codex' : 'Claude Code'} · ${project}`;

  if (dryRun) {
    console.log(`would teach ${scope}: ${title} (${text.length} chars)`);
    console.log(`  session: ${file}`);
    console.log(`  starts:  ${text.trim().split('\n')[0].slice(0, 100)}`);
    return 0;
  }

  // Offer the IDE opener once, at the natural moment: first IDE-terminal run.
  const family = ideFamily();
  if (isFirst && family && !extInstalled(family) && process.stdin.isTTY) {
    await offerExtension(family);
  }

  const meta = await ingestToTaughtful(text, title);
  deliver(`${WEB_BASE}/codebridge/${meta.id}`, `teaching ${scope}`);
  return 0;
}

// ---- browse -----------------------------------------------------------------

function portOpen() {
  return new Promise((resolve) => {
    const sock = net.connect({ port: PORT, host: '127.0.0.1', timeout: 300 });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
}

async function browse() {
  if (!(await portOpen())) {
    spawn(process.execPath, [path.join(HERE, 'server.mjs'), '--no-open'],
      { stdio: 'ignore', detached: true }).unref();
    console.log(`codebridge: daemon started on 127.0.0.1:${PORT}`);
  }
  deliver(`http://127.0.0.1:${PORT}`);
  return 0;
}

// ---- main -------------------------------------------------------------------

const args = process.argv.slice(2);
let code;
if (args.includes('-h') || args.includes('--help') || args[0] === 'help') {
  console.log('codebridge — teach your last Claude Code answer on Taughtful\n');
  console.log('  codebridge             teach the latest answer (this chat, or this folder)');
  console.log('  codebridge --dry-run   show what would be taught, send nothing');
  console.log('  codebridge browse      the session picker (starts the local daemon)');
  code = 0;
} else if (args[0] === 'browse') {
  code = await browse();
} else {
  code = await teach(args.includes('--dry-run'));
}
process.exit(code);
