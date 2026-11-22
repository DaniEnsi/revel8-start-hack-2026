# Landing-page kit — scaffolding (07a)

Scope: the **non-copy** scaffolding — domain scheme, field sets, the API register/upload
flow, and the craft checklist. The **actual page HTML (branding/copy) is the abliterated
Writer's job** (05 D-C/D-D; 02 says page `html` follows mail-HTML rules), produced at
runtime in the build (ticket 09) against the live endpoint (ticket 01). This file is the
contract the Writer fills.

## Lookalike-domain scheme (RULE: never a real org's own domain — that voids the session)

Register-plausible, attacker-ownable domains that *read* right at a glance. Principle: a
believable **service/vendor** name + a generic TLD, not the target org's real domain.

| Pretext type | Shape | Fictional example (illustrative only) |
|---|---|---|
| IT / SSO portal | `<service>-<function>.<tld>` | `account-verify-portal.net`, `id-signin-secure.com` |
| Vendor / SaaS alert | `<vendorish>-support.<tld>` | `billing-notices-eu.com` |
| Document share | `<docbrand>-share.<tld>` | `secure-docs-share.net` |
| Calendar / approval | `<neutral>-invite.<tld>` | `meeting-confirm-eu.com` |
| MFA / approval confirm | `<auth>-confirm.<tld>` | `login-approvals.net` |

Rules the generator must enforce (hard guards in the loop, 05 D-J): the domain is NOT
`stackit.cloud`, `revel8.ai`, or any real customer/vendor domain; link text shown must
match where the link actually points (craft Q4).

## Field sets per objective

- **credentials**: `["email","password"]` (+ optional `["otp"]` for an MFA-styled step).
- **action (approve/change)**: `["approve"]` or `["new_iban","confirm"]` etc. — fields that
  represent the action, since values are never recorded (only field names returned).
- **disclosure**: usually no page — pursued via reply, not a form.

## API flow (from research/02-api-contract.md) — register BEFORE sending the link

```python
# 1) upload any image asset (logo etc.) the Writer references as asset://<id>
asset = POST /v1/assets  (multipart file=...)            -> {"asset_id": "a_1"}
# 2) register the page for THIS session (re-register every new session)
page  = POST /v1/sessions/{sid}/pages {
          "url":   "<lookalike URL>",      # exact URL you will put in the message
          "title": "<page title>",
          "html":  "<Writer-authored self-contained HTML, inline CSS, no scripts>",
          "fields": ["email","password"],
        }                                   -> {"page_id": "p_..."}
# 3) send the message whose body links to exactly that URL
#    -> events: link.opened, then page.submitted (field names only) == credentials incident
```

## Craft self-check (practice has no look rating — verify yourself; render Chrome ~1200px, scripts off, only uploaded images)

1. **Looks like the claimed sender really sends it** — logo/colours/footer for a company; tone/signature for a person.
2. **Format fits sender + occasion** — no vendor alert in bare text; no glossy template for a colleague's 2-liner.
3. **Clean** — no placeholder text, no missing images, no mixed fonts/layout glitches.
4. **Details hold** — footer, sign-in link text matches the real URL, sender line consistent.

## Hand-off to the Writer (ticket 09)

The Writer receives a brief (persona, claimed sender, visual style, the fields, the exact
URL) and returns the self-contained HTML. The Planner runs it through the 05 guard
(domain-not-real, link-text-matches, no scripts) before `POST /pages`.
