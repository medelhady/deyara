# WhatsApp Real Estate Platform

منصة عقارية تعمل من واتساب، مع لوحة إدارة فقط للفريق.

## Stack

- Next.js + TypeScript
- Supabase Postgres + Storage
- Twilio WhatsApp API
- Vercel deployment

## Local Setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and add your keys.

## Mock WhatsApp Simulator

Before paying for Twilio or connecting a real WhatsApp number, use:

```txt
http://localhost:3000/admin/simulator
```

This page sends mock WhatsApp messages to:

```txt
POST /api/mock/whatsapp
```

It tests the owner flow, renter search, property selection, and contact request fee flow without external services.

## Twilio Webhook

Set the incoming WhatsApp webhook in Twilio Sandbox or your WhatsApp sender to:

```txt
https://YOUR_DOMAIN/api/webhooks/twilio/whatsapp
```

For local testing, expose port 3000 with ngrok and use:

```txt
https://YOUR_NGROK_URL/api/webhooks/twilio/whatsapp
```

## Supabase

Run `supabase/schema.sql` in the Supabase SQL editor.

The first MVP protects phone numbers:

- No owner phone is shown before payment and admin approval.
- Renter phone is never shared unless the renter explicitly allows it.
- Properties require admin approval before appearing in search.

## Required Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
OPENAI_API_KEY=
ADMIN_WHATSAPP_NUMBERS=whatsapp:+22200000000
CONTACT_REQUEST_FEE=100
```
