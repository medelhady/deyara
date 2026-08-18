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

- `approved` — the point was charged and the owner number was sent
- `rejected`, `expired` — set by an admin when a request has to be revoked
- `pending_payment`, `pending_admin_review` — legacy, from before points. Rows still carrying one of
  these are approved on the renter's next request instead of waiting for a review.

## MVP Monetization

- Owners can submit properties for free at launch.
- Renters can search for free.
- Contact request costs points, to reduce noise.
- Admin manually verifies a transfer receipt before crediting points. That is the only manual step.
