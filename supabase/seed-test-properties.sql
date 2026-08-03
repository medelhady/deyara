insert into public.users (phone, name, role)
values
  ('whatsapp:+22241000001', 'مؤجر تجريبي 1', 'owner'),
  ('whatsapp:+22241000002', 'مؤجر تجريبي 2', 'owner'),
  ('whatsapp:+22241000003', 'مؤجر تجريبي 3', 'owner'),
  ('whatsapp:+22241000004', 'مؤجر تجريبي 4', 'owner'),
  ('whatsapp:+22241000005', 'مؤجر تجريبي 5', 'owner')
on conflict (phone) do nothing;

with areas(area, landmarks) as (
  values
    ('تفرغ زينة', array['المستشفى الإسباني', 'كارفور', 'السفارة الفرنسية', 'شارع نواذيبو', 'كلينيك النجاح']),
    ('عرفات', array['مدريد', 'سوق عرفات', 'وقفة مدريد', 'مسجد النور', 'كرفور الحي']),
    ('لكصر', array['السوق المركزي', 'العيادة المجمعة', 'الملعب الأولمبي', 'قصر المؤتمرات', 'شارع جمال عبد الناصر']),
    ('تيارت', array['سوق تيارت', 'الحنفية الرابعة', 'مسجد التوبة', 'كرفور تيارت', 'العيادة']),
    ('دار النعيم', array['سوق دار النعيم', 'مركز الحالة المدنية', 'مسجد قباء', 'كرفور المقاومة', 'المدرسة رقم 7']),
    ('السبخة', array['سوق السبخة', 'الميناء القديم', 'كرفور الحاكم', 'مسجد السبخة', 'محطة النقل']),
    ('الميناء', array['سوق الميناء', 'كرفور الرابع', 'الميناء القديم', 'مسجد النور', 'محطة النقل'])
),
generated as (
  select
    area,
    landmarks[((n - 1) % array_length(landmarks, 1)) + 1] as landmark,
    n,
    case
      when n % 5 = 0 then 3500
      when n % 4 = 0 then 3000
      when n % 3 = 0 then 2500
      when n % 2 = 0 then 2000
      else 1800
    end as price,
    case
      when n % 4 = 0 then 4
      when n % 3 = 0 then 3
      else 2
    end as rooms,
    ('whatsapp:+2224100000' || (((n - 1) % 5) + 1)::text) as owner_phone
  from areas
  cross join generate_series(1, 20) as n
)
insert into public.properties (
  owner_phone,
  type,
  area,
  landmark,
  price,
  rooms,
  description,
  status
)
select
  owner_phone,
  'شقة',
  area,
  'قرب ' || landmark,
  price,
  rooms,
  'عقار تجريبي لاختبار تدفق البحث وطلب التواصل.',
  'active'
from generated
where not exists (
  select 1
  from public.properties p
  where p.area = generated.area
    and p.landmark = 'قرب ' || generated.landmark
    and p.price = generated.price
    and p.rooms = generated.rooms
    and p.description = 'عقار تجريبي لاختبار تدفق البحث وطلب التواصل.'
);
