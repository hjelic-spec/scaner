-- Skener deklaracija — zajednička baza proizvoda (Supabase / PostgreSQL)
--
-- Model:
--   products   — trenutno važeći podaci o proizvodu (jedan red po bar kodu)
--   revisions  — povijest svih unosa i prijedloga izmjena
--   votes      — potvrde (+1) i prijave greške (−1) korisnika za pojedinu reviziju
--   admins     — korisnici s administratorskim ovlastima
--
-- Pravila objave (moderacija):
--   * Novi proizvod ili izmjena NEPROVJERENOG proizvoda objavljuje se odmah, sa statusom 'unverified'.
--   * Kad VERIFY_THRESHOLD drugih korisnika potvrdi trenutnu reviziju → status 'verified'.
--   * Kad REPORT_THRESHOLD korisnika prijavi grešku → status 'disputed' (prikazuje se upozorenje).
--   * Izmjena PROVJERENOG proizvoda ne prepisuje ga odmah: sprema se kao 'pending' prijedlog i postaje
--     važeća tek kad je potvrdi VERIFY_THRESHOLD drugih korisnika (ili je prihvati administrator).
--   * Autor ne može glasati za vlastitu reviziju.
--
-- Sve izmjene podataka idu isključivo kroz funkcije (RPC) ispod; izravan INSERT/UPDATE/DELETE
-- na tablice nije dopušten (Row Level Security).

-- ---------------------------------------------------------------------------
-- Postavke
-- ---------------------------------------------------------------------------

create or replace function public.cfg_verify_threshold() returns int language sql immutable as $$ select 2 $$;
create or replace function public.cfg_report_threshold() returns int language sql immutable as $$ select 3 $$;
create or replace function public.cfg_revisions_per_hour() returns int language sql immutable as $$ select 30 $$;
create or replace function public.cfg_votes_per_hour() returns int language sql immutable as $$ select 200 $$;

-- ---------------------------------------------------------------------------
-- Tablice
-- ---------------------------------------------------------------------------

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.products (
  code text primary key,
  status text not null default 'unverified' check (status in ('unverified', 'verified', 'disputed')),
  data jsonb not null,
  current_revision_id bigint,
  product_name text generated always as (data ->> 'product_name') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.revisions (
  id bigint generated always as identity primary key,
  code text not null references public.products (code) on delete cascade,
  data jsonb not null,
  author uuid references auth.users (id) on delete set null,
  state text not null check (state in ('published', 'pending', 'superseded', 'rejected')),
  confirmations int not null default 0,
  reports int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.products
  add constraint products_current_revision_fk
  foreign key (current_revision_id) references public.revisions (id) on delete set null;

create index revisions_code_idx on public.revisions (code, created_at desc);
create index revisions_author_idx on public.revisions (author, created_at desc);
create index revisions_pending_idx on public.revisions (code) where state = 'pending';
create index products_name_idx on public.products using gin (to_tsvector('simple', coalesce(product_name, '')));

create table public.votes (
  revision_id bigint not null references public.revisions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  value smallint not null check (value in (1, -1)),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  primary key (revision_id, user_id)
);

create index votes_user_idx on public.votes (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Pomoćne funkcije
-- ---------------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- GS1 kontrolna znamenka za EAN-8, UPC-A (12), EAN-13 i GTIN-14.
create or replace function public.gtin_valid(p_code text) returns boolean
language plpgsql immutable as $$
declare
  digits int[];
  n int;
  s int := 0;
  i int;
begin
  if p_code is null or p_code !~ '^([0-9]{8}|[0-9]{12,14})$' then
    return false;
  end if;
  n := length(p_code);
  for i in 1 .. n - 1 loop
    -- težine 3,1,3,1… gledano od znamenke lijevo od kontrolne
    s := s + substr(p_code, n - i, 1)::int * case when i % 2 = 1 then 3 else 1 end;
  end loop;
  return (10 - s % 10) % 10 = substr(p_code, n, 1)::int;
end;
$$;

-- Provjerava i čisti podatke proizvoda. Nepoznati ključevi i neispravne vrijednosti odbijaju se
-- s porukom na hrvatskom; prazni tekstovi se uklanjaju.
create or replace function public.validate_product_data(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  text_fields constant text[] := array[
    'product_name', 'legal_name', 'brands', 'quantity', 'drained_weight', 'serving_size', 'categories',
    'ingredients_text', 'traces_text', 'place_of_provenance', 'primary_ingredient_origin', 'identification_mark',
    'manufacturer_name', 'manufacturer_address', 'distributor_name', 'distributor_address', 'customer_service',
    'storage_conditions', 'usage_instructions', 'warnings', 'product_function', 'labels', 'packaging', 'notes',
    'image_path'];
  long_fields constant text[] := array['ingredients_text', 'usage_instructions', 'warnings', 'notes'];
  country_fields constant text[] := array['country_of_origin', 'manufacturer_country', 'distributor_country'];
  number_fields constant text[] := array['alcohol_percent', 'pao_months',
    'pet_protein', 'pet_fat', 'pet_fibre', 'pet_ash', 'pet_moisture'];
  allowed_types constant text[] := array['food', 'beauty', 'pet', 'products'];
  allowed_allergens constant text[] := array[
    'en:gluten', 'en:crustaceans', 'en:eggs', 'en:fish', 'en:peanuts', 'en:soybeans', 'en:milk', 'en:nuts',
    'en:celery', 'en:mustard', 'en:sesame-seeds', 'en:sulphur-dioxide-and-sulphites', 'en:lupin', 'en:molluscs'];
  nutrient_keys constant text[] := array[
    'energy-kj', 'energy-kcal', 'fat', 'saturated-fat', 'monounsaturated-fat', 'polyunsaturated-fat',
    'carbohydrates', 'sugars', 'polyols', 'starch', 'fiber', 'proteins', 'salt'];
  out jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  t text;
  num numeric;
  nk text;
  nv jsonb;
  nut jsonb := '{}'::jsonb;
  base text;
  suffix text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Podaci moraju biti objekt.' using errcode = '22023';
  end if;

  for k, v in select * from jsonb_each(p) loop
    if v is null or v = 'null'::jsonb then
      continue;
    elsif k = 'type' then
      if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (allowed_types)) then
        raise exception 'Neispravna vrsta proizvoda.' using errcode = '22023';
      end if;
      out := out || jsonb_build_object(k, v);
    elsif k = any (text_fields) then
      if jsonb_typeof(v) <> 'string' then
        raise exception 'Polje % mora biti tekst.', k using errcode = '22023';
      end if;
      t := btrim(v #>> '{}');
      if t = '' then continue; end if;
      if char_length(t) > (case when k = any (long_fields) then 5000 else 1000 end) then
        raise exception 'Polje % je predugačko.', k using errcode = '22023';
      end if;
      if k = 'image_path' and t !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$' then
        raise exception 'Neispravna putanja slike.' using errcode = '22023';
      end if;
      out := out || jsonb_build_object(k, t);
    elsif k = any (country_fields) then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[A-Z]{2}$' then
        raise exception 'Polje % mora biti ISO kod zemlje (npr. HR).', k using errcode = '22023';
      end if;
      out := out || jsonb_build_object(k, v);
    elsif k = any (number_fields) then
      if jsonb_typeof(v) <> 'number' then
        raise exception 'Polje % mora biti broj.', k using errcode = '22023';
      end if;
      num := (v #>> '{}')::numeric;
      if num < 0 or num > (case when k = 'pao_months' then 120 else 100 end) then
        raise exception 'Vrijednost polja % je izvan dopuštenog raspona.', k using errcode = '22023';
      end if;
      out := out || jsonb_build_object(k, v);
    elsif k = 'allergens' then
      if jsonb_typeof(v) <> 'array' then
        raise exception 'Alergeni moraju biti popis.' using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(v) e
                 where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (allowed_allergens))) then
        raise exception 'Nepoznat alergen.' using errcode = '22023';
      end if;
      out := out || jsonb_build_object(k, (select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from jsonb_array_elements(v) e));
    elsif k = 'nutriments' then
      if jsonb_typeof(v) <> 'object' then
        raise exception 'Nutritivne vrijednosti moraju biti objekt.' using errcode = '22023';
      end if;
      for nk, nv in select * from jsonb_each(v) loop
        base := regexp_replace(nk, '_(100g|serving)$', '');
        suffix := substring(nk from '_(100g|serving)$');
        if suffix is null or not (base = any (nutrient_keys)) then
          raise exception 'Nepoznata nutritivna vrijednost %.', nk using errcode = '22023';
        end if;
        if jsonb_typeof(nv) <> 'number' then
          raise exception 'Nutritivna vrijednost % mora biti broj.', nk using errcode = '22023';
        end if;
        num := (nv #>> '{}')::numeric;
        if num < 0 or num > (case when base like 'energy-%' then 10000 else 1000 end) then
          raise exception 'Nutritivna vrijednost % je izvan dopuštenog raspona.', nk using errcode = '22023';
        end if;
        nut := nut || jsonb_build_object(nk, nv);
      end loop;
      if nut <> '{}'::jsonb then
        out := out || jsonb_build_object('nutriments', nut);
      end if;
    else
      raise exception 'Nepoznato polje %.', k using errcode = '22023';
    end if;
  end loop;

  if coalesce(out ->> 'product_name', '') = '' then
    raise exception 'Naziv proizvoda je obavezan.' using errcode = '22023';
  end if;
  if not out ? 'type' then
    out := out || '{"type": "food"}'::jsonb;
  end if;
  return out;
end;
$$;

-- Primjenjuje ishod glasanja na reviziju i proizvod. Poziva se iz okidača nad tablicom votes.
create or replace function public.apply_vote_outcome(p_revision_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.revisions%rowtype;
  p public.products%rowtype;
  c int;
  rep int;
begin
  select
    count(*) filter (where value = 1),
    count(*) filter (where value = -1)
  into c, rep
  from public.votes where revision_id = p_revision_id;

  update public.revisions set confirmations = c, reports = rep
  where id = p_revision_id
  returning * into r;
  if not found then return; end if;

  select * into p from public.products where code = r.code for update;

  if r.state = 'published' and p.current_revision_id = r.id then
    update public.products set status =
      case
        when rep >= cfg_report_threshold() then 'disputed'
        when c >= cfg_verify_threshold() then 'verified'
        else 'unverified'
      end
    where code = r.code;
  elsif r.state = 'pending' then
    if rep >= cfg_report_threshold() then
      update public.revisions set state = 'rejected' where id = r.id;
    elsif c >= cfg_verify_threshold() and c > rep then
      update public.revisions set state = 'superseded' where id = p.current_revision_id;
      update public.revisions set state = 'published' where id = r.id;
      update public.products
        set data = r.data, current_revision_id = r.id, status = 'verified', updated_at = now()
        where code = r.code;
    end if;
  end if;
end;
$$;

create or replace function public.votes_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.apply_vote_outcome(coalesce(new.revision_id, old.revision_id));
  return null;
end;
$$;

create trigger votes_changed
after insert or update or delete on public.votes
for each row execute function public.votes_after_change();

-- ---------------------------------------------------------------------------
-- RPC funkcije za aplikaciju
-- ---------------------------------------------------------------------------

-- Unos novog proizvoda ili prijedlog izmjene. Vraća {revision_id, state, status}.
create or replace function public.submit_revision(p_code text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  clean jsonb;
  p public.products%rowtype;
  rev_id bigint;
  rev_state text;
  admin boolean := public.is_admin();
begin
  if uid is null then
    raise exception 'Za slanje podataka potrebna je prijava.' using errcode = '42501';
  end if;
  if not public.gtin_valid(p_code) then
    raise exception 'Neispravan bar kod.' using errcode = '22023';
  end if;
  if not admin and (select count(*) from public.revisions
      where author = uid and created_at > now() - interval '1 hour') >= cfg_revisions_per_hour() then
    raise exception 'Previše unosa u kratkom vremenu. Pokušaj ponovno za sat vremena.' using errcode = '54000';
  end if;

  clean := public.validate_product_data(p_data);

  select * into p from public.products where code = p_code for update;

  if not found then
    insert into public.products (code, data, status) values (p_code, clean, case when admin then 'verified' else 'unverified' end);
    insert into public.revisions (code, data, author, state) values (p_code, clean, uid, 'published')
      returning id into rev_id;
    update public.products set current_revision_id = rev_id where code = p_code;
    rev_state := 'published';
  elsif p.status = 'verified' and not admin then
    -- Ako je korisnik već predložio izmjenu ovog proizvoda, novi prijedlog je zamjenjuje.
    update public.revisions set state = 'superseded'
      where code = p_code and author = uid and state = 'pending';
    insert into public.revisions (code, data, author, state) values (p_code, clean, uid, 'pending')
      returning id into rev_id;
    rev_state := 'pending';
  else
    update public.revisions set state = 'superseded' where id = p.current_revision_id;
    insert into public.revisions (code, data, author, state) values (p_code, clean, uid, 'published')
      returning id into rev_id;
    update public.products
      set data = clean, current_revision_id = rev_id, updated_at = now(),
          status = case when admin then 'verified' else 'unverified' end
      where code = p_code;
    rev_state := 'published';
  end if;

  return jsonb_build_object(
    'revision_id', rev_id,
    'state', rev_state,
    'status', (select status from public.products where code = p_code));
end;
$$;

-- Potvrda (+1) ili prijava greške (−1) za reviziju. Ponovni glas mijenja prethodni.
create or replace function public.vote(p_revision_id bigint, p_value int, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.revisions%rowtype;
begin
  if uid is null then
    raise exception 'Za glasanje potrebna je prijava.' using errcode = '42501';
  end if;
  if p_value not in (1, -1) then
    raise exception 'Neispravan glas.' using errcode = '22023';
  end if;
  select * into r from public.revisions where id = p_revision_id;
  if not found or r.state not in ('published', 'pending') then
    raise exception 'Ova verzija podataka više nije aktivna.' using errcode = '22023';
  end if;
  if r.author = uid then
    raise exception 'Ne možeš potvrditi ili prijaviti vlastiti unos.' using errcode = '42501';
  end if;
  if (select count(*) from public.votes where user_id = uid and created_at > now() - interval '1 hour')
      >= cfg_votes_per_hour() then
    raise exception 'Previše glasova u kratkom vremenu.' using errcode = '54000';
  end if;

  insert into public.votes (revision_id, user_id, value, comment)
  values (p_revision_id, uid, p_value::smallint, nullif(btrim(p_comment), ''))
  on conflict (revision_id, user_id)
  do update set value = excluded.value, comment = excluded.comment, created_at = now();

  select * into r from public.revisions where id = p_revision_id;
  return jsonb_build_object(
    'revision_state', r.state,
    'confirmations', r.confirmations,
    'reports', r.reports,
    'status', (select status from public.products where code = r.code));
end;
$$;

-- Brisanje vlastitog računa (GDPR). Unosi ostaju u bazi bez autora; glasovi se brišu.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Nisi prijavljen.' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Administratorske funkcije
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_status(p_code text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Samo administrator.' using errcode = '42501'; end if;
  if p_status not in ('unverified', 'verified', 'disputed') then
    raise exception 'Neispravan status.' using errcode = '22023';
  end if;
  update public.products set status = p_status, updated_at = now() where code = p_code;
end;
$$;

-- Postavlja odabranu reviziju (npr. raniju ili predloženu) kao važeću.
create or replace function public.admin_publish_revision(p_revision_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.revisions%rowtype;
begin
  if not public.is_admin() then raise exception 'Samo administrator.' using errcode = '42501'; end if;
  select * into r from public.revisions where id = p_revision_id;
  if not found then raise exception 'Revizija ne postoji.' using errcode = '22023'; end if;
  update public.revisions set state = 'superseded'
    where id = (select current_revision_id from public.products where code = r.code);
  update public.revisions set state = 'published' where id = r.id;
  update public.products
    set data = r.data, current_revision_id = r.id, status = 'verified', updated_at = now()
    where code = r.code;
end;
$$;

create or replace function public.admin_reject_revision(p_revision_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Samo administrator.' using errcode = '42501'; end if;
  update public.revisions set state = 'rejected' where id = p_revision_id and state = 'pending';
end;
$$;

create or replace function public.admin_delete_product(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Samo administrator.' using errcode = '42501'; end if;
  delete from public.products where code = p_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prava pristupa (Row Level Security)
-- ---------------------------------------------------------------------------

alter table public.products enable row level security;
alter table public.revisions enable row level security;
alter table public.votes enable row level security;
alter table public.admins enable row level security;

create policy "Proizvodi su javni" on public.products for select to anon, authenticated using (true);
create policy "Revizije su javne" on public.revisions for select to anon, authenticated using (true);
create policy "Korisnik vidi svoje glasove" on public.votes for select to authenticated using (user_id = auth.uid());
create policy "Korisnik vidi je li administrator" on public.admins for select to authenticated using (user_id = auth.uid());

-- Izravno pisanje u tablice nije dopušteno nikome osim vlasniku baze; sve ide kroz funkcije.
revoke insert, update, delete on public.products, public.revisions, public.votes, public.admins from anon, authenticated;

-- Funkcije se po zadanom mogu pozvati od strane svih (PUBLIC); dopuštamo samo ono što aplikacija treba.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.submit_revision(text, jsonb) to authenticated;
grant execute on function public.vote(bigint, int, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_set_status(text, text) to authenticated;
grant execute on function public.admin_publish_revision(bigint) to authenticated;
grant execute on function public.admin_reject_revision(bigint) to authenticated;
grant execute on function public.admin_delete_product(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Pohrana fotografija (Supabase Storage)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Prijavljeni korisnik smije učitavati samo u svoju mapu: <user_id>/<datoteka>
create policy "Upload u vlastitu mapu" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);
