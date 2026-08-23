-- Cha9fa Store production hardening migration
-- Run this after supabase/schema.sql.
-- The browser must never call the watch-award function.

create table if not exists public.watch_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  store_user_id uuid not null references public.store_users(id) on delete restrict,
  kick_user_id text not null,
  channel_user_id text not null,
  watch_minutes integer not null check (watch_minutes > 0 and watch_minutes <= 120),
  points_awarded bigint not null check (points_awarded > 0),
  created_at timestamptz not null default now()
);

create index if not exists watch_events_user_created_idx
  on public.watch_events(store_user_id, created_at desc);
create index if not exists point_ledger_source_idx
  on public.point_ledger(source, created_at desc);

alter table public.watch_events enable row level security;
revoke all on table public.watch_events from anon, authenticated;

create or replace function public.award_watch_points(
  p_event_key text,
  p_kick_user_id text,
  p_channel_user_id text,
  p_watch_minutes integer,
  p_points bigint
)
returns table (awarded boolean, new_points bigint, event_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.store_users%rowtype;
  v_event public.watch_events%rowtype;
begin
  if p_event_key is null or char_length(trim(p_event_key)) < 16 or char_length(trim(p_event_key)) > 200 then
    raise exception 'INVALID_EVENT_KEY';
  end if;
  if p_kick_user_id is null or char_length(trim(p_kick_user_id)) < 1 or char_length(trim(p_kick_user_id)) > 100 then
    raise exception 'INVALID_KICK_USER_ID';
  end if;
  if p_channel_user_id is null or char_length(trim(p_channel_user_id)) < 1 or char_length(trim(p_channel_user_id)) > 100 then
    raise exception 'INVALID_CHANNEL_USER_ID';
  end if;
  if p_watch_minutes is null or p_watch_minutes < 1 or p_watch_minutes > 120 then
    raise exception 'INVALID_WATCH_MINUTES';
  end if;
  if p_points is null or p_points < 1 or p_points > 100000 then
    raise exception 'INVALID_POINTS';
  end if;

  select * into v_user
  from public.store_users
  where kick_user_id = trim(p_kick_user_id)
  for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  select * into v_event from public.watch_events where event_key = trim(p_event_key);
  if found then
    return query select false, v_user.points, v_event.id;
    return;
  end if;

  insert into public.watch_events (
    event_key, store_user_id, kick_user_id, channel_user_id,
    watch_minutes, points_awarded
  ) values (
    trim(p_event_key), v_user.id, trim(p_kick_user_id), trim(p_channel_user_id),
    p_watch_minutes, p_points
  ) returning * into v_event;

  update public.store_users
  set points = points + p_points, updated_at = now()
  where id = v_user.id
  returning points into v_user.points;

  insert into public.point_ledger (
    store_user_id, direction, amount, source, reason
  ) values (
    v_user.id, 'credit', p_points, 'watch', 'verified watch event'
  );

  return query select true, v_user.points, v_event.id;
end;
$$;

revoke all on function public.award_watch_points(text, text, text, integer, bigint)
  from public, anon, authenticated;
-- The application server alone will receive this permission.
-- Grant to service_role only.
grant execute on function public.award_watch_points(text, text, text, integer, bigint)
  to service_role;

-- Defensive constraint: every credit must remain a watch credit.
-- Existing schema already enforces this through point_ledger.source/check.
