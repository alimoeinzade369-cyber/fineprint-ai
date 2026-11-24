-- Add the canonical credit balance column expected by the application.
-- Existing profile rows receive the default balance of 5 if the column is absent.
alter table public.profiles
  add column if not exists credits integer not null default 5;

-- Keep the default and non-negative invariant consistent with the base schema.
alter table public.profiles
  alter column credits set default 5;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_credits_nonnegative_check'
  ) then
    alter table public.profiles
      add constraint profiles_credits_nonnegative_check check (credits >= 0);
  end if;
end
$$;
