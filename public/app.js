// AskSE front-end (vanilla JS, no build step).
const AI_UNAVAILABLE = 'AI service unavailable. Please try again.';
const MAX = 300;
const $ = (s) => document.querySelector(s);
const state = { faqs: [], categories: [], messages: [], sending: false, adminToken: sessionStorage.getItem('askse_admin') || null };

// ---------- helpers ----------
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(state.adminToken ? { 'X-Admin-Token': state.adminToken } : {}) }, ...opts });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    return { ok: false, status: 0, data: { error: 'You appear to be offline. Please check the connection.' } }; // offline: never crash
  }
  let data = {}; try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
const isRtl = (t) => /[؀-ۿ]/.test(t);

// ---------- icons (static, trusted strings) ----------
const ICONS = {
  Labs: '<path d="M4 5h16v10H4zM9 19h6M12 15v4"/>',
  Academics: '<path d="M3 9l9-4 9 4-9 4zM7 11v4c3 2 7 2 10 0v-4"/>',
  Library: '<path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h9"/>',
  Exams: '<path d="M8 3h8v3H8zM6 5h12v16H6zM9 13l2 2 4-4"/>',
  Fees: '<path d="M3 6h18v12H3zM3 10h18M7 15h3"/>',
  Projects: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  Transport: '<path d="M5 4h14v12H5zM5 10h14M8 19v-3M16 19v-3M8 13h.01M16 13h.01"/>',
  Help: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M15 9l3.5-3.5M9 15l-3.5 3.5M15 15l3.5 3.5M9 9L5.5 5.5"/>',
  asked: '<path d="M4 5h16v11H9l-5 4z"/>',
  answered: '<path d="M5 12l4 4L19 7"/>',
  notFound: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M9 9l4 4M13 9l-4 4"/>',
  refused: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};
function icon(name, cls = 'ico-badge') {
  const s = el('span', { class: cls, 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] || ICONS.Help}</svg>`;
  return s;
}

// ---------- card micro-interactions: cursor spotlight + subtle 3D tilt ----------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
if (finePointer) {
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest?.('.fx'); if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--mx', `${x * 100}%`); card.style.setProperty('--my', `${y * 100}%`);
    if (!reduceMotion && !card.classList.contains('card')) {
      card.style.setProperty('--rx', `${(0.5 - y) * 5}deg`); card.style.setProperty('--ry', `${(x - 0.5) * 6}deg`);
    }
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const card = e.target.closest?.('.fx');
    if (card && !card.contains(e.relatedTarget)) { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); }
  });
}
function countUp(node, to, suffix = '') {
  if (reduceMotion || !Number.isFinite(to)) { node.textContent = `${to}${suffix}`; return; }
  const start = performance.now(), dur = 900;
  const tick = (t) => { const k = Math.min(1, (t - start) / dur); node.textContent = `${Math.round(to * (1 - Math.pow(1 - k, 3)))}${suffix}`; if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
const fmtTime = (iso) => new Date(iso).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
function confirmDialog(title, text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const d = $('#confirm'); $('#confirmTitle').textContent = title; $('#confirmText').textContent = text; $('#confirmOk').textContent = okLabel;
    d.returnValue = 'cancel';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal(); $('#confirmCancel').focus();
  });
}
function openFaq(id) {
  const f = state.faqs.find((x) => x.id === id);
  if (!f) return toast(`${id} is no longer in the FAQ list.`);
  $('#faqDlgMeta').textContent = `${f.id} · ${f.category}`; $('#faqDlgQ').textContent = f.question; $('#faqDlgA').textContent = f.answer;
  $('#faqDialog').showModal();
}

// ---------- navigation ----------
const TITLES = {
  chat: ['AskSE Help Desk', 'Answers from the Software Engineering department FAQ'],
  faqs: ['FAQ list', 'The knowledge base AskSE answers from'],
  stats: ['Stats', 'How AskSE has been used'],
  admin: ['Admin', 'PIN-protected FAQ management'],
  about: ['About AskSE', 'Team, project and AI details'],
};
function show(view) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  [$('#viewTitle').textContent, $('#viewSub').textContent] = TITLES[view];
  $('#chatTools').hidden = view !== 'chat';
  state.view = view;
  closeDrawer();
  if (view === 'faqs') renderFaqs();
  if (view === 'stats') loadStats();
  if (view === 'admin' && state.adminToken) { renderManage(); loadInbox(); }
  if (view === 'chat') $('#input').focus();
}
document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
function openDrawer() { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; $('#menuBtn').setAttribute('aria-expanded', 'true'); }
function closeDrawer() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); }
$('#menuBtn').addEventListener('click', openDrawer);
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

// ---------- settings ----------
function applyTheme(dark) { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }
const savedDark = store.get('askse_dark');
$('#darkToggle').checked = savedDark === '1' || (savedDark === null && matchMedia('(prefers-color-scheme: dark)').matches);
applyTheme($('#darkToggle').checked);
$('#darkToggle').addEventListener('change', (e) => { applyTheme(e.target.checked); store.set('askse_dark', e.target.checked ? '1' : '0'); });
$('#urduToggle').checked = store.get('askse_urdu') === '1';
$('#urduToggle').addEventListener('change', (e) => store.set('askse_urdu', e.target.checked ? '1' : '0'));
$('#speakToggle').checked = store.get('askse_speak') === '1';
$('#speakToggle').addEventListener('change', (e) => { store.set('askse_speak', e.target.checked ? '1' : '0'); if (!e.target.checked) speechSynthesis?.cancel(); });
function speak(text) {
  if (!$('#speakToggle').checked || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text); u.lang = isRtl(text) ? 'ur-PK' : 'en-US';
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// ---------- chat rendering ----------
const messagesEl = $('#messages');
const nearBottom = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
const scrollDown = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };

// Feature: typewriter reveal for fresh answers (word by word, respects reduced motion)
function typewrite(node, text) {
  if (reduceMotion) { node.textContent = text; return; }
  const words = text.split(/(\s+)/); let i = 0;
  node.textContent = ''; node.classList.add('typing-caret');
  const step = () => {
    i = Math.min(words.length, i + 2); node.textContent = words.slice(0, i).join('');
    if (nearBottom()) scrollDown();
    if (i < words.length) setTimeout(step, 28); else node.classList.remove('typing-caret');
  };
  step();
}
// Feature: copy answer
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = el('textarea', {}, text); document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  btn.classList.add('done'); btn.querySelector('span').textContent = 'Copied'; toast('Answer copied.');
  setTimeout(() => { btn.classList.remove('done'); btn.querySelector('span').textContent = 'Copy'; }, 1600);
}
function miniBtn(iconName, label, onclick, extra = {}) {
  const b = el('button', { class: 'fb mini', type: 'button', onclick, ...extra }, icon(iconName, 'mini-ico'), el('span', {}, label));
  return b;
}
// Feature: related questions (ranked by word overlap with the question + answer, excluding cited FAQs)
const STOP = new Set('the a an and or of to in is are for on at do i my can what when who how if with be by from this that it there'.split(' '));
const words = (s) => new Set(s.toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter((w) => w.length > 2 && !STOP.has(w)));
function relatedFaqs(text, exclude) {
  const q = words(text);
  return state.faqs.filter((f) => !exclude.includes(f.id))
    .map((f) => { const w = words(`${f.question} ${f.category}`); let s = 0; for (const x of w) if (q.has(x)) s++; return { f, s }; })
    .sort((a, b) => b.s - a.s || a.f.id.localeCompare(b.f.id)).slice(0, 3).map((x) => x.f);
}
function refreshRelated() {
  messagesEl.querySelectorAll('.related').forEach((n) => n.remove());
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== 'assistant' || last.status === 'refused') return;
  const prevUser = state.messages[state.messages.length - 2];
  const items = relatedFaqs(`${prevUser?.content || ''} ${last.content}`, last.citations || []);
  if (!items.length) return;
  const node = messagesEl.querySelector(`.msg[data-id="${last.id}"]`); if (!node) return;
  node.append(el('div', { class: 'related', role: 'group', 'aria-label': 'Related questions' },
    el('span', { class: 'related-label' }, last.status === 'found' ? 'You might also ask' : 'Try one of these instead'),
    items.map((f) => el('button', { class: 'related-chip', type: 'button', onclick: () => { input.value = f.question; updateComposer(); send(); } }, icon(f.category, 'mini-ico'), f.question))));
}

function messageNode(m, { fresh = false, latencyMs = null } = {}) {
  const isUser = m.role === 'user';
  const node = el('div', { class: `msg ${isUser ? 'user' : 'bot'} ${m.status || ''}`, 'data-id': m.id });
  const bubble = el('div', { class: 'bubble', dir: isRtl(m.content) ? 'rtl' : 'auto' }, fresh && !isUser ? '' : m.content);
  node.append(bubble);
  if (fresh && !isUser) typewrite(bubble, m.content);

  // Feature: show source — the exact FAQ text behind the answer
  let sourcePanel = null;
  if (!isUser && m.citations?.length) {
    sourcePanel = el('div', { class: 'source', hidden: true, id: `src-${m.id}` },
      m.citations.map((c) => { const f = state.faqs.find((x) => x.id === c);
        return el('div', { class: 'source-item' }, el('span', { class: 'tag' }, c),
          f ? el('div', {}, el('strong', {}, f.question), el('p', {}, f.answer)) : el('p', {}, 'This FAQ has since been removed.')); }));
  }
  const meta = el('div', { class: 'meta' });
  if (!isUser) {
    for (const c of m.citations || []) meta.append(el('button', { class: 'chip-cite', type: 'button', title: `Open ${c}`, onclick: () => openFaq(c) }, `[${c}]`));
  }
  meta.append(el('time', { datetime: m.created_at }, fmtTime(m.created_at)));
  if (latencyMs != null) meta.append(el('span', { class: 'latency', title: 'Response time' }, `${(latencyMs / 1000).toFixed(1)}s`));
  if (!isUser) {
    if (sourcePanel) {
      const srcBtn = miniBtn('Library', 'Source', () => {
        sourcePanel.hidden = !sourcePanel.hidden; srcBtn.setAttribute('aria-expanded', String(!sourcePanel.hidden)); srcBtn.classList.toggle('on', !sourcePanel.hidden);
      }, { 'aria-expanded': 'false', 'aria-controls': `src-${m.id}` });
      meta.append(srcBtn);
    }
    const cp = miniBtn('copy', 'Copy', () => copyText(m.content, cp), { 'aria-label': 'Copy answer' });
    meta.append(cp);
    const fbBtn = (value, label) => el('button', { class: `fb ${m.feedback === value ? 'on' : ''}`, type: 'button', 'aria-pressed': String(m.feedback === value), onclick: () => sendFeedback(m, value) }, label);
    meta.append(fbBtn('helpful', 'Helpful'), fbBtn('not_helpful', 'Not helpful'), fbBtn('wrong', 'Wrong answer'));
  }
  node.append(meta);
  if (sourcePanel) node.append(sourcePanel);
  return node;
}
function renderMessages() {
  messagesEl.querySelectorAll('.msg').forEach((n) => n.remove());
  $('#welcome').hidden = state.messages.length > 0;
  for (const m of state.messages) messagesEl.append(messageNode(m));
  refreshRelated(); applySearch();
  if (state.messages.length) scrollDown(); else messagesEl.scrollTop = 0; // welcome reads from the top
}
async function sendFeedback(m, value) {
  const next = m.feedback === value ? null : value;
  const r = await api(`/api/messages/${m.id}/feedback/`, { method: 'POST', body: JSON.stringify({ feedback: next }) });
  if (!r.ok) return toast('Could not save feedback.');
  m.feedback = next;
  messagesEl.querySelector(`.msg[data-id="${m.id}"]`)?.replaceWith(messageNode(m));
  refreshRelated();
  toast(next ? 'Thanks for the feedback.' : 'Feedback removed.');
}

// ---------- composer ----------
const input = $('#input');
function updateComposer() {
  const len = input.value.length; const over = len > MAX;
  $('#counter').textContent = `${len}/${MAX}`; $('#counter').classList.toggle('over', over);
  $('#composer').classList.toggle('over', over);
  $('#hint').textContent = over ? `Too long — ${len - MAX} characters over the 300 limit.` : 'Enter to send · Shift+Enter for a new line';
  $('#sendBtn').disabled = state.sending || input.value.trim().length === 0 || over;
  input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}
input.addEventListener('input', updateComposer);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });

function clearTransient() { messagesEl.querySelectorAll('.transient').forEach((n) => n.remove()); }

async function send(text = input.value) {
  if (state.sending) return;
  const msg = text;
  if (msg.trim().length === 0 || msg.length > MAX) { updateComposer(); return; } // never send invalid
  state.sending = true; updateComposer(); clearTransient();
  $('#welcome').hidden = true;
  const pending = el('div', { class: 'msg user transient' }, el('div', { class: 'bubble', dir: isRtl(msg) ? 'rtl' : 'auto' }, msg.trim()), el('div', { class: 'meta' }, 'Sending…'));
  const typing = el('div', { class: 'msg bot typing transient', 'aria-label': 'AskSE is answering' }, el('div', { class: 'bubble' }, el('span', { class: 'dot' }), el('span', { class: 'dot' }), el('span', { class: 'dot' }), el('em', {}, 'Checking the FAQ…')));
  messagesEl.append(pending, typing); scrollDown();

  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 35_000);
  const started = performance.now();
  let r;
  try {
    r = await api('/api/chat/', { method: 'POST', body: JSON.stringify({ message: msg, urduScript: $('#urduToggle').checked }), signal: ctrl.signal });
  } catch { r = { ok: false, status: 0, data: {} }; }
  clearTimeout(t);
  typing.remove();
  state.sending = false;

  if (r.ok) {
    pending.remove();
    state.messages.push(r.data.user, r.data.assistant);
    messagesEl.append(messageNode(r.data.user), messageNode(r.data.assistant, { fresh: true, latencyMs: performance.now() - started }));
    refreshRelated(); applySearch();
    scrollDown();
    if (input.value === text) input.value = '';
    speak(r.data.assistant.content);
  } else if (r.status === 400 || r.status === 429) {
    pending.remove();
    toast(r.data.error || 'Message not sent.');
    if (!state.messages.length) $('#welcome').hidden = false;
  } else {
    // AI failure: keep earlier chat AND the typed text; offer retry.
    pending.querySelector('.meta').textContent = 'Not sent';
    const err = el('div', { class: 'msg error transient', role: 'alert' },
      el('div', { class: 'bubble' }, AI_UNAVAILABLE),
      el('div', { class: 'meta' }, el('button', { class: 'btn ghost small retry', type: 'button', onclick: () => send(msg) }, 'Retry')));
    messagesEl.append(err); scrollDown();
    input.value = msg;
  }
  updateComposer();
  input.focus();
}

// Suggested-question chips (taken from the starter FAQs only).
const SUGGESTED = ['When is CS-LAB-102A open?', 'What is the attendance requirement?', 'Library kab band hoti hai Friday ko?', 'When do the university buses leave?', 'How do I submit my FYP proposal?', 'فیس کی آخری تاریخ کیا ہے؟'];
const TOPICS = [
  { cat: 'Labs', title: 'Lab hours', sub: 'CS-LAB-102A timings & rules', q: 'When is CS-LAB-102A open, and can I eat there?' },
  { cat: 'Academics', title: 'Attendance', sub: 'The minimum you need', q: 'What is the attendance requirement?' },
  { cat: 'Fees', title: 'Fee deadline', sub: 'Spring 2027 challan', q: 'When is the Spring 2027 fee due?' },
  { cat: 'Transport', title: 'Bus times', sub: 'When buses leave campus', q: 'When do the university buses leave?' },
];
function renderTopics() {
  const t = $('#topics'); t.replaceChildren();
  TOPICS.forEach((x, i) => {
    const go = el('span', { class: 'go', 'aria-hidden': 'true' }); go.innerHTML = `<svg viewBox="0 0 24 24">${ICONS.arrow}</svg>`;
    t.append(el('button', { class: 'topic fx', type: 'button', style: `--i:${i + 2}`, 'aria-label': `Ask: ${x.q}`, onclick: () => { input.value = x.q; updateComposer(); send(); } },
      icon(x.cat), el('div', {}, el('strong', {}, x.title), el('span', {}, x.sub)), go));
  });
}
function renderChips() {
  const c = $('#chips'); c.replaceChildren();
  for (const q of SUGGESTED) c.append(el('button', { class: 'chip', type: 'button', dir: 'auto', onclick: () => { input.value = q; updateComposer(); send(); } }, q));
}

$('#clearBtn').addEventListener('click', async () => {
  if (!state.messages.length && !messagesEl.querySelector('.transient')) return toast('Chat is already empty.');
  const ok = await confirmDialog('Clear chat?', 'This deletes all chat messages. FAQs are not affected.', 'Clear chat');
  if (!ok) return toast('Chat kept.');
  const r = await api('/api/messages/', { method: 'DELETE' });
  if (!r.ok) return toast('Could not clear chat.');
  state.messages = []; clearTransient(); renderMessages(); toast('Chat cleared.');
});

// ---------- voice input ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('#micBtn').hidden = true;
else {
  let rec = null;
  $('#micBtn').addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
    $('#micBtn').classList.add('listening');
    rec.onresult = (e) => { input.value = Array.from(e.results).map((r) => r[0].transcript).join(' ').slice(0, 400); updateComposer(); };
    rec.onerror = () => toast('Voice input is not available right now.');
    rec.onend = () => { rec = null; $('#micBtn').classList.remove('listening'); input.focus(); };
    rec.start();
  });
}

// ---------- FAQ list ----------
function renderFaqs() {
  const q = $('#faqSearch').value.trim().toLowerCase();
  const list = $('#faqList'); list.replaceChildren();
  const shown = state.faqs.filter((f) => !q || `${f.id} ${f.category} ${f.question} ${f.answer}`.toLowerCase().includes(q));
  if (!shown.length) return list.append(el('p', { class: 'empty' }, 'No FAQs match your search.'));
  let i = 0;
  for (const cat of state.categories) {
    const items = shown.filter((f) => f.category === cat);
    if (!items.length) continue;
    list.append(el('div', { class: 'faq-group' }, el('h3', {}, cat), items.map((f) => el('article', { class: 'faq fx', style: `--i:${i++}` },
      icon(f.category),
      el('div', { class: 'faq-head' }, el('span', { class: 'tag' }, f.id), el('span', { class: 'tag grey' }, f.category), f.is_seeded ? null : el('span', { class: 'tag grey' }, 'Added by admin')),
      el('p', { class: 'q' }, f.question), el('p', { class: 'a' }, f.answer),
      el('button', { class: 'btn ghost small ask', type: 'button', onclick: () => { show('chat'); input.value = f.question; updateComposer(); input.focus(); } }, 'Ask this', icon('arrow', 'ask-ico'))))));
  }
}
$('#faqSearch').addEventListener('input', renderFaqs);
async function loadFaqs() {
  const r = await api('/api/faqs/');
  if (r.ok) { state.faqs = r.data.faqs; state.categories = r.data.categories; $('#faqCount').textContent = state.faqs.length; fillCategories(); }
}

// ---------- stats ----------
async function loadStats() {
  const r = await api('/api/stats/'); const g = $('#statGrid'); g.replaceChildren();
  if (!r.ok) return g.append(el('p', { class: 'empty' }, 'Could not load stats.'));
  const s = r.data;
  const rate = s.asked ? Math.round((s.answered / s.asked) * 100) : 0;
  const pct = (n) => (s.asked ? Math.round((n / s.asked) * 100) : 0);

  // Hero tile: answer-rate ring
  const ringNum = el('b', {}, '0');
  const ring = el('div', { class: 'ring', role: 'img', 'aria-label': `${rate}% of questions answered from the FAQ` }, ringNum);
  g.append(el('div', { class: 'stat hero fx', style: '--i:0' }, ring,
    el('div', {}, el('h3', {}, 'Answer rate'), el('p', {}, `${s.answered} of ${s.asked} questions were answered directly from the department FAQ.`))));
  requestAnimationFrame(() => { ring.style.setProperty('--p', rate); });
  countUp(ringNum, rate, '%');

  const tile = (i, ico, label, value, barPct, extraCls = '') => {
    const num = el('b', {}, typeof value === 'number' ? '0' : value);
    const bar = barPct == null ? null : el('div', { class: 'bar' }, el('i', {}));
    const node = el('div', { class: `stat fx ${extraCls}`, style: `--i:${i}` },
      el('div', { class: 'stat-top' }, el('span', {}, label), icon(ico)), num, bar);
    if (typeof value === 'number') countUp(num, value);
    if (bar) requestAnimationFrame(() => requestAnimationFrame(() => { bar.firstChild.style.width = `${barPct}%`; }));
    return node;
  };
  g.append(
    tile(1, 'asked', 'Questions asked', s.asked, null),
    tile(2, 'answered', 'Answered', s.answered, pct(s.answered)),
    tile(3, 'notFound', 'Not found', s.notFound, pct(s.notFound)),
    tile(4, 'refused', 'Refused (safety)', s.refused, pct(s.refused)),
    tile(5, 'star', 'Most-cited FAQ', s.mostCited ? `${s.mostCited.id} · ${s.mostCited.count}×` : '—', null, 'wide'),
    tile(6, 'flag', 'Marked not helpful / wrong', s.notHelpful, null, 'wide'),
  );
}

// ---------- admin ----------
function setAdmin(unlocked) {
  $('#pinForm').hidden = unlocked;
  for (const id of ['#faqForm', '#inboxCard', '#manageCard']) $(id).hidden = !unlocked;
  if (unlocked) { renderManage(); loadInbox(); } else exitEdit();
}
function adminExpired(r) {
  if (r.status !== 401) return false;
  state.adminToken = null; sessionStorage.removeItem('askse_admin'); setAdmin(false);
  $('#pinError').textContent = r.data.error || 'Admin session expired. Enter the PIN again.';
  return true;
}

// Feature: edit mode for the FAQ form
let editingId = null;
function enterEdit(f) {
  editingId = f.id;
  $('#faqFormTitle').textContent = `Edit ${f.id}`;
  $('#faqFormHint').textContent = 'Changes apply to the AI immediately. Citations keep the same ID.';
  $('#fCategory').value = f.category; $('#fQuestion').value = f.question; $('#fAnswer').value = f.answer;
  $('#addBtn').textContent = 'Save changes'; $('#cancelEditBtn').hidden = false;
  counterFor($('#fQuestion'), $('#qCount'), 10, 150); counterFor($('#fAnswer'), $('#aCount'), 10, 400);
  $('#faqForm').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); $('#fQuestion').focus();
}
function exitEdit() {
  editingId = null;
  $('#faqFormTitle').textContent = 'Add a FAQ';
  $('#faqFormHint').textContent = 'New FAQs get the next ID automatically and are used by the AI immediately.';
  $('#faqForm').reset(); $('#addBtn').textContent = 'Add FAQ'; $('#cancelEditBtn').hidden = true;
  $('#qCount').textContent = '0/150'; $('#aCount').textContent = '0/400';
  document.querySelectorAll('[data-err]').forEach((p) => (p.textContent = ''));
}
$('#cancelEditBtn').addEventListener('click', exitEdit);

// Feature: manage (edit / delete) list
function renderManage() {
  const ul = $('#manageList'); ul.replaceChildren(); $('#manageCount').textContent = state.faqs.length;
  for (const f of state.faqs) {
    ul.append(el('li', { class: 'admin-item' },
      icon(f.category),
      el('div', { class: 'admin-text' }, el('strong', {}, `${f.id} · ${f.category}`), el('span', {}, f.question)),
      el('div', { class: 'admin-actions' },
        el('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Edit ${f.id}`, onclick: () => enterEdit(f) }, 'Edit'),
        el('button', { class: 'btn ghost small danger-text', type: 'button', 'aria-label': `Delete ${f.id}`, onclick: () => removeFaq(f) }, 'Delete'))));
  }
}
async function removeFaq(f) {
  const ok = await confirmDialog(`Delete ${f.id}?`, `“${f.question}” will be removed and the AI will stop using it. Its ID will not be reused.`, 'Delete');
  if (!ok) return;
  const r = await api(`/api/admin/faqs/${f.id}/`, { method: 'DELETE' });
  if (adminExpired(r)) return;
  if (!r.ok) return toast(r.data.error || 'Could not delete FAQ.');
  if (editingId === f.id) exitEdit();
  await loadFaqs(); renderManage(); toast(`Deleted ${f.id}.`);
}

// Feature: unanswered-questions inbox
async function loadInbox() {
  const r = await api('/api/admin/unanswered/');
  if (adminExpired(r) || !r.ok) return;
  const ul = $('#inboxList'); ul.replaceChildren(); $('#inboxCount').textContent = r.data.questions.length;
  if (!r.data.questions.length) { ul.append(el('li', { class: 'empty' }, 'No unanswered questions yet. Nice.')); return; }
  for (const q of r.data.questions) {
    ul.append(el('li', { class: 'admin-item' },
      icon('notFound'),
      el('div', { class: 'admin-text' }, el('strong', { dir: 'auto' }, q.question), el('span', {}, fmtTime(q.created_at))),
      el('div', { class: 'admin-actions' },
        el('button', { class: 'btn primary small', type: 'button', onclick: () => {
          exitEdit(); $('#fQuestion').value = q.question.slice(0, 150); counterFor($('#fQuestion'), $('#qCount'), 10, 150);
          $('#faqForm').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); $('#fCategory').focus();
          toast('Question copied into the form. Pick a category and write the answer.');
        } }, 'Create FAQ'))));
  }
}
function fillCategories() {
  const s = $('#fCategory'); const cur = s.value; s.replaceChildren(el('option', { value: '' }, 'Select a category…'), ...state.categories.map((c) => el('option', { value: c }, c))); s.value = cur;
}
$('#pinForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#pinError').textContent = '';
  const r = await api('/api/admin/verify-pin/', { method: 'POST', body: JSON.stringify({ pin: $('#pin').value }) });
  $('#pin').value = '';
  if (r.status === 401) { $('#pinError').textContent = 'Incorrect PIN'; $('#pin').focus(); return; }
  if (!r.ok) { $('#pinError').textContent = r.data.error || 'Could not verify PIN.'; return; }
  state.adminToken = r.data.token; sessionStorage.setItem('askse_admin', r.data.token); setAdmin(true); $('#fCategory').focus();
});
$('#lockBtn').addEventListener('click', () => { state.adminToken = null; sessionStorage.removeItem('askse_admin'); setAdmin(false); toast('Admin locked.'); });
const counterFor = (inp, out, min, max) => { const n = inp.value.trim().length; out.textContent = `${n}/${max}`; out.classList.toggle('over', inp.value.length > 0 && (n < min || n > max)); };
$('#fQuestion').addEventListener('input', () => counterFor($('#fQuestion'), $('#qCount'), 10, 150));
$('#fAnswer').addEventListener('input', () => counterFor($('#fAnswer'), $('#aCount'), 10, 400));
function validateFaq(f) {
  const e = {};
  if (!state.categories.includes(f.category)) e.category = 'Choose a category from the list.';
  if (f.question.length < 10 || f.question.length > 150) e.question = 'Question must be 10–150 characters.';
  if (f.answer.length < 10 || f.answer.length > 400) e.answer = 'Answer must be 10–400 characters.';
  return e;
}
$('#faqForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = { category: $('#fCategory').value, question: $('#fQuestion').value.trim(), answer: $('#fAnswer').value.trim() };
  let errors = validateFaq(f);
  const showErrors = (errs) => document.querySelectorAll('[data-err]').forEach((p) => (p.textContent = errs[p.dataset.err] || ''));
  showErrors(errors);
  if (Object.keys(errors).length) return;
  const editing = editingId;
  const btn = $('#addBtn'); btn.disabled = true; btn.textContent = editing ? 'Saving…' : 'Adding…';
  const r = editing
    ? await api(`/api/admin/faqs/${editing}/`, { method: 'PUT', body: JSON.stringify(f) })
    : await api('/api/admin/faqs/', { method: 'POST', body: JSON.stringify(f) });
  btn.disabled = false; btn.textContent = editing ? 'Save changes' : 'Add FAQ';
  if (adminExpired(r)) return;
  if (!r.ok) { showErrors(r.data.fields || {}); return toast(r.data.error || 'Could not save FAQ.'); }
  exitEdit();
  await loadFaqs(); renderManage(); loadInbox();
  toast(editing ? `Saved changes to ${r.data.faq.id}.` : `Added ${r.data.faq.id} to ${r.data.faq.category}.`);
});

// ---------- about + reset ----------
async function loadAbout() {
  const r = await api('/api/project-info/'); if (!r.ok) return;
  const p = r.data;
  $('#mockBanner').hidden = !p.mockMode;
  const row = (k, v) => [el('dt', {}, k), el('dd', {}, v)];
  $('#aboutCard').replaceChildren(
    el('div', { class: 'brand' }, el('img', { src: '/logo.svg', alt: '', width: 40, height: 40 }), el('div', {}, el('strong', {}, 'AskSE'), el('span', {}, p.event))),
    el('dl', {},
      row('Entry ID', p.entryId), row('Team name', p.teamName), row('Members', p.members.join(', ')),
      row('Repository', el('a', { href: p.repository, target: '_blank', rel: 'noopener' }, p.repository)),
      row('LLM / API model', p.llm),
      p.demoAdminPin ? row('Admin PIN (demo)', el('span', { class: 'pin-row' }, el('code', { class: 'pin-code' }, p.demoAdminPin),
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => { show('admin'); $('#pin').value = p.demoAdminPin; $('#pin').focus(); } }, 'Open Admin'))) : null, row('AI tools used to build', p.aiTools.join(', ')), row('Department', p.university),
      row('Data note', 'The FAQ data is fictional and made for this competition. It is not official department information.')));
}
$('#resetBtn').addEventListener('click', async () => {
  const ok = await confirmDialog('Reset to starter data?', 'This restores exactly the original 8 FAQs (admin-added FAQs are removed) and clears all chat messages and stats. This cannot be undone.', 'Reset');
  if (!ok) return toast('Nothing was reset.');
  const r = await api('/api/reset-starter-data/', { method: 'POST', body: JSON.stringify({ confirm: true }) });
  if (!r.ok) return toast('Reset failed.');
  state.messages = []; clearTransient(); renderMessages(); await loadFaqs(); toast('Starter data restored: 8 FAQs.');
});

// ---------- boot ----------
async function health() {
  const s = $('#status');
  try {
    const r = await api('/api/health/');
    s.className = `status ${r.ok && r.data.aiKeyConfigured ? 'ok' : 'bad'}`;
    s.querySelector('span').textContent = r.ok ? (r.data.aiKeyConfigured ? 'Online' : 'AI key missing') : 'Offline';
  } catch { s.className = 'status bad'; s.querySelector('span').textContent = 'Offline'; }
}
// ---------- Feature: search inside the conversation ----------
function applySearch() {
  const q = $('#chatSearchInput').value.trim().toLowerCase();
  const nodes = [...messagesEl.querySelectorAll('.msg:not(.transient)')];
  let hits = 0;
  for (const n of nodes) {
    const match = !q || n.querySelector('.bubble').textContent.toLowerCase().includes(q);
    n.classList.toggle('dim', Boolean(q) && !match); n.classList.toggle('hit', Boolean(q) && match);
    if (q && match) hits++;
  }
  $('#searchCount').textContent = q ? `${hits} match${hits === 1 ? '' : 'es'}` : '';
  if (q && hits) messagesEl.querySelector('.msg.hit')?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
}
function toggleSearch(open = $('#chatSearch').hidden) {
  $('#chatSearch').hidden = !open; $('#searchBtn').setAttribute('aria-expanded', String(open));
  if (open) $('#chatSearchInput').focus(); else { $('#chatSearchInput').value = ''; applySearch(); input.focus(); }
}
$('#searchBtn').addEventListener('click', () => toggleSearch());
$('#searchClose').addEventListener('click', () => toggleSearch(false));
let searchTimer;
$('#chatSearchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applySearch, 120); });
$('#chatSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleSearch(false); });

// ---------- Feature: export transcript (Markdown) ----------
function exportChat() {
  if (!state.messages.length) return toast('Nothing to export yet.');
  const lines = ['# AskSE chat transcript', '', `Exported ${new Date().toLocaleString()}`, '',
    '> Answers are AI-generated from the department FAQ. Please verify important information with the office.', ''];
  for (const m of state.messages) {
    const who = m.role === 'user' ? '**You**' : '**AskSE**';
    const cites = m.citations?.length ? `  _Sources: ${m.citations.map((c) => `[${c}]`).join(' ')}_` : '';
    lines.push(`${who} · ${fmtTime(m.created_at)}`, '', m.content, cites, '', '---', '');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `askse-chat-${new Date().toISOString().slice(0, 10)}.md` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${state.messages.length} messages.`);
}
$('#exportBtn').addEventListener('click', exportChat);

// ---------- Feature: text size (accessibility) ----------
function setTextSize(scale, save = true) {
  document.documentElement.style.setProperty('--scale', scale);
  document.querySelectorAll('.segmented button').forEach((b) => { const on = b.dataset.size === String(scale); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  if (save) store.set('askse_size', String(scale));
}
document.querySelectorAll('.segmented button').forEach((b) => b.addEventListener('click', () => setTextSize(b.dataset.size)));
setTextSize(store.get('askse_size') || '1', false);

// ---------- Feature: command palette (Ctrl/Cmd + K) ----------
const palette = $('#palette'); let paletteItems = []; let paletteIndex = 0;
function commands() {
  const toggle = (id, label) => ({ group: 'Settings', label: `${$(id).checked ? 'Turn off' : 'Turn on'} ${label}`, icon: 'sun', run: () => { $(id).click(); } });
  return [
    { group: 'Go to', label: 'Chat', icon: 'asked', run: () => show('chat') },
    { group: 'Go to', label: 'FAQ list', icon: 'Library', run: () => show('faqs') },
    { group: 'Go to', label: 'Stats', icon: 'star', run: () => show('stats') },
    { group: 'Go to', label: 'Admin', icon: 'refused', run: () => show('admin') },
    { group: 'Go to', label: 'About', icon: 'Help', run: () => show('about') },
    { group: 'Actions', label: 'Search this conversation', icon: 'search', run: () => { show('chat'); toggleSearch(true); } },
    { group: 'Actions', label: 'Export chat transcript', icon: 'download', run: exportChat },
    { group: 'Actions', label: 'Clear chat…', icon: 'trash', run: () => { show('chat'); $('#clearBtn').click(); } },
    toggle('#darkToggle', 'dark mode'), toggle('#urduToggle', 'Urdu-script replies'), toggle('#speakToggle', 'spoken answers'),
    ...state.faqs.map((f) => ({ group: 'Ask the FAQ', label: f.question, hint: f.id, icon: f.category, run: () => { show('chat'); input.value = f.question; updateComposer(); send(); } })),
  ];
}
function renderPalette() {
  const q = $('#paletteInput').value.trim().toLowerCase();
  paletteItems = commands().filter((c) => !q || `${c.label} ${c.group} ${c.hint || ''}`.toLowerCase().includes(q));
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  const ul = $('#paletteList'); ul.replaceChildren();
  if (!paletteItems.length) { ul.append(el('li', { class: 'palette-empty' }, 'No matching commands. Press Enter to ask AskSE.')); return; }
  let group = '';
  paletteItems.forEach((c, i) => {
    if (c.group !== group) { group = c.group; ul.append(el('li', { class: 'palette-group', role: 'presentation' }, group)); }
    ul.append(el('li', { class: `palette-item ${i === paletteIndex ? 'active' : ''}`, role: 'option', id: `pal-${i}`, 'aria-selected': String(i === paletteIndex),
      onclick: () => runPalette(i), onmousemove: () => { if (paletteIndex !== i) { paletteIndex = i; highlightPalette(); } } },
      icon(c.icon, 'mini-ico'), el('span', {}, c.label), c.hint ? el('kbd', {}, c.hint) : null));
  });
  $('#paletteInput').setAttribute('aria-activedescendant', `pal-${paletteIndex}`);
}
function highlightPalette() {
  document.querySelectorAll('.palette-item').forEach((n) => { const on = n.id === `pal-${paletteIndex}`; n.classList.toggle('active', on); n.setAttribute('aria-selected', String(on)); });
  $(`#pal-${paletteIndex}`)?.scrollIntoView({ block: 'nearest' });
  $('#paletteInput').setAttribute('aria-activedescendant', `pal-${paletteIndex}`);
}
function runPalette(i) {
  const c = paletteItems[i]; const typed = $('#paletteInput').value.trim();
  palette.close();
  if (c) c.run();
  else if (typed && typed.length <= MAX) { show('chat'); input.value = typed; updateComposer(); send(); }
}
function openPalette() { if (palette.open) return palette.close(); $('#paletteInput').value = ''; paletteIndex = 0; renderPalette(); palette.showModal(); $('#paletteInput').focus(); }
$('#paletteBtn').addEventListener('click', openPalette);
$('#paletteInput').addEventListener('input', () => { paletteIndex = 0; renderPalette(); });
$('#paletteInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1); highlightPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); highlightPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIndex); }
});
palette.addEventListener('click', (e) => { if (e.target === palette) palette.close(); }); // click on backdrop
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  else if (mod && e.key.toLowerCase() === 'f' && state.view !== 'faqs' && !$('#view-chat').hidden) { e.preventDefault(); toggleSearch(true); }
  else if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); show('chat'); input.focus(); }
});

// Deep links: #faqs, #stats, #admin, #about open that screen; ?theme=dark|light previews a theme without saving it.
const VIEWS = ['chat', 'faqs', 'stats', 'admin', 'about'];
const themeParam = new URLSearchParams(location.search).get('theme');
if (themeParam === 'dark' || themeParam === 'light') { applyTheme(themeParam === 'dark'); $('#darkToggle').checked = themeParam === 'dark'; }
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v)) show(v); });

(async function boot() {
  state.view = 'chat';
  renderChips(); renderTopics(); updateComposer();
  await Promise.all([loadFaqs(), loadAbout(), health()]);
  setAdmin(Boolean(state.adminToken));
  const r = await api('/api/messages/');
  if (r.ok) { state.messages = r.data.messages; renderMessages(); }
  const startView = location.hash.slice(1);
  if (VIEWS.includes(startView) && startView !== 'chat') show(startView); else input.focus();
})();
