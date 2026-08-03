insert into public.users (phone, role, name)
values
  ('whatsapp:+22241001001', 'renter', 'مسوق تجريبي 1'),
  ('whatsapp:+22241001002', 'renter', 'مسوق تجريبي 2'),
  ('whatsapp:+22241001003', 'renter', 'مسوق تجريبي 3'),
  ('whatsapp:+22241001004', 'renter', 'مسوق تجريبي 4'),
  ('whatsapp:+22241001005', 'renter', 'مسوق تجريبي 5')
on conflict (phone) do update set
  name = excluded.name,
  role = excluded.role;

insert into public.user_wallets (
  phone,
  usage_points,
  commission_points,
  withdrawn_commission_points,
  referral_code
)
values
  ('whatsapp:+22241001001', 12, 540, 0, '22241001001-1001'),
  ('whatsapp:+22241001002', 4, 320, 80, '22241001002-1002'),
  ('whatsapp:+22241001003', 20, 760, 500, '22241001003-1003'),
  ('whatsapp:+22241001004', 0, 120, 0, '22241001004-1004'),
  ('whatsapp:+22241001005', 9, 500, 0, '22241001005-1005')
on conflict (phone) do update set
  usage_points = excluded.usage_points,
  commission_points = excluded.commission_points,
  withdrawn_commission_points = excluded.withdrawn_commission_points,
  referral_code = excluded.referral_code;

insert into public.credit_transactions (
  phone,
  kind,
  usage_points_delta,
  commission_points_delta,
  related_phone,
  admin_note
)
values
  ('whatsapp:+22241001001', 'referral_commission', 0, 300, 'whatsapp:+22241002001', 'عمولة شحن تجريبية'),
  ('whatsapp:+22241001001', 'referral_commission', 0, 240, 'whatsapp:+22241002002', 'عمولة شحن تجريبية'),
  ('whatsapp:+22241001002', 'referral_commission', 0, 320, 'whatsapp:+22241002003', 'عمولة شحن تجريبية'),
  ('whatsapp:+22241001003', 'referral_commission', 0, 760, 'whatsapp:+22241002004', 'عمولة شحن تجريبية'),
  ('whatsapp:+22241001005', 'referral_commission', 0, 500, 'whatsapp:+22241002005', 'عمولة شحن تجريبية');

insert into public.withdrawal_requests (
  phone,
  points,
  status,
  payout_note,
  admin_note
)
values
  ('whatsapp:+22241001001', 540, 'pending', 'تحويل يدوي بعد المراجعة', 'طلب سحب تجريبي'),
  ('whatsapp:+22241001003', 500, 'paid', 'تم الدفع يدويًا', 'طلب مدفوع تجريبي'),
  ('whatsapp:+22241001005', 500, 'approved', 'بانتظار الدفع', 'طلب مقبول تجريبي')
on conflict do nothing;
