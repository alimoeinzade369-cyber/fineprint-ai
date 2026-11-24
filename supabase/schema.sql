-- Run this file in Supabase SQL Editor.
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 credits integer not null default 5 check (credits >= 0),
 created_at timestamptz not null default now()
);
-- Ensure existing projects also have the canonical credit column.
-- The application reads and writes public.profiles.credits.
alter table public.profiles
 add column if not exists credits integer not null default 5;

create table if not exists public.scans (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 file_name text,
 risk_score integer not null check (risk_score between 0 and 100),
 summary text not null default '',
 red_flags jsonb not null default '[]'::jsonb,
 advice jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.scans enable row level security;
create policy "Users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users create own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users read own scans" on public.scans for select using (auth.uid() = user_id);
create policy "Service role manages profiles" on public.profiles for all using (auth.role() = 'service_role');
create policy "Service role manages scans" on public.scans for all using (auth.role() = 'service_role');
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles(id,credits) values(new.id,5) on conflict(id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();