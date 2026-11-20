import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The app's own AI prompt lives in this file:
export const SYSTEM_PROMPT = readFileSync(path.join(here, 'ai', 'askse_system_prompt.txt'), 'utf8');

export const NOT_FOUND = 'Sorry, I could not find this in the department FAQ. Please email helpdesk@se.example.edu or visit Room 210.';
export const AI_UNAVAILABLE = 'AI service unavailable. Please try again.';
export const AI_TIMEOUT_MS = 30_000;

export const PROVIDER = process.env.AI_PROVIDER || 'anthropic';
export const MODEL = process.env.LLM_MODEL || (PROVIDER === 'groq' ? 'openai/gpt-oss-120b' : 'claude-opus-5-5');
export const PROVIDER_LABEL = { groq: 'Groq', anthropic: 'Anthropic Claude API', mock: 'Development mock' }[PROVIDER] || PROVIDER;
export const keyConfigured = () => PROVIDER === 'mock' || Boolean(PROVIDER === 'groq' ? process.env.GROQ_API_KEY : process.env.ANTHROPIC_API_KEY);

// JSON schema the model must follow (structured outputs).
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    answer: { type: 'string' },
    faq_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['found', 'answer', 'faq_ids'],
  additionalProperties: false,
};

// ---------- Prompt-injection guard (deterministic, runs before the LLM) ----------
const INJECTION = [
  /system\s*prompt/i, /api[\s_-]*key/i, /\b(env(ironment)?\s*var(iable)?s?|\.env file)\b/i, /(your|the)\s+(secret|hidden)\s+(key|instructions|rules)/i,
  /ignore\s+(all\s+)?(previous|prior|above|your)\s+(instructions|rules|prompt)/i,
  /\b(you are now|act as|pretend (to be|you are)|roleplay|jailbreak|developer mode|DAN)\b/i,
  /(reveal|show|print|repeat|tell me)\s+(me\s+)?(your|the)\s+(instructions|rules|prompt|configuration)/i,
  /forget\s+(your|all|previous)\s+(rules|instructions)/i,
  /from now on,?\s+(you('re| are)|act|behave|be)\b/i, /\b(change|switch)\s+your\s+role\b/i,
];
export const isInjection = (text) => INJECTION.some((r) => r.test(text));

export function refusalFor(text) {
  if (/[؀-ۿ]/.test(text)) return 'معذرت، میں اپنی اندرونی ہدایات یا خفیہ معلومات شیئر نہیں کر سکتا اور نہ ہی اپنا کردار بدل سکتا ہوں۔ میں صرف ڈیپارٹمنٹ FAQ سے متعلق سوالات کے جواب دیتا ہوں۔';
  if (/\b(mujhe|batao|kya|hai|apna|apni|karo|bata)\b/i.test(text)) return 'Maazrat, main apni internal hidayat ya secret maloomat share nahi kar sakta aur na hi apna role badal sakta hoon. Main sirf department FAQ ke sawalat ka jawab deta hoon.';
  return "Sorry, I can't share my internal instructions or any secrets, and I can't change my role. I can only answer questions from the department FAQ.";
}

// ---------- Validate model output: never trust it ----------
export function parseModelJson(raw) {
  let t = String(raw || '').trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1];
  const obj = JSON.parse(t); // throws on malformed -> treated as AI failure
  const keys = Object.keys(obj).sort().join(',');
  if (keys !== 'answer,faq_ids,found') throw new Error('unexpected keys');
  if (typeof obj.found !== 'boolean' || typeof obj.answer !== 'string' || !Array.isArray(obj.faq_ids)) throw new Error('bad types');
  return obj;
}

// Turn validated model JSON into what the user sees.
export function groundResult(obj, faqs) {
  const known = new Set(faqs.map((f) => f.id));
  const ids = [...new Set(obj.faq_ids.map((x) => String(x).trim().toUpperCase()))].filter((id) => known.has(id));
  if (!obj.found || ids.length === 0 || !obj.answer.trim()) {
    return { status: 'not_found', answer: NOT_FOUND, citations: [] };
  }
  return { status: 'found', answer: obj.answer.trim(), citations: ids };
}

// Deterministic language hint so the model reliably mirrors the user's language.
const ROMAN_URDU = /\b(kya|kab|kitni|kitne|kitna|kaise|kahan|kaun|hai|hain|ho|hota|hoti|hote|ko|ka|ki|ke|mein|main|mujhe|karna|karni|chahiye|zaroori|zaruri|batao|bataen|sakta|sakti|sakte|nahi|kar|se|tak|wala|wali)\b/gi;
export function detectLanguage(text) {
  if (/[؀-ۿ]/.test(text)) return 'Urdu script';
  return (text.match(ROMAN_URDU) || []).length >= 2 ? 'Roman Urdu' : 'English';
}

function buildUserContent(question, faqs, urduScript) {
  const faqText = faqs.map((f) => `<faq id="${f.id}" category="${f.category}">\nQ: ${f.question}\nA: ${f.answer}\n</faq>`).join('\n');
  const lang = urduScript ? 'Urdu script (اردو) — the user switched on Urdu-script replies' : detectLanguage(question);
  const extra = `\n<reply_language>${lang}</reply_language>`;
  return `<faqs>\n${faqText}\n</faqs>${extra}\n<user_question>\n${question}\n</user_question>`;
}

// ---------- Provider adapter ----------
async function callAnthropic(question, faqs, urduScript) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: AI_TIMEOUT_MS, maxRetries: 0 });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
    messages: [{ role: 'user', content: buildUserContent(question, faqs, urduScript) }],
  });
  if (response.stop_reason === 'refusal') return { found: false, answer: '', faq_ids: [] };
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseModelJson(text);
}

// Groq (OpenAI-compatible Chat Completions API). JSON mode + low temperature.
async function callGroq(question, faqs, urduScript, attempt = 0) {
  const started = Date.now();
  const res = await fetch(process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 2000,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserContent(question, faqs, urduScript) },
      ],
    }),
  });
  // Free-tier rate limit: retry once after the server-suggested wait (stays inside the 30 s budget).
  if (res.status === 429 && attempt === 0) {
    const wait = Math.min(Number(res.headers.get('retry-after') || 3), 8) * 1000;
    if (Date.now() - started + wait < AI_TIMEOUT_MS - 10_000) {
      await new Promise((r) => setTimeout(r, wait));
      return callGroq(question, faqs, urduScript, 1);
    }
  }
  if (!res.ok) {
    let detail = ''; try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`groq http ${res.status} ${detail}`.slice(0, 200));
  }
  const data = await res.json();
  return parseModelJson(data?.choices?.[0]?.message?.content);
}

// DEVELOPMENT/TEST ONLY: deterministic stand-in used by automated tests (AI_PROVIDER=mock).
// Never used in the demo; the UI shows a warning banner if it is active.
async function callMock(question, faqs) {
  if (question.includes('__timeout__')) await new Promise((r) => setTimeout(r, AI_TIMEOUT_MS + 1000));
  if (question.includes('__fail__')) throw new Error('mock failure');
  const q = question.toLowerCase();
  const hit = faqs.find((f) => f.question.toLowerCase().split(/\W+/).filter((w) => w.length > 4).some((w) => q.includes(w)));
  return hit ? { found: true, answer: hit.answer, faq_ids: [hit.id] } : { found: false, answer: '', faq_ids: [] };
}

export async function askModel(question, faqs, { urduScript = false } = {}) {
  const call = PROVIDER === 'mock' ? callMock(question, faqs)
    : PROVIDER === 'groq' ? callGroq(question, faqs, urduScript)
    : callAnthropic(question, faqs, urduScript);
  // Hard 30 s ceiling on the whole call, independent of SDK behaviour.
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), AI_TIMEOUT_MS); });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
