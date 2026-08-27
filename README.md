# WhatsApp Real Estate Platform

منصة عقارية تعمل من واتساب، مع لوحة إدارة فقط للفريق.

## Stack

- Next.js + TypeScript
- Supabase Postgres + Storage
- WhatsApp: Meta Cloud API (production) or Twilio, selected by `WHATSAPP_PROVIDER`
- Vercel deployment

## Local Setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and add your keys.

## Mock WhatsApp Simulator

Before connecting a real WhatsApp number, use:

```txt
http://localhost:3000/admin/simulator
```

This page sends mock WhatsApp messages to `POST /api/mock/whatsapp`. It tests the owner flow, renter
search, property selection, and contact request fee flow without external services.

## WhatsApp Provider

`WHATSAPP_PROVIDER` picks the provider for both incoming and outgoing messages. Production runs on
`meta`; the value defaults to `twilio` when the variable is missing, so set it explicitly.

### Meta Cloud API (production)

Webhook URL:

```txt
https://YOUR_DOMAIN/api/webhooks/meta/whatsapp
```

Meta verifies the URL with a `GET` carrying `hub.verify_token`, which must equal `META_VERIFY_TOKEN`.
Messages then arrive as `POST` requests signed with the app secret.

Required variables:

- `META_WHATSAPP_TOKEN` — sends messages and downloads incoming media
- `META_PHONE_NUMBER_ID` — the sender number id
- `META_VERIFY_TOKEN` — any string, matched during webhook setup
- `META_APP_SECRET` — App settings > Basic, in the Meta dashboard

`META_APP_SECRET` is a security requirement, not an optional extra. The admin WhatsApp commands
(`قبول`, `رفض`, `شحن`) authorise the sender purely by phone number, and that number comes from the
webhook body. Without the secret the endpoint cannot tell a real Meta delivery from a forged one, so
anyone who knows the URL could approve listings or credit points. The app logs a warning on every
unverified request while the secret is unset.

Verify the signature rules still hold:

```bash
npm run check:signature
```

### Twilio

Webhook URL:

```txt
https://YOUR_DOMAIN/api/webhooks/twilio/whatsapp
```

For local testing, expose port 3000 with ngrok and use the ngrok URL. See `docs/twilio-setup.md`.
Note that the Twilio webhook does not validate request signatures yet.

## Checks

```bash
npm run check
```

Runs every offline check: Meta webhook signatures, WhatsApp provider resolution, password hashing and
session tokens, the referral commission rules, and how admin WhatsApp commands are read. No
credentials or network needed. Individual suites are `check:signature`, `check:provider`,
`check:auth`, `check:referral` and `check:commands`.

## Bot Messages

A short list of the bot's messages can be reworded at `/admin/messages` without a deploy: the
greeting, the service intro, the empty search reply, the pitch a marketer forwards, the top-up
instructions, and the listing rejection notice. Run `supabase/add-bot-messages.sql` first.

Only text whose wording is a business decision is here. Anything shaped by the logic around it —
search results, error paths, the owner contact card — stays in code, where a wrong edit cannot reach
a user unnoticed.

Three rules keep editing safe:

- A message declares the variables it may use, written `{name}`. Saving an unknown one is refused.
- An empty stored value falls back to the text shipped in the code, so a message is never blank.
  Clearing the field is how you reset one.
- A line whose variables all render empty is dropped whole, so an optional value like a rejection
  reason leaves no dangling label behind.

## Notification Log

Every message the system sends on its own is recorded in `notification_log` and shown at
`/admin/notifications`: what was sent, to whom, whether it arrived, and the reason if it did not.

Sends are fire-and-forget so a failed notification cannot break the flow that triggered it, which
also meant failures left no trace an admin would ever see. The most common one needs no code fix:
WhatsApp refuses free-form text to anyone who has not messaged in the last 24 hours, and the page
counts those separately because the answer is an approved message template, not a bug.

Run `supabase/add-notification-log.sql` to create the table.

### Templates

Where an approved template exists, a notification that hits the closed window is re-sent as that
template instead of being lost. Free-form text is still tried first: inside the window it is free,
carries the whole message rather than a fixed one, and needs no approval.

The fallback fires only on the closed-window error. An expired token or a number not on WhatsApp
would fail the template too, so retrying would bill a second attempt and log a misleading success.

`listing_approved` (Arabic, `ar`) is wired up. Its wording states a deduction, so it is used only
when publishing actually charged a fee — re-publishing a hidden listing charges nothing, and Meta
rejects a template with an empty parameter.

To add another: create it in WhatsApp Manager, then pass a `templateFallback` to `sendNotification`
with its name, its language code exactly as created, and one non-empty value per `{{n}}`.

## Broadcast

`/admin/broadcast` sends one message to everyone, or to renters, owners or marketers. A marketer is
someone who has actually referred a person — every wallet gets a referral code on first use, so
counting codes would make that audience mean everybody.

Before sending, the page states how many of the audience can be reached right now. Only they are
attempted. WhatsApp refuses free-form text to anyone who has not written in the last 24 hours, and
trying anyway would spend one of the 250 daily business-initiated conversations per person, fail,
and push the number's quality rating down. Reaching the rest needs a Marketing template and their
consent to receive one.

Blocked users are excluded. Sending happens in batches so a long run stays inside the function
timeout and reports progress, and every message lands in the notification log.

## Admin WhatsApp Commands

Sent from a number listed in the admin notification numbers setting:

| Command | Does |
| --- | --- |
| `اوامر` | Lists the commands |
| `قبول 0007` | Publishes a listing |
| `رفض 0007 السبب` | Rejects a listing, reason optional |
| `شحن 22245678901 2000` | Approves a pending top-up |
| `سحوبات` | Lists pending withdrawal requests |
| `دفع 22245678901` | Confirms a payout and deducts the commission points |
| `رفض سحب 22245678901 السبب` | Rejects a withdrawal, reason optional |

Every one of these tells the person affected on WhatsApp.

## Supabase

Run `supabase/schema.sql` in the Supabase SQL editor, then the `supabase/add-*.sql` migrations.

Privacy rules enforced by the app:

- Owner phone is released to a renter the moment the contact point is charged; admin approval is only
  needed to credit points, never to release a number.
- Renter phone is never shared unless the renter explicitly allows it.
- Properties require admin approval before appearing in search.

See `docs/product-rules.md` for the full rules.

## Settings

Prices, commission rates, referral rules, the payment number and the admin notification numbers are
edited at `/admin/settings` and stored in the `app_settings` table. The matching environment
variables are only fallbacks used until a value is saved there.

## Admin Access

Each person signs in at `/admin/login` with their own phone number and password. Accounts live in
the `dashboard_accounts` table and are managed at `/admin/accounts`, where an admin can add someone,
reset a password, deactivate an account or delete it.

Passwords are stored as PBKDF2-SHA256 digests and cannot be read back — a forgotten password is
reset, not recovered. The session is a signed cookie valid for 12 hours.

### First login

Run `supabase/add-dashboard-accounts.sql`, then sign in with any phone number and `ADMIN_ACCESS_TOKEN`
as the password. That bootstrap works only while no account exists; once you add the first account at
`/admin/accounts` it stops working. Create your own account before leaving the page.

### Variables

- `ADMIN_SESSION_SECRET` — signs session cookies. Falls back to `ADMIN_ACCESS_TOKEN` when empty.
- `ADMIN_ACCESS_TOKEN` — the bootstrap password described above.

In production, if both are empty the middleware refuses every request to `/admin` and `/api/admin`.
It used to allow them, which left the dashboard and every owner phone number open to anyone with the
URL. Local development keeps the permissive behaviour so the panel runs without setup.

## Environment Variables

See `.env.example` for the full list with notes.
