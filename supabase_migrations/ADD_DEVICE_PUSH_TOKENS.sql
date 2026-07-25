-- Tokeny push (Expo) do alertów dat ważności
create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  platform text,
  user_id uuid,
  restaurant_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.device_push_tokens enable row level security;

do $$ begin
  create policy "device_push_tokens_all"
    on public.device_push_tokens for all
    using (true) with check (true);
exception when duplicate_object then null;
end $$;

create index if not exists device_push_tokens_user_idx on public.device_push_tokens (user_id);
