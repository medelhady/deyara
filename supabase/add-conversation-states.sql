create table if not exists public.conversation_states (
  phone text primary key,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversation_states_updated_at_idx
on public.conversation_states(updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists conversation_states_set_updated_at on public.conversation_states;
create trigger conversation_states_set_updated_at
before update on public.conversation_states
for each row execute function public.set_updated_at();

alter table public.conversation_states enable row level security;
