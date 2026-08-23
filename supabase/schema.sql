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
  check (
    (direction = 'credit' and source = 'watch')
    or
    (direction = 'debit' and order_id is not null)
  )
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

create index store_users_kick_user_id_idx on public.store_users(kick_user_id);
create index point_ledger_user_created_idx on public.point_ledger(store_user_id, created_at desc);
create index orders_user_created_idx on public.orders(store_user_id, created_at desc);
create index orders_status_idx on public.orders(status);

insert into public.products (name, diamonds, price_points)
values
  ('100 جوهرة', 100, 300),
  ('300 جوهرة', 300, 900),
  ('500 جوهرة', 500, 1500),
  ('1000 جوهرة', 1000, 3000),
  ('5000 جوهرة', 5000, 15000);

-- No browser client may directly modify balances or the ledger.
alter table public.store_users enable row level security;
alter table public.products enable row level security;
alter table public.point_ledger enable row level security;
alter table public.orders enable row level security;

create policy "products_public_read_active"
on public.products for select
using (active = true);

-- The browser does not receive direct read/write access to user balances,
-- ledger entries, or orders. Server-side code uses the private service role.

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
  if p_player_name is null or char_length(trim(p_player_name)) not between 2 and 100 then
    raise exception 'INVALID_PLAYER_NAME';
  end if;
  if p_country is null or char_length(trim(p_country)) not between 2 and 80 then
    raise exception 'INVALID_COUNTRY';
  end if;
  if p_game_id is null or char_length(trim(p_game_id)) not between 2 and 80 then
    raise exception 'INVALID_GAME_ID';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id and active = true
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  select * into v_user
  from public.store_users
  where id = p_store_user_id
  for update;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  if v_user.points < v_product.price_points then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  insert into public.orders (
    store_user_id, product_id, diamonds, price_points,
    player_name, country, game_id,
    points_before, points_after
  ) values (
    v_user.id, v_product.id, v_product.diamonds, v_product.price_points,
    trim(p_player_name), trim(p_country), trim(p_game_id),
    v_user.points, v_user.points - v_product.price_points
  ) returning * into v_order;

  update public.store_users
  set points = points - v_product.price_points,
      updated_at = now()
  where id = v_user.id;

  insert into public.point_ledger (
    store_user_id, direction, amount, order_id, reason
  ) values (
    v_user.id, 'debit', v_product.price_points, v_order.id,
    'store redemption'
  );

  return v_order;
end;
$$;

revoke all on function public.spend_points_for_order(uuid, uuid, text, text, text) from public;

-- Only the server-side service role should execute the spending RPC.
-- Point credits will be added later by the watch-time service after Kick
-- attendance is verified; there is intentionally no public credit function.
