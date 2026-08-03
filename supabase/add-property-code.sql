create sequence if not exists public.property_code_seq start with 1 increment by 1;

create or replace function public.next_property_code()
returns text
language plpgsql
as $$
begin
  return lpad(nextval('public.property_code_seq')::text, 4, '0');
end;
$$;

alter table public.properties
add column if not exists property_code text;

alter table public.properties
alter column property_code set default public.next_property_code();

update public.properties
set property_code = public.next_property_code()
where property_code is null;

create unique index if not exists properties_property_code_key
on public.properties(property_code);

create index if not exists properties_property_code_idx
on public.properties(property_code);
