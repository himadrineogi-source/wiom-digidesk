create table if not exists public.digidesk_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.digidesk_state enable row level security;

revoke all on table public.digidesk_state from anon;
revoke all on table public.digidesk_state from authenticated;
revoke all on table public.digidesk_state from service_role;

grant select, insert, update, delete on table public.digidesk_state to service_role;
