import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { STARTER_FAQS } from './seed.js';

const dbFile = process.env.DB_FILE || path.join(process.cwd(), 'data', 'askse.db');
if (dbFile !== ':memory:') mkdirSync(path.dirname(dbFile), { recursive: true });
export const db = new DatabaseSync(dbFile);

db.exec(`
CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_seeded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,            -- 'user' | 'assistant'
  content TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'ok' | 'found' | 'not_found' | 'refused'
  citations TEXT NOT NULL DEFAULT '[]',
  feedback TEXT,                 -- null | 'helpful' | 'not_helpful' | 'wrong'
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

export function seedStarter() {
  db.exec('DELETE FROM faqs');
  const ins = db.prepare('INSERT INTO faqs (code, category, question, answer, is_seeded, created_at) VALUES (?, ?, ?, ?, 1, ?)');
  const now = new Date().toISOString();
  for (const f of STARTER_FAQS) ins.run(f.code, f.category, f.question, f.answer, now);
  db.prepare("INSERT INTO meta (key, value) VALUES ('faq_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(STARTER_FAQS.length));
}

// First run: seed once.
const seeded = db.prepare("SELECT value FROM meta WHERE key='seeded'").get();
if (!seeded) {
  seedStarter();
  db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1')").run();
}

export const listFaqs = () => db.prepare('SELECT code AS id, category, question, answer, is_seeded FROM faqs ORDER BY id').all();

// High-water mark: deleted IDs are never reused, so old chat citations never point at a different FAQ.
function nextFaqCode() {
  const rows = db.prepare('SELECT code FROM faqs').all();
  const maxExisting = rows.reduce((m, r) => Math.max(m, parseInt(r.code.replace('FAQ-', ''), 10) || 0), 0);
  const seq = Number(db.prepare("SELECT value FROM meta WHERE key='faq_seq'").get()?.value || 0);
  const next = Math.max(seq, maxExisting) + 1;
  db.prepare("INSERT INTO meta (key, value) VALUES ('faq_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(next));
  return `FAQ-${String(next).padStart(2, '0')}`;
}

export function updateFaq(code, { category, question, answer }) {
  const r = db.prepare('UPDATE faqs SET category = ?, question = ?, answer = ? WHERE code = ?').run(category, question, answer, code);
  return r.changes ? listFaqs().find((f) => f.id === code) : null;
}

export const deleteFaq = (code) => db.prepare('DELETE FROM faqs WHERE code = ?').run(code).changes > 0;

// Questions the bot could not answer (user turn immediately followed by a not_found reply).
export const unansweredQuestions = () => db.prepare(`
  SELECT u.id, u.content AS question, u.created_at FROM messages u
  JOIN messages a ON a.id = u.id + 1
  WHERE u.role = 'user' AND a.status = 'not_found'
  ORDER BY u.id DESC LIMIT 50`).all();

export function addFaq({ category, question, answer }) {
  const code = nextFaqCode();
  db.prepare('INSERT INTO faqs (code, category, question, answer, is_seeded, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .run(code, category, question, answer, new Date().toISOString());
  return { id: code, category, question, answer, is_seeded: 0 };
}

export function saveMessage(role, content, status, citations = []) {
  const created_at = new Date().toISOString();
  const r = db.prepare('INSERT INTO messages (role, content, status, citations, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(role, content, status, JSON.stringify(citations), created_at);
  return { id: Number(r.lastInsertRowid), role, content, status, citations, feedback: null, created_at };
}

export const listMessages = () => db.prepare('SELECT * FROM messages ORDER BY id').all()
  .map((m) => ({ ...m, citations: JSON.parse(m.citations) }));

export const clearMessages = () => db.exec('DELETE FROM messages');

export function setFeedback(id, feedback) {
  return db.prepare("UPDATE messages SET feedback = ? WHERE id = ? AND role = 'assistant'").run(feedback, id).changes;
}

export function stats() {
  const q = (sql) => db.prepare(sql).get().n;
  const asked = q("SELECT COUNT(*) n FROM messages WHERE role='user'");
  const answered = q("SELECT COUNT(*) n FROM messages WHERE role='assistant' AND status='found'");
  const notFound = q("SELECT COUNT(*) n FROM messages WHERE role='assistant' AND status='not_found'");
  const refused = q("SELECT COUNT(*) n FROM messages WHERE role='assistant' AND status='refused'");
  const counts = {};
  for (const m of listMessages()) for (const c of m.citations) counts[c] = (counts[c] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null;
  const notHelpful = q("SELECT COUNT(*) n FROM messages WHERE feedback IN ('not_helpful','wrong')");
  return { asked, answered, notFound, refused, notHelpful, mostCited: top ? { id: top[0], count: top[1] } : null };
}
