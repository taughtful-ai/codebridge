#!/usr/bin/env node
/* CodeBridge — Taughtful for Claude Code, as a local companion. Node port of
   the reference implementation (../server.py); behavior contract identical.

   Serves a Taughtful-branded picker at http://127.0.0.1:4519 listing recent
   Claude Code sessions (read on demand from ~/.claude/projects/*.jsonl) with a
   Teach button per session. Teach sends THAT ONE assistant message to the
   Taughtful backend as an anonymous pasted-note doc (48h TTL) and opens the
   taughtful.ai/codebridge/<id> player.

   Privacy stance: loopback-only, read-only, final assistant text only, nothing
   leaves the machine until Teach, browser access origin-allowlisted. */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const PORT = parseInt(process.env.CODEBRIDGE_PORT || '4519', 10);
export const API_BASE = (process.env.TAUGHTFUL_API || 'https://elearner-backend.fly.dev').replace(/\/$/, '');
export const WEB_BASE = (process.env.TAUGHTFUL_WEB || 'https://taughtful.ai').replace(/\/$/, '');
export const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

const UI_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html');

// Only the transcript tail is scanned — the final assistant entry is always
// near the end, and transcripts grow to many MB.
const TAIL_BYTES = 512 * 1024;

const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`,
  'https://taughtful.ai', 'https://www.taughtful.ai',
  'http://localhost:5173', 'http://127.0.0.1:5173',
]);

const SAFE_DIR = /^[A-Za-z0-9._-]+$/;
const SAFE_ID = /^[A-Za-z0-9-]+$/;

function entryText(entry) {
  if (entry?.type !== 'assistant' || entry?.isSidechain) return '';
  const content = entry?.message?.content || [];
  const parts = content
    .filter((b) => b && typeof b === 'object' && b.type === 'text')
    .map((b) => b.text || '')
    .filter((t) => t.trim());
  return parts.join('\n\n').trim();
}

/* (text, entry) of the last assistant message near the end of a transcript.
   Reads the tail, walks lines backward; the first line at the tail cut is
   dropped as almost certainly truncated mid-JSON. */
export function lastAssistant(file) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  let raw;
  try {
    const start = size > TAIL_BYTES ? size - TAIL_BYTES : 0;
    raw = Buffer.alloc(size - start);
    fs.readSync(fd, raw, 0, raw.length, start);
  } finally {
    fs.closeSync(fd);
  }
  let lines = raw.toString('utf8').split('\n');
  if (size > TAIL_BYTES && lines.length) lines = lines.slice(1);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const text = entryText(entry);
    if (text) return { text, entry };
  }
  return { text: '', entry: null };
}

export function projectLabel(dirname, entry) {
  const cwd = entry?.cwd || '';
  if (cwd) return path.basename(cwd);
  const parts = dirname.replace(/^-+|-+$/g, '').split('-');
  return parts[parts.length - 1] || dirname;
}

export function sessionFile(dirname, sid) {
  if (!SAFE_DIR.test(dirname || '') || !SAFE_ID.test(sid || '')) return null;
  const f = path.resolve(PROJECTS_ROOT, dirname, sid + '.jsonl');
  if (!f.startsWith(path.resolve(PROJECTS_ROOT)) || !fs.existsSync(f)) return null;
  return f;
}

export function scanSessions(limit) {
  const candidates = [];
  if (fs.existsSync(PROJECTS_ROOT)) {
    for (const proj of fs.readdirSync(PROJECTS_ROOT)) {
      const dir = path.join(PROJECTS_ROOT, proj);
      let entries;
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
        entries = fs.readdirSync(dir);
      } catch { continue; }
      for (const f of entries) {
        if (!f.endsWith('.jsonl')) continue;
        try {
          candidates.push({ mtime: fs.statSync(path.join(dir, f)).mtimeMs, dir: proj, file: path.join(dir, f) });
        } catch { /* raced deletion */ }
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  const sessions = [];
  for (const c of candidates.slice(0, Math.max(limit * 3, 20))) {
    const { text, entry } = lastAssistant(c.file);
    if (!text) continue;
    sessions.push({
      dir: c.dir,
      id: path.basename(c.file, '.jsonl'),
      project: projectLabel(c.dir, entry),
      cwd: entry?.cwd || '',
      slug: entry?.slug || '',
      ts: entry?.timestamp || '',
      mtime: c.mtime / 1000,
      preview: text.slice(0, 280),
      chars: text.length,
    });
    if (sessions.length >= limit) break;
  }
  return sessions;
}

/* POST the message to Taughtful's ingest as a single text source → doc meta. */
export async function ingestToTaughtful(text, title) {
  const fd = new FormData();
  fd.append('manifest', JSON.stringify([{ type: 'text', text, title }]));
  const res = await fetch(API_BASE + '/api/docs/ingest-multi', { method: 'POST', body: fd });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch { /* not json */ }
    throw new Error(detail || `ingest failed (${res.status})`);
  }
  return res.json();
}

// ---- HTTP surface ----------------------------------------------------------

function corsHeaders(req) {
  const origin = req.headers.origin;
  return origin && ALLOWED_ORIGINS.has(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

function originOk(req) {
  const origin = req.headers.origin;
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function sendJson(req, res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'Content-Type': 'application/json', ...corsHeaders(req) });
  res.end(body);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (req.method === 'OPTIONS') {
      if (!originOk(req)) { res.writeHead(403); res.end(); return; }
      const headers = {
        ...corsHeaders(req),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      };
      const reqHeaders = req.headers['access-control-request-headers'];
      if (reqHeaders) headers['Access-Control-Allow-Headers'] = reqHeaders;
      // Chrome Private Network Access preflight ack (public page → localhost).
      if (req.headers['access-control-request-private-network'] === 'true') {
        headers['Access-Control-Allow-Private-Network'] = 'true';
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    if (!originOk(req)) return sendJson(req, res, 403, { error: 'origin not allowed' });

    if (req.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        try {
          const page = fs.readFileSync(UI_FILE);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(page);
        } catch {
          sendJson(req, res, 500, { error: 'index.html missing next to server.mjs' });
        }
        return;
      }
      if (url.pathname === '/api/cc/health') {
        return sendJson(req, res, 200, { ok: true, web: WEB_BASE });
      }
      if (url.pathname === '/api/cc/sessions') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '15', 10) || 15, 50);
        return sendJson(req, res, 200, { sessions: scanSessions(limit) });
      }
      return sendJson(req, res, 404, { error: 'not found' });
    }

    if (req.method === 'POST' && url.pathname === '/api/cc/teach') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { return sendJson(req, res, 400, { error: 'bad JSON body' }); }
      const f = sessionFile(parsed.dir || '', parsed.id || '');
      if (!f) return sendJson(req, res, 404, { error: 'session not found' });
      const { text, entry } = lastAssistant(f);
      if (!text) return sendJson(req, res, 404, { error: 'no assistant message in this session' });
      const title = `Claude Code · ${projectLabel(parsed.dir, entry)}`;
      try {
        const meta = await ingestToTaughtful(text, title);
        if (!meta.id) return sendJson(req, res, 502, { error: 'ingest returned no doc id' });
        return sendJson(req, res, 200, { id: meta.id, url: `${WEB_BASE}/codebridge/${meta.id}`, title });
      } catch (e) {
        return sendJson(req, res, 502, { error: `Taughtful ingest failed: ${e.message}` });
      }
    }

    sendJson(req, res, 404, { error: 'not found' });
  });
}

export function openUrl(target) {
  // Platform opener; detached so the daemon/CLI never blocks on the browser.
  const { spawn } = require_child();
  const [cmd, args] = process.platform === 'darwin' ? ['open', [target]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
    : ['xdg-open', [target]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch { /* headless environment: the printed link is the fallback */ }
}

// child_process via createRequire keeps this file ESM-clean without a top
// import that some bundlers flag for the library use-case.
import { createRequire } from 'node:module';
const require_child = () => createRequire(import.meta.url)('node:child_process');

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const srv = createServer();
  srv.listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}`;
    console.log(`Taughtful CodeBridge · ${url} · read-only, loopback-only`);
    console.log(`  sessions from: ${PROJECTS_ROOT}`);
    console.log(`  teaches via:   ${API_BASE} → ${WEB_BASE}/codebridge/<id>`);
    if (!process.argv.includes('--no-open')) setTimeout(() => openUrl(url), 400);
  });
}
