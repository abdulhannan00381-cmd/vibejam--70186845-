import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* .env optional */ }

const { db, listFaqs, addFaq, updateFaq, deleteFaq, unansweredQuestions, seedStarter, saveMessage, listMessages, clearMessages, setFeedback, stats } = await import('./db.js');
const { askModel, groundResult, isInjection, refusalFor, AI_UNAVAILABLE, MODEL, PROVIDER, PROVIDER_LABEL, keyConfigured } = await import('./ai.js');
const { CATEGORIES } = await import('./seed.js');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || '2026'; // documented local-demo fallback
const PUBLIC_DIR = path.join(root, 'public');
const project = JSON.parse(readFileSync(path.join(root, 'project.json'), 'utf8'));

// ---------- Admin sessions: random short-lived tokens, kept server-side ----------
const adminTokens = new Map(); // token -> expiry
const ADMIN_TTL = 30 * 60 * 1000;
function isAdmin(req) {
  const t = req.headers['x-admin-token'];
  const exp = t && adminTokens.get(t);
  if (!exp || exp < Date.now()) { if (t) adminTokens.delete(t); return false; }
  return true;
}
function pinMatches(pin) {
  const a = Buffer.from(String(pin)); const b = Buffer.from(ADMIN_PIN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Validation (mirrors the client) ----------
export function validateMessage(m) {
  if (typeof m !== 'string') return 'Message must be text.';
  if (m.trim().length === 0) return 'Message cannot be empty.';
  if (m.length > 300) return 'Message must be 300 characters or fewer.';
  return null;
}
export function validateFaq(f, selfId = null) {
  const errors = {};
  if (!CATEGORIES.includes(f?.category)) errors.category = 'Choose a category from the list.';
  const q = typeof f?.question === 'string' ? f.question.trim() : '';
  const a = typeof f?.answer === 'string' ? f.answer.trim() : '';
  if (q.length < 10 || q.length > 150) errors.question = 'Question must be 10–150 characters.';
  if (a.length < 10 || a.length > 400) errors.answer = 'Answer must be 10–400 characters.';
  if (!errors.question && listFaqs().some((x) => x.id !== selfId && x.question.trim().toLowerCase() === q.toLowerCase())) errors.question = 'An FAQ with this question already exists.';
  return Object.keys(errors).length ? errors : null;
}

// ---------- Tiny rate limiter for chat/admin ----------
const hits = new Map();
function limited(req, key, max) {
  const id = `${key}:${req.socket.remoteAddress}`; const now = Date.now();
  const arr = (hits.get(id) || []).filter((t) => now - t < 60_000); arr.push(now); hits.set(id, arr);
  return arr.length > max;
}

// ---------- HTTP helpers ----------
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
};
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 16_384) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    return serveStatic(req, res, '/'); // SPA fallback
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}

// ---------- Routes ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname; const m = req.method;

  if (!p.startsWith('/api/')) return serveStatic(req, res, p);

  if (p === '/api/health/' && m === 'GET') {
    db.prepare('SELECT 1').get();
    return send(res, 200, { status: 'ok', database: 'sqlite', provider: PROVIDER, model: MODEL, aiKeyConfigured: keyConfigured() });
  }
  if (p === '/api/faqs/' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const faqs = listFaqs().filter((f) => !q || `${f.id} ${f.category} ${f.question} ${f.answer}`.toLowerCase().includes(q));
    return send(res, 200, { faqs, categories: CATEGORIES });
  }
  if (p === '/api/project-info/' && m === 'GET') {
    // Demo convenience requested by the team: show the admin PIN on the About screen.
    // Set SHOW_ADMIN_PIN=false in .env to hide it (the PIN is then never sent to the browser).
    const showPin = (process.env.SHOW_ADMIN_PIN ?? 'true').toLowerCase() !== 'false';
    return send(res, 200, { ...project, llm: `${PROVIDER_LABEL} · ${MODEL}`, mockMode: PROVIDER === 'mock', ...(showPin ? { demoAdminPin: ADMIN_PIN } : {}) });
  }
  if (p === '/api/messages/' && m === 'GET') return send(res, 200, { messages: listMessages() });
  if (p === '/api/messages/' && m === 'DELETE') { clearMessages(); return send(res, 200, { ok: true }); }
  if (p === '/api/stats/' && m === 'GET') return send(res, 200, stats());

  const fb = p.match(/^\/api\/messages\/(\d+)\/feedback\/$/);
  if (fb && m === 'POST') {
    const body = await readJson(req);
    if (!['helpful', 'not_helpful', 'wrong', null].includes(body.feedback ?? null)) return send(res, 400, { error: 'Invalid feedback.' });
    return setFeedback(Number(fb[1]), body.feedback ?? null) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Not found.' });
  }

  if (p === '/api/chat/' && m === 'POST') {
    if (limited(req, 'chat', 30)) return send(res, 429, { error: 'Too many messages. Please wait a moment.' });
    const body = await readJson(req);
    const err = validateMessage(body.message);
    if (err) return send(res, 400, { error: err });
    const message = body.message.trim();

    if (isInjection(message)) {
      const user = saveMessage('user', message, 'ok');
      const bot = saveMessage('assistant', refusalFor(message), 'refused');
      return send(res, 200, { user, assistant: bot });
    }

    const faqs = listFaqs();
    let result;
    try {
      result = groundResult(await askModel(message, faqs, { urduScript: Boolean(body.urduScript) }), faqs);
    } catch (e) {
      console.warn('[chat] AI call failed:', e?.constructor?.name || 'Error', e?.status || '', String(e?.message || '').slice(0, 160)); // no secrets logged
      return send(res, 503, { error: AI_UNAVAILABLE });
    }
    // Save both turns only after a successful AI reply.
    const user = saveMessage('user', message, 'ok');
    const bot = saveMessage('assistant', result.answer, result.status, result.citations);
    return send(res, 200, { user, assistant: bot });
  }

  if (p === '/api/admin/verify-pin/' && m === 'POST') {
    if (limited(req, 'pin', 10)) return send(res, 429, { error: 'Too many attempts. Please wait a minute.' });
    const body = await readJson(req);
    if (!pinMatches(body.pin ?? '')) return send(res, 401, { error: 'Incorrect PIN' });
    const token = randomBytes(24).toString('hex');
    adminTokens.set(token, Date.now() + ADMIN_TTL);
    return send(res, 200, { token, expiresInSeconds: ADMIN_TTL / 1000 });
  }
  if (p === '/api/admin/faqs/' && m === 'POST') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin session expired. Enter the PIN again.' });
    const body = await readJson(req);
    const errors = validateFaq(body);
    if (errors) return send(res, 400, { error: 'Please fix the highlighted fields.', fields: errors });
    return send(res, 201, { faq: addFaq({ category: body.category, question: body.question.trim(), answer: body.answer.trim() }) });
  }
  const faqRoute = p.match(/^\/api\/admin\/faqs\/(FAQ-\d{2,4})\/$/);
  if (faqRoute && (m === 'PUT' || m === 'DELETE')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin session expired. Enter the PIN again.' });
    const code = faqRoute[1];
    if (!listFaqs().some((f) => f.id === code)) return send(res, 404, { error: `${code} was not found.` });
    if (m === 'DELETE') { deleteFaq(code); return send(res, 200, { ok: true, id: code }); }
    const body = await readJson(req);
    const errors = validateFaq(body, code);
    if (errors) return send(res, 400, { error: 'Please fix the highlighted fields.', fields: errors });
    return send(res, 200, { faq: updateFaq(code, { category: body.category, question: body.question.trim(), answer: body.answer.trim() }) });
  }
  if (p === '/api/admin/unanswered/' && m === 'GET') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin session expired. Enter the PIN again.' });
    return send(res, 200, { questions: unansweredQuestions() });
  }
  if (p === '/api/reset-starter-data/' && m === 'POST') {
    // Judges must be able to reset from starter data (paper §2.7); requires explicit confirm flag.
    const body = await readJson(req);
    if (body.confirm !== true) return send(res, 400, { error: 'Confirmation required.' });
    seedStarter(); clearMessages();
    return send(res, 200, { ok: true, faqs: listFaqs().length });
  }
  return send(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[server]', e?.message);
    if (!res.headersSent) send(res, e?.message === 'too large' ? 413 : 400, { error: 'Bad request.' });
  });
});
server.listen(PORT, () => console.log(`AskSE running at http://localhost:${PORT}  (provider=${PROVIDER}, model=${MODEL}, key=${keyConfigured() ? 'set' : 'MISSING'})`));
export default server;
