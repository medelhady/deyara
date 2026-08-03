create or replace function public.next_property_code()
returns text
language plpgsql
as $$
begin
  return lpad(nextval('public.property_code_seq')::text, 4, '0');
end;
$$;

alter table public.properties
alter column property_code set default public.next_property_code();

update public.properties
set property_code = right(regexp_replace(property_code, '\D', '', 'g'), 4)
where property_code is not null
  and property_code !~ '^\d{4}$';
