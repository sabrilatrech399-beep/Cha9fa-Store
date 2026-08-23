-- Watch-point guardrail migration.
-- This creates the ONLY database path that can credit points.
-- The browser must never receive execute permission on this function.

create table if not exists public.watch_channels (
  channel_slug text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.watch_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  store_user_id uuid not null references public.store_users(id) on delete restrict,
  channel_slug text not null references public.watch_channels(channel_slug) on delete restrict,
  points bigint not null check (points > 0 and points <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists watch_events_user_created_idx
  on public.watch_events(store_user_id, created_at desc);

alter table public.watch_channels enable row level security;
alter table public.watch_events enable row level security;
revoke all on table public.watch_channels from anon, authenticated;
revoke all on table public.watch_events from anon, authenticated;

create or replace function public.grant_watch_points(
  p_kick_user_id text,
  p_channel_slug text,
  p_event_key text,
  p_points bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.store_users%rowtype;
  v_channel public.watch_channels%rowtype;
begin
  if p_kick_user_id is null or char_length(trim(p_kick_user_id)) < 1 then
    raise exception 'INVALID_KICK_USER_ID';
  end if;
  if p_channel_slug is null or char_length(trim(p_channel_slug)) < 1 then
    raise exception 'INVALID_CHANNEL';
  end if;
  if p_event_key is null or char_length(trim(p_event_key)) < 8 or char_length(trim(p_event_key)) > 200 then
    raise exception 'INVALID_EVENT_KEY';
  end if;
  if p_points is null or p_points < 1 or p_points > 1000 then
    raise exception 'INVALID_POINTS';
  end if;

  select * into v_channel
  from public.watch_channels
  where channel_slug = lower(trim(p_channel_slug)) and active = true;
  if not found then raise exception 'CHANNEL_NOT_ALLOWED'; end if;

  select * into v_user
  from public.store_users
  where kick_user_id = trim(p_kick_user_id)
  for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  -- The unique event key makes retries idempotent and prevents double-crediting.
  insert into public.watch_events(event_key, store_user_id, channel_slug, points)
  values (trim(p_event_key), v_user.id, v_channel.channel_slug, p_points)
  on conflict (event_key) do nothing;

  if not found then
    return v_user.points;
  end if;

  update public.store_users
  set points = points + p_points, updated_at = now()
  where id = v_user.id
  returning * into v_user;

  insert into public.point_ledger(store_user_id, direction, amount, source, reason)
  values (v_user.id, 'credit', p_points, 'watch', 'verified stream watch');

  return v_user.points;
end;
$$;

revoke all on function public.grant_watch_points(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.grant_watch_points(text, text, text, bigint) to service_role;

-- Configure the real channel explicitly after deployment:
-- insert into public.watch_channels(channel_slug) values ('YOUR_KICK_CHANNEL_SLUG') on conflict do nothing;
