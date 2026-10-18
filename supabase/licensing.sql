-- Chud Hud licensing. One row per issued code, keyed by the code's serial number.
-- The app calls check_license() with Supabase's public key to ask "is this code on?". Nobody can read or change the table directly:
-- row level security has no policies, and issuing, switching and listing go through admin_* functions that need the owner's secret.
-- The secret itself is never stored, only its SHA-256 (chudhud_admin).

create table if not exists public.chudhud_licenses (
  serial     bigint primary key,
  editions   text not null,                 -- "std", "lotd" or "std,lotd"
  note       text,                          -- who it was given to
  active     boolean not null default true, -- the switch
  issued_at  timestamptz not null default now(),
  expires_at timestamptz,
  last_seen  timestamptz
);
alter table public.chudhud_licenses enable row level security;

create table if not exists public.chudhud_admin (
  id          int primary key default 1 check (id = 1),
  secret_hash text not null
);
alter table public.chudhud_admin enable row level security;

create or replace function public.chudhud_is_admin(p_secret text) returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from public.chudhud_admin where secret_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'utf8')), 'hex'));
$$;

-- the app: is this code on, for this edition?
create or replace function public.check_license(p_serial bigint, p_edition text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.chudhud_licenses;
begin
  select * into r from public.chudhud_licenses where serial = p_serial;
  if not found then return jsonb_build_object('known', false, 'active', false); end if;
  update public.chudhud_licenses set last_seen = now() where serial = p_serial;
  return jsonb_build_object('known', true,
    'active', r.active and (r.expires_at is null or r.expires_at > now()) and p_edition = any(string_to_array(r.editions, ',')));
end $$;

-- the owner: register a code
create or replace function public.admin_issue(p_secret text, p_serial bigint, p_editions text, p_note text, p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.chudhud_is_admin(p_secret) then raise exception 'not allowed'; end if;
  insert into public.chudhud_licenses (serial, editions, note, expires_at) values (p_serial, p_editions, p_note, p_expires)
    on conflict (serial) do update set editions = excluded.editions, note = excluded.note, expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true);
end $$;

-- the owner: switch a code off or on
create or replace function public.admin_set(p_secret text, p_serial bigint, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.chudhud_is_admin(p_secret) then raise exception 'not allowed'; end if;
  update public.chudhud_licenses set active = p_active where serial = p_serial;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;

-- the owner: every code and when it was last seen
create or replace function public.admin_list(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.chudhud_is_admin(p_secret) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(to_jsonb(l) order by l.issued_at desc) from public.chudhud_licenses l), '[]'::jsonb);
end $$;

revoke all on function public.chudhud_is_admin(text) from public, anon, authenticated;
grant execute on function public.check_license(bigint, text) to anon, authenticated;
grant execute on function public.admin_issue(text, bigint, text, text, timestamptz) to anon, authenticated;
grant execute on function public.admin_set(text, bigint, boolean) to anon, authenticated;
grant execute on function public.admin_list(text) to anon, authenticated;
