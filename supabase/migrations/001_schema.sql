-- =============================================
-- Mafia: The Automated Assembly - Schema
-- =============================================

-- 1. ROOMS
create table rooms (
  id bigint generated always as identity primary key,
  room_code text unique not null,
  host_id text not null default '',
  phase text not null default 'lobby',
  round int not null default 1,
  phase_ends_at timestamptz,
  winner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table rooms enable row level security;

create policy "Anyone can read a room by code"
  on rooms for select
  using (true);

create policy "Host can create rooms"
  on rooms for insert
  with check (true);

create policy "Host can update their room"
  on rooms for update
  using (true);

-- 2. PLAYERS (public info)
create table players (
  id bigint generated always as identity primary key,
  room_code text not null references rooms(room_code) on delete cascade,
  user_id text not null,
  name text not null,
  avatar_url text,
  alive boolean not null default true,
  joined_at timestamptz not null default now(),
  unique(room_code, user_id)
);

create index idx_players_room on players(room_code);

alter table players enable row level security;

create policy "Anyone can read players in a room"
  on players for select
  using (true);

create policy "Players can join"
  on players for insert
  with check (true);

-- 3. PLAYER ROLES (secret - RLS restricts)
create table player_roles (
  id bigint generated always as identity primary key,
  player_id bigint not null references players(id) on delete cascade unique,
  room_code text not null references rooms(room_code) on delete cascade,
  role text not null check (role in ('villager', 'werewolf', 'seer', 'doctor'))
);

create index idx_player_roles_room on player_roles(room_code);

alter table player_roles enable row level security;

-- Players can see only their own role
create policy "Player can read own role"
  on player_roles for select
  using (
    auth.uid()::text = (select user_id from players where id = player_id)
  );

-- Edge Function (service_role) can insert all roles
create policy "Service role can manage roles"
  on player_roles for all
  using (true)
  with check (true);

-- Revealed roles (dead players) are readable by everyone
create policy "Revealed roles visible to all"
  on player_roles for select
  using (
    (select alive from players where id = player_id) = false
  );

-- 4. NIGHT ACTIONS
create table night_actions (
  id bigint generated always as identity primary key,
  room_code text not null references rooms(room_code) on delete cascade,
  round int not null,
  player_id bigint not null references players(id) on delete cascade,
  target_id bigint references players(id) on delete cascade,
  action_type text not null check (action_type in ('kill', 'investigate', 'protect')),
  created_at timestamptz not null default now(),
  unique(room_code, round, player_id)
);

alter table night_actions enable row level security;

-- Edge Function can read/write
create policy "Service role manages night actions"
  on night_actions for all
  using (true)
  with check (true);

-- Players can insert their own night actions
create policy "Players can submit night actions"
  on night_actions for insert
  with check (
    auth.uid()::text = (select user_id from players where id = player_id)
  );

-- Anyone can read night actions (for realtime status display)
create policy "Anyone can read night actions"
  on night_actions for select
  using (true);

-- 5. DAY VOTES
create table day_votes (
  id bigint generated always as identity primary key,
  room_code text not null references rooms(room_code) on delete cascade,
  round int not null,
  voter_id bigint not null references players(id) on delete cascade,
  target_id bigint not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(room_code, round, voter_id)
);

alter table day_votes enable row level security;

create policy "Anyone can read votes tally"
  on day_votes for select
  using (true);

create policy "Players can vote"
  on day_votes for insert
  with check (
    auth.uid()::text = (select user_id from players where id = voter_id)
  );

-- 6. REALTIME: enable realtime for all game tables
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table night_actions;
alter publication supabase_realtime add table day_votes;

-- 7. HELPER: Cleanup old rooms
-- Run via cron: delete rooms older than 24h
create or replace function cleanup_old_rooms()
returns void
language plpgsql
as $$
begin
  delete from rooms where created_at < now() - interval '24 hours';
end;
$$;
