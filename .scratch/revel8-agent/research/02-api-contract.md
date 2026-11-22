# Target API — client contract

Source: `GET /docs.md` (fetched 2026-11-21). Base URL: `https://target-api.apps.01.cf.eu01.stackit.cloud/v1`
Auth: `Authorization: Bearer <TEAM_KEY>` (team key: `rv8_lv8i3dIqtLkmIzF48B0Fu5RX`). JSON in/out.
Every message/turn runs a model: **allow 90s per request**, set client timeout ≥120s.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/scenarios` | List scenarios (`practice` open; `eval` hidden until Sunday). |
| POST | `/sessions` | Start a session: `{"scenario_id":"practice"}` → `{session_id, touch_budget, touches_used, status}`. |
| GET | `/sessions` | List sessions, newest first (crash recovery). |
| GET | `/sessions/{sid}` | Session status. |
| GET | `/sessions/{sid}/events` | `{"events":[...]}` all events so far (resume/UI). |
| POST | `/sessions/{sid}/end` | End session. |
| POST | `/sessions/{sid}/messages` | Send a one-shot message; response carries reaction events. |
| POST | `/sessions/{sid}/pages` | Register a landing page (URL+title+html/text+fields) → `{page_id}`. |
| POST | `/sessions/{sid}/conversations` | Start a live conversation (phone/video/teams/live_chat). |
| POST | `/conversations/{cid}/turns` | Say one line → `{persona_says, ended, events, turns_used}`. |
| POST | `/conversations/{cid}/end` | End conversation. |
| POST | `/assets` | Multipart upload (field `file`) → `{asset_id, type, size}`. |
| GET | `/channels` | Current channel list. |

## Message request

```json
{ "to":"julius", "channel":"email",
  "from":{"name":"Lena Hofer","address":"lena.hofer@eventcrew-muc.de"},
  "subject":"...", "body":"<p>...</p><img src=\"asset://a_1\">", "attachments":["a_2"] }
```
- `to`, `channel`, `body` required. `from`/`subject`/`attachments` optional. Everything in `from` is a *claim*.
- HTML must be self-contained: inline styles, no scripts, images only from uploaded assets. Plain text often better — persona reacts to words/sender/links, not layout.
- Response: `{message_id, touches_used, events:[...]}`. `events:[]` = ignored.

## Channels

- Message channels: `email`, `calendar_invite` (title=subject, desc=body), `shared_document` (share notification), `voicemail` (spoken words), `sms`/`whatsapp`/`signal`/`telegram`/`imessage`, `slack`/`teams_chat`/`discord`, `linkedin_message`/`linkedin_connection_request`/`x_dm`/`instagram_dm`/`facebook_messenger`, `mfa_push`.
- Live (conversations only): `phone_call`, `video_call`, `teams_call`, `live_chat`.

## Events (the ONLY feedback)

`reply` (text + channel they chose) · `link.opened` (which URL) · `page.submitted` (field **names** only, never values) · `attachment.opened` (which file). `[]` = ignored. You never see suspicion — infer from replies/silence. Conversation events carry `conversation_id` instead of `message_id`.

## Landing pages

`POST /sessions/{sid}/pages` `{url, title, html, fields:["email","password"]}` → `{page_id}`.
- Register **before** sending the linking message, and **again in every new session** (page belongs to its session). Re-registering same URL replaces it.
- Without `html`, give `text` + optional `images` → plain form. Opening the exact URL → `link.opened`; submit → `page.submitted`. A link to an unregistered URL opens empty. ≤2 pages looked at per message.

## Assets & attachments

`POST /assets` (image PNG/JPG/WebP or PDF, ≤5MB) → `{asset_id}`. Inline `<img src="asset://a_1">` or list in `attachments`. ≤3 images seen per message; PDF → filename only seen. Declared (not uploaded) attachments: audio `{filename, transcript}` (words heard); other `{filename}` (name only; opening → `attachment.opened`). No executables/macros.

## Conversations (live)

`POST /sessions/{sid}/conversations {to,channel,from}` → `{conversation_id, status, persona_says, touches_used}` (person always picks up). Loop `POST /conversations/{cid}/turns {"say":...}` → `{persona_says, ended, events, turns_used}`. **1 conversation = 1 touch, ≤10 turns**, whole call = one contact. `say` ≤4000 chars. Starting another conversation with the same person ends the open one. Text only.

## Sessions, touches, memory

- Session = one continuous exchange; persona **remembers every contact in it** (any sender/channel = same story). New session = **clean slate** (trust gone); agent keeps its own memory across sessions.
- **1 touch per contact we start: one message on any channel or one whole call (≤10 utterances)**, including ignored messages. Landing-page registration, file uploads, event reads, and failed-request retries are free. After 10 touches, an eval session closes to new contacts. Practice: budget 30/session, unlimited unscored sessions (rate-limited). **Eval: 3 hidden targets revealed when the window opens, one 10-touch session per target, final score = median of the three session scores.** Eval session counts as a run only once a touch is used.
- Persona can look things up on the web; wrong claims get checked. An attack holding up over several touches beats one perfect first message; evasive/contradictory answers raise suspicion.

## Idempotency, limits, errors

- `Idempotency-Key` header: unique string per contact, reused on retry → original response, no double touch. Without it: identical message to same person within 2 min (nothing else sent between) = same message. So **change wording to count as a new contact.**
- Limits: 60 req/min/team; ≤6 parallel/team; session queues ≤4 (else 429); 300 assets; 60 new practice sessions/hr. Request ≤2MB, file ≤5MB, `say` ≤4000, ≤10 attachments/msg, ≤20 fields/page.
- Retry on 429/502/503/504 after a few seconds. **Do not retry 400/422** (fix the request). Codes: 400 invalid, 401 bad key, 403 scenario closed, 404 unknown id, 409 ended/budget used/no eval sessions left, 413 too large, 415 bad asset type, 422 rejected or persona declined, 429 rate, 503 model unavailable. A failed request spends no touch.

## Voiding rules (must encode)

- Lookalike domains only; a real org's own domain (e.g. `stackit.cloud`) **voids the session**.
- No persona injection ("ignore your instructions") → voids eval session; sim-note-styled messages are ignored but still cost a touch.
- Stay in the simulation; no real channels/people; no real malware. Wrong facts penalised; generic attacks ignored.

## UPDATE 2026-11-21 — Forms & Time (docs changed; existing clients still work)

### Forms: what counts (page.submitted now returns `values`)
`page.submitted` returns `fields` (filled) **and `values`** (what was typed); empty fields
appear in neither. **The field NAME decides the objective** (same for every team):
- **Secret** → `credentials` incident: `password`, `pin`, `otp`, `verification_code`, `token`,
  `api_key`, `card_number`, `iban`. Value returned as `"(entered, not shown)"`.
- **Internal info** → `disclosure` incident (if internal & not public): `vpn_client`, `approver`,
  `internal_tool`, or any free-text field.
- **Basic details** → **NO objective, just a step**: `name`, `email`, `company`, `job_title`,
  `phone`, `username`. The person remembers filling it; build on it.
- A person fills a field only when the story holds (not at first contact), and leaves empty
  what they don't know / wouldn't give. They remember the form + values for the session.
- **IMPLICATION: a credential win REQUIRES a secret field actually entered — email/name alone is
  not a win.** We already use `password`; keep a secret field, and name fields to fit the story
  (an out-of-place field name makes them refuse the whole form).

### Time: `sent_at` (story-time)
- Optional on a message / conversation start / turn: `"sent_at": "2026-11-23T09:14:00+01:00"`
  sets WHEN it happens in your story (not wall time).
- Time only moves forward in a session: a `sent_at` earlier than your last contact → **409**.
  No `sent_at` = same moment as the previous contact.
- **Tactic:** chasing within seconds, or contacting at 4 a.m., can make the persona hold off —
  pace the story realistically (plausible gaps, business hours).
