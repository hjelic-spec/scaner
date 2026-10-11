# Skener deklaracija

Web aplikacija (PWA) za mobitel: skeniraš bar kod proizvoda kamerom, a aplikacija pregledno prikaže podatke s deklaracije:

- naziv, marka, količina, slika
- **alergeni** (14 alergena iz Uredbe (EU) br. 1169/2011) i moguće tragove
- sastojke (hrvatski tekst ako postoji, inače izvorni)
- nutritivnu tablicu na 100 g/ml i po porciji, redoslijedom iz Uredbe
- Nutri-Score, NOVA skupinu (stupanj prerade), aditive (E-brojevi)
- podrijetlo, mjesto proizvodnje, uvjeti čuvanja, pakiranje, kontakt proizvođača

## Važno: odakle dolaze podaci

Bar kod (EAN/UPC) sadrži **samo broj proizvoda**, ne i deklaraciju. Podatke zato dohvaćamo iz
[Open Food Facts](https://world.openfoodfacts.org) — besplatne, otvorene baze (licenca ODbL) koju uređuju korisnici.
To znači:

- Neki proizvodi (osobito lokalni hrvatski) **neće biti u bazi** ili će biti nepotpuni. Aplikacija tada nudi poveznicu za dodavanje.
- Podaci mogu biti zastarjeli ako je proizvođač promijenio recepturu.
- Za alergije i zdravstvene odluke **uvijek je mjerodavna deklaracija na pakiranju**.

## Pokretanje

Aplikacija je statična (HTML/CSS/JS, bez build koraka). Kamera u pregledniku radi samo preko **HTTPS-a** (ili `localhost`).

Lokalno:

```bash
python3 -m http.server 8000
# otvori http://localhost:8000
```

Na mobitelu je najlakše objaviti preko **GitHub Pages** (Settings → Pages → Deploy from branch), pa adresu
otvoriti na mobitelu i odabrati „Dodaj na početni zaslon”.

## Tehnički

- Skeniranje: ugrađeni `BarcodeDetector` (Chrome na Androidu), inače [ZXing](https://github.com/zxing-js/library)
  0.21.3 (Apache-2.0, lokalna kopija u `vendor/`) — radi i na iPhoneu.
- Podržani formati: EAN-13, EAN-8, UPC-A, UPC-E; kontrolna znamenka se provjerava prije upita.
- API: `GET https://world.openfoodfacts.org/api/v2/product/{bar kod}.json`
- Povijest zadnjih 15 skeniranja čuva se samo lokalno u pregledniku.
