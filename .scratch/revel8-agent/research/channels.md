# Target contact channels (live from GET /v1/channels, 2026-11-21)

22 channels, 2 modes. Only **email** is `rendered: true` (its look is craft-scored; HTML/images
matter). All others are text-only — the twin reacts to words + sender, no layout. Each contact
(message or whole call) = 1 touch. `from` fields (name/address/number/handle) are claims.

## MESSAGE mode — POST /sessions/{sid}/messages (one request, events back)
| channel | group | arrives to the twin as |
|---|---|---|
| email | Mail & office | an email in the work inbox (RENDERED/craft-scored) |
| calendar_invite | Mail & office | a calendar invitation (title=subject, desc=body) |
| shared_document | Mail & office | a "someone shared a file with you" notification |
| voicemail | Mail & office | a voicemail — hears the voice + sees the number |
| sms | Phone messaging | an SMS; sees sender number/name only |
| whatsapp | Phone messaging | a WhatsApp msg; sees name + number the sender set |
| signal | Phone messaging | a Signal msg from a number/profile name |
| telegram | Phone messaging | a Telegram msg from an unknown profile |
| imessage | Phone messaging | an iMessage from a number/Apple ID |
| slack | Work chat | a Slack DM; sees the display name set |
| teams_chat | Work chat | a Teams chat; external senders are MARKED external |
| discord | Work chat | a Discord DM from a username |
| linkedin_message | Social | a LinkedIn msg; sees name + headline |
| linkedin_connection_request | Social | a LinkedIn connection request + short note |
| x_dm | Social | a DM on X from a handle |
| instagram_dm | Social | an Instagram DM (in message requests) |
| facebook_messenger | Social | a Messenger msg from a profile name |
| mfa_push | System | a sign-in approval prompt on the phone (they didn't start it) |

## LIVE mode — POST /sessions/{sid}/conversations + /turns (turn-by-turn, ≤10 turns, 1 touch)
| channel | arrives to the twin as |
|---|---|
| phone_call | phone rings; sees only the caller's number |
| video_call | incoming video call; sees the name set + a face on video |
| teams_call | incoming Teams call; display name, marked external if outside the company |
| live_chat | a live chat window opens (support widget / internal helpdesk) |

Note: `GET /v1/channels` is authoritative; new channels can be added on request at the event.
