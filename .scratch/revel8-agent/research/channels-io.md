# What each channel REVEALS and what WE must PROVIDE (2026-11-21)

Everything is TEXT. No audio/video streams or recordings anywhere. Only `email` uses real
visual assets (HTML + uploaded images/PDFs) and is the only craft-scored (rendered) channel.
`from` fields are claims. Each message or whole call = 1 touch.

## Message channels — POST /sessions/{sid}/messages
| channel | we send | twin perceives (sender surface) | media we provide |
|---|---|---|---|
| email | subject + body (plain OR self-contained HTML, inline CSS, `asset://` imgs), optional attachments | email in work inbox; sender name+address | **RENDERED**: HTML + ≤3 images/PDF (optional) |
| calendar_invite | subject=title, body=description | calendar invite; name+address | none (text) |
| shared_document | body = "X shared a file" notice | share notification; name+address | none (text; filename only) |
| voicemail | body = the spoken words (TEXT) | voicemail; hears voice + sees number | **none — words as text, no audio** |
| sms | body | SMS; sender number/name only | none |
| whatsapp | body | WhatsApp; name+number the sender set | none |
| signal | body | Signal; number/profile name | none |
| telegram | body | Telegram; unknown profile | none |
| imessage | body | iMessage; number/Apple ID | none |
| slack | body | Slack DM; display name set | none |
| teams_chat | body | Teams chat; display name, **external flag** if outside company | none |
| discord | body | Discord DM; username | none |
| linkedin_message | body | LinkedIn msg; name + headline | none |
| linkedin_connection_request | body = the note | connection request + note; name+headline | none |
| x_dm | body | X DM; handle | none |
| instagram_dm | body | Instagram DM; handle (in requests) | none |
| facebook_messenger | body | Messenger; profile name | none |
| mfa_push | body = approval-prompt text | "approve this sign-in?" prompt (they didn't start it) | none |

## Live channels — POST /sessions/{sid}/conversations then /turns (≤10 turns, 1 touch)
| channel | we send | twin perceives | media |
|---|---|---|---|
| phone_call | text turns (`say`) | phone rings; caller's number only | **TEXT only, no audio** |
| video_call | text turns (`say`) | video call; name set + "a face on video" | **TEXT only, no video** |
| teams_call | text turns (`say`) | Teams call; display name, external flag | **TEXT only** |
| live_chat | text turns (`say`) | live chat window (support/helpdesk) | **TEXT only** |

## Attachments (any message channel; mostly email)
- Image/PDF: upload as an asset (PNG/JPG/WebP/PDF, ≤5MB). Inline in email HTML via `asset://id`
  or list in `attachments`. Twin sees ≤3 images; of a PDF, the **filename only**.
- Audio: declare `{filename, transcript}` → twin "hears" the transcript (text).
- Any other file: declare `{filename}` only → twin may open it → `attachment.opened` event.
- Landing page: declared (url/title/html/fields); seen ONLY if the twin opens your link.

## Strategy implication
Use the full surface. Channel is one API field, so a single persona can run a consistent story
across email + LinkedIn + a call (channel-corroboration, flagged strong in ticket 20). Email for
the craft-scored strike; messaging/social for warm-up; a live call to probe AND strike in one
touch (F3). `mfa_push` pairs with a credential pretext. Watch the Teams "external" flag as a cost.
