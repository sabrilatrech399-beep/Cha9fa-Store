-- Cha9fa Store production schema
-- Points can only be granted by the server-side watch-award path.
-- Never expose service_role credentials to the browser.

create extension if not exists pgcrypto;

create type public.point_source as enum ('watch');
create type public.ledger_direction as enum ('credit', 'debit');
create type public.order_status as enum ('pending', 'processing', 'completed', 'cancelled');

create table public.store_users (
  id uuid primary key default gen_random_uuid(),
  kick_user_id text not null unique,
  kick_username text not null,
  points bigint not null default 0 check (points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  store_user_id uuid not null references public.store_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  diamonds integer not null check (diamonds > 0),
  price_points bigint not null check (price_points > 0),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.point_ledger (
  id uuid primary key default gen_random_uuid(),
  store_user_id uuid not null references public.store_users(id) on delete restrict,
  direction public.ledger_direction not null,
  amount bigint not null check (amount > 0),
  source public.point_source,
  order_id uuid,
  reason text not null,
  created_at timestamptz not null default now(),
  check ((direction = 'credit' and source = 'watch') or (direction = 'debit' and order_id is not null))
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_user_id uuid not null references public.store_users(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  diamonds integer not null check (diamonds > 0),
  price_points bigint not null check (price_points > 0),
  player_name text not null check (char_length(trim(player_name)) between 2 and 100),
  country text not null check (char_length(trim(country)) between 2 and 80),
  game_id text not null check (char_length(trim(game_id)) between 2 and 80),
  status public.order_status not null default 'pending',
  points_before bigint not null check (points_before >= price_points),
  points_after bigint not null check (points_after >= 0),
  created_at timestamptz not null default now()
);

alter table public.point_ledger
  add constraint point_ledger_order_fk
  foreign key (order_id) references public.orders(id) on delete restrict;

create table public.watch_channels (
  channel_slug text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.watch_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  store_user_id uuid not null references public.store_users(id) on delete restrict,
  channel_slug text not null references public.watch_channels(channel_slug) on delete restrict,
  points bigint not null check (points > 0 and points <= 1000),
  created_at timestamptz not null default now()
);

create index store_users_kick_user_id_idx on public.store_users(kick_user_id);
create index auth_sessions_token_hash_idx on public.auth_sessions(token_hash);
create index auth_sessions_expiry_idx on public.auth_sessions(expires_at);
create index point_ledger_user_created_idx on public.point_ledger(store_user_id, created_at desc);
create index orders_user_created_idx on public.orders(store_user_id, created_at desc);
create index orders_status_idx on public.orders(status);
create index watch_events_user_created_idx on public.watch_events(store_user_id, created_at desc);

insert into public.products (name, diamonds, price_points)
select v.name, v.diamonds, v.price_points
from (values
  ('100 جوهرة', 100, 300),
  ('300 جوهرة', 300, 900),
  ('500 جوهرة', 500, 1500),
  ('1000 جوهرة', 1000, 3000),
  ('5000 جوهرة', 5000, 15000)
) as v(name, diamonds, price_points)
where not exists (
  select 1 from public.products p where p.diamonds = v.diamonds and p.price_points = v.price_points
);

alter table public.store_users enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.products enable row level security;
alter table public.point_ledger enable row level security;
alter table public.orders enable row level security;
alter table public.watch_channels enable row level security;
alter table public.watch_events enable row level security;

revoke all on table public.store_users from anon, authenticated;
revoke all on table public.auth_sessions from anon, authenticated;
revoke all on table public.point_ledger from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.watch_channels from anon, authenticated;
revoke all on table public.watch_events from anon, authenticated;

create policy "products_public_read_active"
on public.products for select
using (active = true);

create or replace function public.spend_points_for_order(
  p_store_user_id uuid,
  p_product_id uuid,
  p_player_name text,
  p_country text,
  p_game_id text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.store_users%rowtype;
  v_product public.products%rowtype;
  v_order public.orders%rowtype;
begin
  if p_player_name is null or char_length(trim(p_player_name)) not between 2 and 100 then raise exception 'INVALID_PLAYER_NAME'; end if;
  if p_country is null or char_length(trim(p_country)) not between 2 and 80 then raise exception 'INVALID_COUNTRY'; end if;
  if p_game_id is null or char_length(trim(p_game_id)) not between 2 and 80 then raise exception 'INVALID_GAME_ID'; end if;

  select * into v_product from public.products where id = p_product_id and active = true for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;

  select * into v_user from public.store_users where id = p_store_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_user.points < v_product.price_points then raise exception 'INSUFFICIENT_POINTS'; end if;

  insert into public.orders (
    store_user_id, product_id, diamonds, price_points,
    player_name, country, game_id, points_before, points_after
  ) values (
    v_user.id, v_product.id, v_product.diamonds, v_product.price_points,
    trim(p_player_name), trim(p_country), trim(p_game_id),
    v_user.points, v_user.points - v_product.price_points
  ) returning * into v_order;

  update public.store_users
  set points = points - v_product.price_points, updated_at = now()
  where id = v_user.id;

  insert into public.point_ledger (store_user_id, direction, amount, order_id, reason)
  values (v_user.id, 'debit', v_product.price_points, v_order.id, 'store redemption');

  return v_order;
end;
$$;

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
  if p_kick_user_id is null or char_length(trim(p_kick_user_id)) < 1 then raise exception 'INVALID_KICK_USER_ID'; end if;
  if p_channel_slug is null or char_length(trim(p_channel_slug)) < 1 then raise exception 'INVALID_CHANNEL'; end if;
  if p_event_key is null or char_length(trim(p_event_key)) < 8 or char_length(trim(p_event_key)) > 200 then raise exception 'INVALID_EVENT_KEY'; end if;
  if p_points is null or p_points < 1 or p_points > 1000 then raise exception 'INVALID_POINTS'; end if;

  select * into v_channel from public.watch_channels
  where channel_slug = lower(trim(p_channel_slug)) and active = true;
  if not found then raise exception 'CHANNEL_NOT_ALLOWED'; end if;

  select * into v_user from public.store_users where kick_user_id = trim(p_kick_user_id) for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  insert into public.watch_events(event_key, store_user_id, channel_slug, points)
  values (trim(p_event_key), v_user.id, v_channel.channel_slug, p_points)
  on conflict (event_key) do nothing;

  if not found then return v_user.points; end if;

  update public.store_users
  set points = points + p_points, updated_at = now()
  where id = v_user.id
  returning * into v_user;

  insert into public.point_ledger(store_user_id, direction, amount, source, reason)
  values (v_user.id, 'credit', p_points, 'watch', 'verified stream watch');

  return v_user.points;
end;
$$;

revoke all on function public.spend_points_for_order(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.spend_points_for_order(uuid, uuid, text, text, text) to service_role;
revoke all on function public.grant_watch_points(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.grant_watch_points(text, text, text, bigint) to service_role;

-- Configure the real channel explicitly after deployment:
-- insert into public.watch_channels(channel_slug) values ('YOUR_KICK_CHANNEL_SLUG') on conflict do nothing;
-- There is intentionally no public function that can credit points.
