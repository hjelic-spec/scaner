-- Testovi pravila objave, glasanja i prava pristupa.
-- Pokretanje (lokalni PostgreSQL): vidi README, odjeljak „Testiranje baze”.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@test');
insert into public.admins (user_id) values ('00000000-0000-0000-0000-0000000000ad');

create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p, false);
$$;

create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'Očekivana greška (%) nije se dogodila: %', p_like, p_sql;
exception when others then
  if sqlerrm like 'Očekivana greška%' then raise; end if;
  if sqlerrm not like p_like then
    raise exception 'Kriva greška za %: % (očekivano %)', p_sql, sqlerrm, p_like;
  end if;
end;
$$;

create function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'NEUSPJEH: %', p_msg; end if;
  raise notice 'OK: %', p_msg;
end;
$$;
set client_min_messages = notice;

-- 1) Anonimni korisnik može čitati, ali ne i pisati
set role anon;
select pg_temp.as_user('');
select pg_temp.expect_error($$select public.submit_revision('3850000000015', '{"product_name":"X"}')$$, '%permission denied%');
select pg_temp.expect_error($$insert into public.products (code, data) values ('3850000000015', '{}')$$, '%permission denied%');
select pg_temp.check((select count(*) from public.products) = 0, 'anon smije čitati products (prazno)');
reset role;

-- 2) Validacija
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select public.submit_revision('3850000000016', '{"product_name":"X"}')$$, 'Neispravan bar kod.');
select pg_temp.expect_error($$select public.submit_revision('3850000000015', '{"brands":"X"}')$$, 'Naziv proizvoda je obavezan.');
select pg_temp.expect_error($$select public.submit_revision('3850000000015', '{"product_name":"X","hack":1}')$$, 'Nepoznato polje hack.');
select pg_temp.expect_error($$select public.submit_revision('3850000000015', '{"product_name":"X","country_of_origin":"Hrvatska"}')$$, '%ISO kod zemlje%');
select pg_temp.expect_error($$select public.submit_revision('3850000000015', '{"product_name":"X","allergens":["en:wood"]}')$$, 'Nepoznat alergen.');
select pg_temp.expect_error($$select public.submit_revision('3850000000015', '{"product_name":"X","nutriments":{"fat_100g":-1}}')$$, '%izvan dopuštenog raspona%');
select pg_temp.expect_error($$select public.submit_revision('3850000000015', '{"product_name":"X","nutriments":{"vodka_100g":1}}')$$, 'Nepoznata nutritivna vrijednost%');
select pg_temp.expect_error($$update public.products set status = 'verified'$$, '%permission denied%');
select pg_temp.expect_error($$insert into public.votes (revision_id, user_id, value) values (1, auth.uid(), 1)$$, '%permission denied%');

-- 3) Novi proizvod → odmah objavljen, neprovjeren; prazni tekstovi uklonjeni
select pg_temp.check(
  (public.submit_revision('3850000000015',
    '{"product_name":"Keksi","brands":"  ","country_of_origin":"HR","allergens":["en:milk","en:milk"],"nutriments":{"fat_100g":21.5}}') ->> 'state') = 'published',
  'novi proizvod objavljen odmah');
reset role;
select pg_temp.check((select status from public.products where code = '3850000000015') = 'unverified', 'status je unverified');
select pg_temp.check((select data from public.products where code = '3850000000015') =
  '{"type":"food","product_name":"Keksi","country_of_origin":"HR","allergens":["en:milk"],"nutriments":{"fat_100g":21.5}}'::jsonb,
  'podaci očišćeni (prazna marka uklonjena, duplikat alergena uklonjen, zadana vrsta food)');

-- 4) Autor ne može glasati za sebe
set role authenticated;
select pg_temp.expect_error($$select public.vote((select current_revision_id from public.products where code='3850000000015'), 1)$$, 'Ne možeš potvrditi%');

-- 5) Dvije potvrde → provjereno; ponovljeni glas istog korisnika ne broji se dvaput
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.vote((select current_revision_id from public.products where code='3850000000015'), 1);
select public.vote((select current_revision_id from public.products where code='3850000000015'), 1);
select pg_temp.check((select status from public.products where code='3850000000015') = 'unverified', 'jedna potvrda nije dovoljna (ponovljeni glas se ne broji)');
select pg_temp.check((select count(*) from public.votes) = 1, 'korisnik vidi samo svoj glas');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.vote((select current_revision_id from public.products where code='3850000000015'), 1);
select pg_temp.check((select status from public.products where code='3850000000015') = 'verified', 'dvije potvrde → verified');

-- 6) Izmjena provjerenog proizvoda → prijedlog (pending), podaci se ne mijenjaju
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((public.submit_revision('3850000000015', '{"product_name":"Vandalizam"}') ->> 'state') = 'pending', 'izmjena provjerenog je pending');
select pg_temp.check((select product_name from public.products where code='3850000000015') = 'Keksi', 'provjereni podaci nisu prepisani');
-- isti korisnik šalje novi prijedlog → stari se zamjenjuje
select public.submit_revision('3850000000015', '{"product_name":"Keksi s čokoladom","country_of_origin":"SI"}');
select pg_temp.check((select count(*) from public.revisions where code='3850000000015' and state='pending') = 1, 'samo jedan aktivni prijedlog po korisniku');

-- 7) Tri prijave odbacuju prijedlog
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.submit_revision('3850000000015', '{"product_name":"Krivo"}');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.vote((select id from public.revisions where data->>'product_name'='Krivo'), -1, 'nije točno');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.vote((select id from public.revisions where data->>'product_name'='Krivo'), -1);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.vote((select id from public.revisions where data->>'product_name'='Krivo'), -1);
select pg_temp.check((select state from public.revisions where data->>'product_name'='Krivo') = 'rejected', 'tri prijave → prijedlog odbijen');
select pg_temp.expect_error($$select public.vote((select id from public.revisions where data->>'product_name'='Krivo'), 1)$$, 'Ova verzija podataka više nije aktivna.');

-- 8) Prijedlog s dvije potvrde postaje važeći
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select public.submit_revision('3850000000015', '{"product_name":"Keksi s lješnjacima","country_of_origin":"HR","manufacturer_country":"SI"}');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.vote((select id from public.revisions where data->>'product_name'='Keksi s lješnjacima'), 1);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.vote((select id from public.revisions where data->>'product_name'='Keksi s lješnjacima'), 1);
select pg_temp.check((select product_name from public.products where code='3850000000015') = 'Keksi s lješnjacima', 'potvrđeni prijedlog je sada važeći');
select pg_temp.check((select status from public.products where code='3850000000015') = 'verified', 'i ostaje provjeren');
select pg_temp.check((select count(*) from public.revisions where code='3850000000015' and state='published') = 1, 'samo jedna objavljena revizija');

-- 9) Tri prijave za važeću reviziju → disputed
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.vote((select current_revision_id from public.products where code='3850000000015'), -1);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.vote((select current_revision_id from public.products where code='3850000000015'), -1);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.vote((select current_revision_id from public.products where code='3850000000015'), -1);
select pg_temp.check((select status from public.products where code='3850000000015') = 'disputed', 'tri prijave → disputed');

-- 10) Sporni (ne provjereni) proizvod može se odmah ispraviti
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((public.submit_revision('3850000000015', '{"product_name":"Keksi s lješnjacima 200 g","country_of_origin":"HR"}') ->> 'state') = 'published', 'ispravak spornog objavljen odmah');
select pg_temp.check((select status from public.products where code='3850000000015') = 'unverified', 'nakon ispravka ponovno neprovjereno');

-- 11) Administrator
select pg_temp.expect_error($$select public.admin_set_status('3850000000015', 'verified')$$, 'Samo administrator.');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
select public.admin_set_status('3850000000015', 'verified');
select pg_temp.check((select status from public.products where code='3850000000015') = 'verified', 'admin može postaviti status');
select pg_temp.check((public.submit_revision('3850000000015', '{"product_name":"Admin ispravak"}') ->> 'state') = 'published', 'admin izmjena provjerenog objavljena odmah');
select public.admin_publish_revision((select id from public.revisions where data->>'product_name'='Keksi'));
select pg_temp.check((select product_name from public.products where code='3850000000015') = 'Keksi', 'admin vraća raniju reviziju');

-- 12) Ograničenje broja unosa
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare i int;
begin
  for i in 1..30 loop
    perform public.submit_revision('4006381333931', jsonb_build_object('product_name', 'Test ' || i));
  end loop;
end $$;
select pg_temp.expect_error($$select public.submit_revision('4006381333931', '{"product_name":"previše"}')$$, 'Previše unosa%');

-- 13) Brisanje računa: glasovi se brišu i brojevi se preračunavaju, unosi ostaju bez autora
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.submit_revision('5000112637922', '{"product_name":"Sok","type":"food"}');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.vote((select current_revision_id from public.products where code='5000112637922'), 1);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.vote((select current_revision_id from public.products where code='5000112637922'), 1);
reset role;
select pg_temp.check((select status from public.products where code='5000112637922') = 'verified', 'sok provjeren');
set role authenticated;
select public.delete_my_account();  -- korisnik D
reset role;
select pg_temp.check((select confirmations from public.revisions where id = (select current_revision_id from public.products where code='5000112637922')) = 1, 'nakon brisanja računa ostaje 1 potvrda');
select pg_temp.check((select status from public.products where code='5000112637922') = 'unverified', 'status se vraća na unverified');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.delete_my_account();  -- korisnik A (autor)
reset role;
select pg_temp.check((select author from public.revisions where code='5000112637922' limit 1) is null, 'unos ostaje, autor uklonjen');
select pg_temp.check(exists(select 1 from public.products where code='5000112637922'), 'proizvod ostaje nakon brisanja autora');

-- 14) Upload slika samo u vlastitu mapu
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into storage.objects (bucket_id, name) values ('product-images', '00000000-0000-0000-0000-00000000000b/x.jpg');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('product-images', '00000000-0000-0000-0000-00000000000c/x.jpg')$$, '%row-level security%');
reset role;

select 'SVI TESTOVI PROŠLI' as rezultat;
