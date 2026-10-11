# Skener deklaracija

Aplikacija za mobitel (Android i web): skeniraš bar kod proizvoda i vidiš sve podatke s deklaracije.
Korisnici mogu dodavati proizvode koji nedostaju i ispravljati postojeće u **zajedničkoj bazi**, a drugi korisnici
potvrđuju je li unos točan.

## Kako radi

1. **Skeniranje** kamerom (EAN-13, EAN-8, UPC-A, UPC-E) ili ručni upis broja; provjerava se kontrolna znamenka.
2. **Pretraga redom:**
   1. zajednička baza aplikacije (Supabase)
   2. podaci spremljeni na uređaju (ako zajednička baza nije spojena ili nije dostupna)
   3. otvorene baze [Open Food Facts](https://world.openfoodfacts.org), [Open Beauty Facts](https://world.openbeautyfacts.org),
      [Open Pet Food Facts](https://world.openpetfoodfacts.org) i [Open Products Facts](https://world.openproductsfacts.org)
3. **Nema proizvoda ili su podaci nepotpuni?** Korisnik unosi podatke ručno ili fotografira deklaraciju — tekst se
   prepoznaje na samom uređaju i automatski popunjava polja. Za slanje je potrebna prijava (jednokratni kod e-poštom).

### Pravila objave (moderacija)

| Situacija | Što se događa |
|---|---|
| Novi proizvod ili ispravak **neprovjerenog** | Odmah vidljivo svima s oznakom **Neprovjereno** |
| **2** druga korisnika potvrde „👍 Točno je” | Status **✓ Provjereno** |
| **3** korisnika prijave „👎 Grešku” | Status **⚠ Prijavljena greška** — svatko može ispraviti |
| Izmjena **provjerenog** proizvoda | Sprema se kao **prijedlog** (prikazuju se razlike); postaje važeća kad je potvrde 2 korisnika, a odbacuje se nakon 3 prijave |
| Autor | Ne može glasati za vlastiti unos |
| Administrator | Izmjene odmah važeće; može vratiti raniju verziju, odbaciti prijedlog ili obrisati proizvod |

Ograničenja protiv zlouporabe: najviše 30 unosa i 200 glasova po korisniku na sat. Sva pravila provode se u bazi
(Row Level Security + funkcije), ne u aplikaciji — zaobilaženjem aplikacije ne mogu se zaobići.

## Podaci s deklaracije

Polja su definirana na jednom mjestu, u `fields.js` (i provjeravaju se u bazi). Prikazuju se ovisno o vrsti proizvoda.

| Skupina | Polja |
|---|---|
| Osnovno | vrsta proizvoda, naziv, naziv hrane / opis, marka, neto količina, neto ocijeđena masa, veličina porcije, kategorija, fotografija |
| Sastav | sastojci (kozmetika: INCI), 14 alergena (Uredba (EU) 1169/2011, Prilog II.), „može sadržavati tragove” |
| Nutritivna izjava | energija (kJ/kcal), masti, zasićene, jednostruko i višestruko nezasićene, ugljikohidrati, šećeri, polioli, škrob, vlakna, bjelančevine, sol — na 100 g/ml i po porciji; alkohol (% vol.) |
| Analitički sastojci (ljubimci) | sirove bjelančevine, masti, vlakna, pepeo, vlaga |
| **Podrijetlo** | **zemlja podrijetla / proizvodnje** (popis zemalja), mjesto proizvodnje, podrijetlo glavnog sastojka, identifikacijska oznaka (ovalni žig) |
| Proizvođač i distributer | proizvođač, adresa, **zemlja proizvođača**; uvoznik / distributer / „proizvedeno za”, adresa, **zemlja distributera**; kontakt |
| Čuvanje i uporaba | uvjeti čuvanja, upute za uporabu, namjena, rok nakon otvaranja (kozmetika), upozorenja |
| Ostalo | oznake i certifikati, ambalaža i recikliranje, napomene |

Zemlje se biraju s popisa ISO 3166-1 zemalja s hrvatskim nazivima (`countries.js`), pa se mogu pouzdano pretraživati.
Prepoznavanje teksta pretvara „Zemlja podrijetla: Hrvatskoj”, „Made in Italy” i sl. u kod zemlje.

**Namjerno nisu polja:** rok trajanja i broj serije — otisnuti su na svakom pakiranju drugačije, pa nisu podatak o proizvodu.

**Prefiks bar koda** (npr. 385 = Hrvatska) prikazuje se samo informativno: označava GS1 organizaciju koja je
dodijelila broj, **ne** zemlju proizvodnje.

---

## Postavljanje zajedničke baze (Supabase)

Bez ovoga aplikacija radi kao prije (Open Facts + spremanje na uređaju).

1. Otvori račun na [supabase.com](https://supabase.com) i napravi **novi projekt**. Za regiju odaberi EU
   (npr. Frankfurt) zbog GDPR-a.
2. **SQL Editor → New query** → zalijepi cijeli sadržaj `supabase/migrations/0001_init.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email**: uključeno. Prijava radi jednokratnim kodom, pa u
   **Authentication → Emails → Magic Link** predložak dodaj kod, npr.:
   ```html
   <h2>Kod za prijavu</h2>
   <p>Tvoj kod za Skener deklaracija: <strong>{{ .Token }}</strong></p>
   ```
4. Ugrađeni Supabaseov poslužitelj e-pošte namijenjen je samo testiranju i šalje vrlo malo poruka na sat. Prije
   objave postavi vlastiti SMTP (**Authentication → Emails → SMTP Settings**).
5. **Project Settings → API**: kopiraj **Project URL** i **anon public** ključ u `config.js`.
   `anon` ključ je javan i smije biti u aplikaciji. **Nikad** ne upisuj `service_role` ključ.
6. **Administrator:** prijavi se u aplikaciji, zatim u SQL Editoru:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'tvoja@adresa.hr';
   ```
   Administratorske radnje zasad se pozivaju iz SQL Editora, npr.
   `select admin_publish_revision(123);`, `select admin_reject_revision(124);`, `select admin_delete_product('385…');`
   (prije poziva postavi `set request.jwt.claim.sub = '<tvoj user id>';` jer funkcije provjeravaju ovlast).

## Android aplikacija

Android aplikacija je ista web aplikacija zapakirana s [Capacitorom](https://capacitorjs.com) 8.5.2
(`android/`). Sve datoteke su u aplikaciji, pa se otvara i bez interneta (pretraga ipak treba internet).

### Testna verzija (APK)

Svaki push na GitHub automatski gradi APK (**Actions → Android i baza → Artifacts → skener-deklaracija-debug-apk**).
Preuzmi ga na mobitel, raspakiraj i instaliraj (Android će tražiti dopuštenje za instalaciju iz nepoznatih izvora).

### Objava na Google Play

1. Otvori [Google Play Console](https://play.google.com/console) račun (jednokratna registracijska naknada).
   Google za nove osobne račune traži zatvoreno testiranje s testerima prije javne objave — provjeri aktualne uvjete.
2. Napravi ključ za potpisivanje **jednom** i čuvaj ga sigurno (gubitkom ključa ne možeš objavljivati nadogradnje):
   ```bash
   keytool -genkeypair -v -keystore release.keystore -alias skener -keyalg RSA -keysize 4096 -validity 10000
   base64 -w0 release.keystore   # rezultat ide u ANDROID_KEYSTORE_BASE64
   ```
3. Na GitHubu: **Settings → Secrets and variables → Actions** dodaj `ANDROID_KEYSTORE_BASE64`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (npr. `skener`), `ANDROID_KEY_PASSWORD`.
4. Sljedeći push gradi potpisani **AAB** (artifact `skener-deklaracija-release-aab`) koji se učitava u Play Console.
5. Play Console traži poveznicu na pravila privatnosti — `privacy.html` je **predložak**: popuni podatke u uglatim
   zagradama i daj ga na pregled prije objave.
6. ID aplikacije je `hr.skener.deklaracija` (`capacitor.config.json`, `android/app/build.gradle`). Promijeni ga
   **prije** prve objave ako želiš drugi — kasnije se ne može mijenjati.

### Lokalna izgradnja (Android Studio)

```bash
npm ci
npm run android:sync   # kopira web datoteke u www/ i u Android projekt
npm run android:open   # otvara Android Studio
```

## Web verzija

Ista aplikacija radi i kao web stranica (GitHub Pages iz grane `main`). Kamera u pregledniku radi samo preko HTTPS-a.

## Testiranje baze

`supabase/tests/moderation_test.sql` provjerava pravila objave, glasanje, prava pristupa, ograničenja i brisanje
računa na običnom PostgreSQL-u (uz `supabase_stub.sql` koji simulira Supabaseove dijelove). Isti testovi se pokreću
na GitHub Actions.

```bash
createdb t
psql -d t -f supabase/tests/supabase_stub.sql
psql -d t -f supabase/migrations/0001_init.sql
psql -d t -f supabase/tests/moderation_test.sql   # na kraju: SVI TESTOVI PROŠLI
```

## Ograničenja

- Podatke unose korisnici; „provjereno” znači da su ih potvrdila dva druga korisnika, ne službena provjera.
  **Za alergije i zdravstvene odluke uvijek je mjerodavna deklaracija na pakiranju.**
- Prepoznavanje teksta je heurističko: dobro radi na oštroj, ravnoj fotografiji; lošije na zakrivljenim i sjajnim
  pakiranjima i tablicama s više stupaca. Prijedlog alergena ne vidi podebljanja na pakiranju.
- Podaci preuzeti iz Open Facts baza su pod licencom ODbL; spremanjem u zajedničku bazu ta licenca vrijedi i za
  izvedenu bazu (navođenje izvora, dijeljenje pod istim uvjetima).

## Struktura

| Datoteka | Sadržaj |
|---|---|
| `index.html`, `styles.css` | sučelje |
| `app.js` | skeniranje, pretraga, prikaz, obrazac, glasanje, prijava |
| `fields.js` | polja deklaracije, alergeni, nutrijenti, zemlje, GS1 prefiksi |
| `countries.js` | ISO 3166-1 zemlje s hrvatskim nazivima (iz i18n-iso-countries 7.14.0, MIT) |
| `api.js`, `config.js` | spajanje na Supabase |
| `ocr.js` | prepoznavanje teksta (Tesseract.js 7.0.0, hrv+eng) i izvlačenje polja iz teksta |
| `db.js` | lokalna pohrana (IndexedDB) |
| `supabase/` | shema baze, pravila i testovi |
| `android/`, `capacitor.config.json`, `scripts/build-web.mjs` | Android aplikacija |
| `vendor/` | ZXing 0.21.3, Tesseract.js 7.0.0, supabase-js 2.117.2 (s licencama) |
