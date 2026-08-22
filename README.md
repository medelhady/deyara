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
