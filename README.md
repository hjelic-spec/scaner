# Skener deklaracija

Web aplikacija (PWA) za mobitel: skeniraš bar kod proizvoda kamerom, a aplikacija pregledno prikaže podatke s deklaracije.
Ako proizvoda nema ni u jednoj bazi, podatke možeš unijeti sam — ručno ili fotografiranjem deklaracije (prepoznavanje teksta).

## Što prikazuje

- naziv, marka, količina, slika, vrsta proizvoda
- **alergeni** (14 alergena iz Uredbe (EU) br. 1169/2011) i mogući tragovi — za hranu
- sastojci (za kozmetiku INCI popis)
- nutritivna tablica na 100 g/ml i po porciji, redoslijedom iz Uredbe — za hranu i hranu za ljubimce
- Nutri-Score, NOVA skupina, aditivi (E-brojevi)
- **zemlja proizvodnje** (uvijek) — uz mjesto proizvodnje, podrijetlo sastojaka i identifikacijsku oznaku objekta
- uvjeti čuvanja, upute i upozorenja, pakiranje, kontakt proizvođača

### Zemlja proizvodnje — što je pouzdano

- **Zemlja proizvodnje** u bazama je često prazna. Polje „Prodaje se u” (`countries`) **nije** zemlja proizvodnje.
  Ako nije poznata, upisuje se ručno ili očitava s deklaracije („Zemlja podrijetla”, „Proizvedeno u”, „Made in”).
- **Prefiks bar koda** (npr. 385 = Hrvatska) prikazuje se samo informativno: označava GS1 organizaciju koja je
  dodijelila broj, a ne zemlju proizvodnje.
- **Identifikacijska oznaka** (ovalni žig, npr. `HR 2071 EZ`) za proizvode životinjskog podrijetla označava zemlju
  objekta koji je proizvod zadnji obradio ili pakirao.

## Odakle dolaze podaci

Bar kod (EAN/UPC) sadrži **samo broj proizvoda**, ne i deklaraciju. Aplikacija redom traži:

1. **tvoje ručno unesene podatke** (spremljene na uređaju) — imaju prednost
2. paralelno u četiri otvorene baze (licenca ODbL, uređuju ih korisnici):
   - [Open Food Facts](https://world.openfoodfacts.org) — hrana i piće
   - [Open Beauty Facts](https://world.openbeautyfacts.org) — kozmetika i higijena
   - [Open Pet Food Facts](https://world.openpetfoodfacts.org) — hrana za ljubimce
   - [Open Products Facts](https://world.openproductsfacts.org) — ostali proizvodi

Ograničenja:

- Ne postoji besplatna baza **svih** proizvoda. Hrana je dobro pokrivena, kozmetika slabije, a ostali proizvodi
  (elektronika, kućanske potrepštine…) vrlo slabo. Za njih će češće trebati ručni unos.
- Podaci mogu biti nepotpuni ili zastarjeli ako je proizvođač promijenio recepturu.
- Za alergije i zdravstvene odluke **uvijek je mjerodavna deklaracija na pakiranju**.

## Ručni unos i skeniranje teksta

Kad proizvod nije pronađen (ili su podaci nepotpuni), gumb **„Unesi podatke s deklaracije”** otvara obrazac:

- **📄 Fotografiraj deklaraciju** — tekst se prepoznaje na samom uređaju ([Tesseract.js](https://github.com/naptha/tesseract.js),
  hrvatski + engleski), bez slanja slike na server. Iz teksta se automatski popunjavaju sastojci, „može sadržavati”,
  nutritivne vrijednosti i predlažu alergeni. Popunjavaju se samo prazna polja; može se fotografirati više strana pakiranja.
- Sva polja se mogu ručno upisati ili ispraviti, uz fotografiju proizvoda.
- Podaci se spremaju **samo na tom uređaju** (IndexedDB). Brisanjem podataka preglednika se gube.

Prepoznavanje je heurističko: radi dobro na oštroj, ravnoj i osvijetljenoj fotografiji, a lošije na zakrivljenim
pakiranjima, sitnom tisku i tablicama s više stupaca. Prijedlog alergena temelji se na ključnim riječima i ne vidi
podebljanje na pakiranju — **uvijek provjeri** prije spremanja.

## Pokretanje

Aplikacija je statična (HTML/CSS/JS, bez build koraka). Kamera u pregledniku radi samo preko **HTTPS-a** (ili `localhost`).

```bash
python3 -m http.server 8000
# otvori http://localhost:8000
```

Na mobitelu je najlakše objaviti preko **GitHub Pages** (Settings → Pages → Deploy from branch), pa adresu
otvoriti na mobitelu i odabrati „Dodaj na početni zaslon”.

## Tehnički

- Skeniranje: ugrađeni `BarcodeDetector` (Chrome na Androidu), inače [ZXing](https://github.com/zxing-js/library) 0.21.3.
  Formati EAN-13, EAN-8, UPC-A, UPC-E; kontrolna znamenka se provjerava prije upita.
- API: `GET https://world.open{food,beauty,petfood,products}facts.org/api/v2/product/{bar kod}.json`
- OCR: Tesseract.js 7.0.0 + tesseract.js-core 7.0.0 (LSTM varijante) i jezični podaci `hrv`/`eng` (4.0.0_best_int),
  sve lokalno u `vendor/tesseract/` (~17 MB; preuzima se tek kad se prvi put koristi skeniranje teksta).
- Datoteke: `app.js` (skeniranje, pretraga, prikaz, obrazac), `ocr.js` (OCR i raščlanjivanje teksta), `db.js` (lokalna pohrana).
- Licence knjižnica: Apache-2.0 (`vendor/ZXING-LICENSE`, `vendor/tesseract/LICENSE`, `vendor/tesseract/core/LICENSE`).
