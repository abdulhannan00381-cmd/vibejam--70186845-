# AskSE Help Desk

**CodeQuest 2026 · Vibe Jam: AI Sprint** · The University of Lahore, Department of Software Engineering

AskSE is a departmental chatbot that answers **only** from the department FAQ knowledge base. Every answer is checked against the FAQ, shows citation chips such as `[FAQ-03]`, and replies in the language of the question (English, Urdu script or Roman Urdu). If the FAQ has no answer, the bot says so. It does not guess.

> All FAQ data is fictional and made for this competition. It is not official department information.

| Field | Value |
|---|---|
| Entry ID | 70186845 |
| Team | Abdul Hannan |
| Members | Abdul Hannan (1 member) |
| Repository | https://github.com/abdulhannan00381-cmd/vibejam--70186845- |
| LLM / API | Groq API, model `openai/gpt-oss-120b` (Anthropic Claude `claude-opus-5-5` also supported via `AI_PROVIDER=anthropic`) |
| Built with | Claude Code (Claude Opus 5.5) |

## How to run (lab PC)

Requirements: **Node.js 22.5 or newer** (uses the built-in `node:sqlite`; tested on Node 26.13). Nothing else: no Python, Docker or database server is needed.

```powershell
npm install
copy .env.example .env      # then put your Groq key in GROQ_API_KEY
npm start                   # http://localhost:3000
```

Health check: `http://localhost:3000/api/health/`

Run the automated tests (they use an isolated temp database and a development-only mock AI, so they need no key):

```powershell
npm test
```

## Environment variables (`.env`, git-ignored)

| Var | Purpose |
|---|---|
| `AI_PROVIDER` | `groq` (live, used for the demo) or `anthropic`. `mock` is **only** for automated tests, and the UI shows a yellow warning banner while it is on. |
| `GROQ_API_KEY` | Groq key (`gsk_…`). Stays on the server and is never sent to the browser. |
| `LLM_MODEL` | `openai/gpt-oss-120b` for Groq, `claude-opus-5-5` for Anthropic |
| `ANTHROPIC_API_KEY` | Only needed when `AI_PROVIDER=anthropic` |
| `PORT` | Defaults to 3000 |
| `ADMIN_PIN` | Defaults to `2026`, as the paper requires |
| `SHOW_ADMIN_PIN` | `true` (default) shows the PIN on the About screen as a demo credential. Set `false` to hide it; the PIN is then never sent to the browser. |

## Architecture

```
public/            Front-end: plain HTML/CSS/JS, no build step
  index.html       Chat, FAQ list, Stats, Admin and About screens
  app.js           UI logic: validation, chat, admin, voice, dark mode
backend/
  server.js        Node http server + REST API + admin sessions + validation
  ai.js            LLM adapter, injection guard, JSON validation, grounding
  ai/askse_system_prompt.txt   <- THE APP'S AI PROMPT
  db.js            SQLite (node:sqlite): faqs, messages, meta
  seed.js          The 8 starter FAQs, exactly as written in the paper
project.json       About-screen metadata (edit team details here)
tests/api.test.js  Automated tests
```

**How a question is answered (`POST /api/chat/`):**
1. The server checks the message: 1–300 characters and not only spaces.
2. A built-in check catches prompt-injection requests (system prompt, API key, role change). These get a polite refusal and the LLM is not called.
3. The server detects the question's language (Urdu script, Roman Urdu or English) and sends a `<reply_language>` hint. All current FAQs from SQLite go to the LLM with the question and the system prompt, at temperature 0 in JSON mode. The model must return only `{found, answer, faq_ids}`. If Groq rate-limits a request (429), the server retries once within the 30-second budget.
4. The server does not trust the model. It parses the JSON and rejects extra keys or wrong types. It then drops any `faq_ids` that are not in the database. If `found` is false or no valid ID is left, the user gets the exact not-found sentence.
5. Any failure (invalid key, no internet, malformed JSON, or more than 30 seconds) returns exactly **"AI service unavailable. Please try again."** The failed turn is not saved, and the typed text stays in the input box with a Retry button.

**Why Node + SQLite instead of Next.js + Django:** the build had a 45-minute window and the app must run on a lab PC. A server with one dependency and the built-in SQLite starts with `npm start`, with no build step and no Python virtual environment. The REST endpoints follow the brief's API design.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health/` | Backend, DB and AI-key status |
| GET | `/api/faqs/?q=` | List or search FAQs |
| POST | `/api/chat/` | Ask a question (grounded LLM answer) |
| GET / DELETE | `/api/messages/` | Chat history / clear chat |
| POST | `/api/messages/:id/feedback/` | Helpful / not helpful / wrong answer |
| GET | `/api/stats/` | Asked, answered, not found, most-cited FAQ |
| POST | `/api/admin/verify-pin/` | PIN check, returns a 30-minute admin token |
| POST | `/api/admin/faqs/` | Add a FAQ (needs `X-Admin-Token`) |
| PUT / DELETE | `/api/admin/faqs/FAQ-XX/` | Edit or delete a FAQ (needs admin token) |
| GET | `/api/admin/unanswered/` | Questions that got the not-found reply (needs admin token) |
| POST | `/api/reset-starter-data/` | Restore the 8 FAQs and clear chat (`{"confirm": true}`) |
| GET | `/api/project-info/` | About-screen data |

## Security notes
- The API key exists only in `.env`, which is git-ignored, and is read on the server. API responses and the front-end never contain it. Logs record only the error class and status.
- The PIN is checked on the server and is not hard-coded in the front-end. For the demo, About shows it, served by the backend; turn that off with `SHOW_ADMIN_PIN=false`. The PIN check itself always runs on the server. Admin write endpoints need a random, short-lived token, and PIN attempts are rate-limited.
- Request bodies are limited to 16 KB. Errors returned to the browser carry no stack traces.
- Reset is deliberately available without a PIN (on the About screen, behind a confirmation dialog) because the paper requires judges to be able to reset.

## Level-ups included
Stats screen · helpful / not helpful / wrong-answer buttons · suggested-question chips · voice input and spoken answers (in browsers that support them) · switch for replies in Urdu script · dark mode.

## Extra features
| # | Feature | Where |
|---|---|---|
| 1 | **Admin: edit and delete FAQs.** Validated on the server, PIN-protected, and IDs are never reused, so old citations stay correct. | Admin → Manage FAQs |
| 2 | **Unanswered-questions inbox.** Questions the FAQ couldn't answer, with **Create FAQ** to copy one into the form. | Admin → Unanswered questions |
| 3 | **Show source.** Displays the exact FAQ text an answer was based on. | Under each answer |
| 4 | **Related questions.** Up to 3 follow-up FAQs (or alternatives after a not-found reply). | Under the latest answer |
| 5 | **Copy answer** to the clipboard. | Under each answer |
| 6 | **Typewriter reveal** of new answers, plus a **response-time** badge. | Chat |
| 7 | **Search the conversation.** Highlights matches and dims the rest (Ctrl+F). | Top bar |
| 8 | **Export the chat** as a Markdown transcript with citations. | Top bar |
| 9 | **Command palette (Ctrl+K).** Jump to screens, ask any FAQ, run actions, toggle settings. `/` focuses the message box. | Top bar |
| 10 | **Text size** (small / default / large), remembered between visits. | Sidebar → Settings |

## Testing the failure case
Set `GROQ_API_KEY=INVALID-KEY-123` in `.env`, restart with `npm start`, and ask anything. The app shows "AI service unavailable. Please try again."

## Troubleshooting
- `ERR_UNKNOWN_BUILTIN_MODULE node:sqlite`: upgrade Node to 22.5 or newer.
- Status dot shows "AI key missing": `.env` is missing, or `ANTHROPIC_API_KEY` is empty.
- Port in use: set `PORT=3001` in `.env`.
