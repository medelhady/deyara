# Product Rules

## Identity

- Phone number is the user identity.
- A user can be a renter and owner at the same time.
- Admins are configured by phone number.

## Property Publishing

Required before admin review:

- Price
- Area
- Famous nearby landmark
- Property video

Optional:

- WhatsApp location, when the owner is at the property or can share it accurately.

Properties are not visible to renters until admin approval.

## Phone Number Privacy

- Owner phone is hidden from renters by default.
- Renter phone is hidden from owners by default.
- Admin can see both numbers.
- Owner phone is shown to the renter as soon as the point is charged. No admin approval.
- Renter phone is shared only if the renter explicitly allows it.

## Contact Requests

A contact request is fulfilled the moment the renter has the points for it. Admin approval is only
needed to credit points, never to release an owner number.

Statuses:

- `approved` — the point was charged and the owner number was sent. Every new request is created
  this way; there is no pending state.
- `rejected`, `expired` — set by an admin when a request has to be revoked.

The enum still lists `pending_payment` and `pending_admin_review` from before points, when a renter
paid by transfer and waited for a review. Nothing reads or writes them; the rows that held them were
closed by `supabase/retire-legacy-contact-statuses.sql`.

## MVP Monetization

- Owners can submit properties for free at launch.
- Renters can search for free.
- Contact request costs points, to reduce noise.
- Admin manually verifies a transfer receipt before crediting points. That is the only manual step.
