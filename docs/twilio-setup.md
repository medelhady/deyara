# Twilio WhatsApp Setup

## Development With Sandbox

1. Open Twilio Console.
2. Go to Messaging > Try it out > Send a WhatsApp message.
3. Join the Sandbox from your phone by sending the displayed `join ...` code to the Twilio Sandbox number.
4. Start the app locally:

```bash
npm run dev
```

5. Expose the local app:

```bash
ngrok http 3000
```

6. In Twilio Sandbox settings, set "When a message comes in" to:

```txt
https://YOUR_NGROK_URL/api/webhooks/twilio/whatsapp
```

7. Send a WhatsApp message:

```txt
عندي شقة في تفرغ زينة قرب المستشفى الإسباني بـ 3500
```

The webhook should respond with the next required fields.

## Production

1. Register or connect a WhatsApp sender in Twilio.
2. Deploy the app to Vercel.
3. Add environment variables in Vercel.
4. Set the production incoming webhook to:

```txt
https://YOUR_VERCEL_DOMAIN/api/webhooks/twilio/whatsapp
```

## Environment Variables

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+YOUR_TWILIO_WHATSAPP_NUMBER
TWILIO_VALIDATE_SIGNATURE=false
```

Keep `TWILIO_VALIDATE_SIGNATURE=false` during the first MVP until the final domain is stable. Then enable request validation before production launch.
