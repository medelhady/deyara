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
- Owner phone is shown to renter only after payment and admin approval.
- Renter phone is shared only if the renter explicitly allows it.

## Contact Requests

Statuses:

- `pending_payment`
- `pending_admin_review`
- `approved`
- `rejected`
- `expired`

## MVP Monetization

- Owners can submit properties for free at launch.
- Renters can search for free.
- Contact request requires a fee to reduce noise.
- Admin manually verifies receipt before approving access to the owner phone.
