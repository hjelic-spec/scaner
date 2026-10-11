-- Minimalna simulacija Supabase okruženja za lokalno testiranje migracija na običnom PostgreSQL-u.
-- NE pokretati na pravom Supabase projektu (ondje ovo već postoji).

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key, email text);

-- Isto ponašanje kao Supabaseov auth.uid(): čita "sub" iz JWT postavki zahtjeva.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id bigserial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated;

grant usage on schema public to anon, authenticated;
-- Supabase po zadanom daje anon/authenticated prava nad novim tablicama u public; migracija ih mora ograničiti.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
grant select, insert on storage.objects to authenticated;
grant usage on sequence storage.objects_id_seq to authenticated;
create policy "stub: čitanje" on storage.objects for select to authenticated using (true);
