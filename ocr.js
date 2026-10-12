'use strict';

// Prepoznavanje teksta s fotografije deklaracije (Tesseract.js, lokalno u pregledniku)
// i heurističko izvlačenje sastojaka, nutritivnih vrijednosti i alergena iz tog teksta.
// Rezultat je uvijek prijedlog — korisnik ga mora provjeriti prije spremanja.

(function (root) {
  // Uklanja dijakritike i pretvara u mala slova, da regexi rade i kad OCR „izgubi” kvačice.
  function fold(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }

  function toNumber(s) {
    const n = parseFloat(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  const NUM = '(\\d+(?:[.,]\\d+)?)';

  // Oznake redaka nutritivne tablice (hrvatski + engleski, bez dijakritika).
  const NUTRIENT_PATTERNS = [
    ['saturated-fat', '(?:zasicen\\w*|saturate\\w*)'],
    ['fat', '(?:masti|mast|fat)'],
    ['sugars', '(?:secer\\w*|sugars?)'],
    ['carbohydrates', '(?:ugljikohidrat\\w*|carbohydrate\\w*)'],
    ['fiber', '(?:vlakn\\w*|fibre|fiber)'],
    ['proteins', '(?:bjelancevin\\w*|protein\\w*)'],
    ['salt', '(?:sol|salt)'],
  ];

  // Ključne riječi za prijedlog alergena (Prilog II. Uredbe 1169/2011). Namjerno konzervativno;
  // OCR ne vidi podebljanje alergena na pakiranju, pa je provjera korisnika obavezna.
  const ALLERGEN_KEYWORDS = {
    'en:gluten': /\b(gluten\w*|psenic\w*|wheat|raz[ia]?\b|rye|jecm\w*|jecam|barley|zob\w*|oats?|pir\b|pirov\w*|spelt|kamut)/,
    'en:crustaceans': /\b(rakov\w*|rak\b|skamp\w*|kozic\w*|shrimps?|prawns?|crabs?|lobsters?|crustacean\w*)/,
    'en:eggs': /\b(jaj\w*|eggs?)\b/,
    'en:fish': /\b(rib[aeuo]\b|riblj\w*|fish)/,
    'en:peanuts': /\b(kikiriki\w*|peanuts?)/,
    'en:soybeans': /\b(soj\w*|soy\w*)/,
    'en:milk': /\b(mlijek\w*|mlijec\w*|mlijecn\w*|laktoz\w*|sirutk\w*|maslac\w*|vrhnj\w*|sir|sira|sirom|milk|whey|lactose|butter|cream|cheese)\b/,
    'en:nuts': /\b(ljesnja\w*|badem\w*|orah\w*|oras[ia]\b|indijsk\w*|pistaci\w*|makadami\w*|pekan\w*|hazelnuts?|almonds?|walnuts?|cashews?|pistachios?|pecans?|macadamia)/,
    'en:celery': /\b(celer\w*|celery)/,
    'en:mustard': /\b(gorusic\w*|senf\w*|mustard)/,
    'en:sesame-seeds': /\b(sezam\w*|sesame)/,
    'en:sulphur-dioxide-and-sulphites': /\b(sulfit\w*|sulphit\w*|sumporn?\w* dioksid\w*|e ?22[0-8])\b/,
    'en:lupin': /\b(lupin\w*)/,
    'en:molluscs': /\b(mekus\w*|skoljk\w*|lignj\w*|hobotnic\w*|dagnj\w*|molluscs?|squid|octopus|mussels?)/,
  };

  const SECTION_STOP = /(nutritivn\w*|hranjiv\w*|prosjecn\w* hranjiv|nutrition|energij\w*|moze sadrzavati|moze sadrzati|may contain|cuvati|cuvajte|store in|najbolje upotrijebiti|upotrijebiti do|best before|neto kolicina|net weight|proizvodac|proizvedeno|uvoznik|distributer)/;

  function findIngredients(text) {
    const folded = fold(text);
    const m = /(sastojci|sastav|ingredients|ingredienti)\s*[:.]/.exec(folded);
    if (!m) return '';
    const start = m.index + m[0].length;
    const rest = folded.slice(start);
    const stop = SECTION_STOP.exec(rest);
    const blank = /\n\s*\n/.exec(rest);
    let end = rest.length;
    if (stop) end = Math.min(end, stop.index);
    if (blank) end = Math.min(end, blank.index);
    // Isječak uzimamo iz originalnog teksta (s dijakritikama); fold() ne mijenja duljinu
    // osim za kombinirane znakove, pa računamo na NFC tekst iz OCR-a.
    return text.normalize('NFC').slice(start, start + end).replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function findTraces(text) {
    const folded = fold(text);
    const m = /(moze sadrzavati|moze sadrzati|may contain)[^.\n]*(?:\.|\n|$)/.exec(folded);
    if (!m) return '';
    return text.normalize('NFC').slice(m.index, m.index + m[0].length).replace(/\s+/g, ' ').trim();
  }

  function findNutrition(text) {
    const folded = fold(text);
    // Tražimo samo od zaglavlja nutritivne tablice (ili prvog spomena energije), da riječi
    // poput „šećer” iz popisa sastojaka ne bi dale krive brojke.
    const head = /(nutritivn\w*|hranjiv\w*|nutrition|energij\w*|energy)/.exec(folded);
    if (!head) return {};
    const zone = folded.slice(head.index);
    const out = {};

    const kj = new RegExp(NUM + '\\s*kj\\b').exec(zone);
    if (kj) out['energy-kj'] = toNumber(kj[1]);
    const kcal = new RegExp(NUM + '\\s*kcal\\b').exec(zone);
    if (kcal) out['energy-kcal'] = toNumber(kcal[1]);

    for (const [key, label] of NUTRIENT_PATTERNS) {
      // Oznaka, pa do 40 znakova u istom retku bez znamenki, pa broj s jedinicom g.
      const re = new RegExp('\\b' + label + '\\b[^\\d\\n]{0,40}?' + NUM + '\\s*g\\b');
      const m = re.exec(zone);
      if (m) out[key] = toNumber(m[1]);
    }
    return out;
  }

  function suggestAllergens(ingredientsText) {
    const folded = fold(ingredientsText || '')
      // Biljni „maslac” i „mlijeko” nisu alergen mlijeko (npr. kakaov maslac, kokosovo mlijeko);
      // zadržavamo prvu riječ, da npr. „bademovo mlijeko” i dalje označi orašaste plodove.
      .replace(/\b(kakaov\w*|cocoa|shea|karite|kokosov\w*|coconut|bademov\w*|almond|sojin\w*|soy|zob\w*|oat|rizin\w*|rice)\s+(maslac\w*|butter|mlijek\w*|milk|napitak)/g, '$1');
    return Object.keys(ALLERGEN_KEYWORDS).filter((tag) => ALLERGEN_KEYWORDS[tag].test(folded));
  }

  /* ---------- Zemlja proizvodnje ---------- */

  // „Proizvedeno za …” namjerno nije na popisu — to je naručitelj/distributer, ne mjesto proizvodnje.
  const COUNTRY_RE = /(zemlja (?:podrijetla|porijekla|proizvodnje)|proizvedeno u|proizvedeno i pakirano u|zemlja podrijetla proizvoda|made in|produced in|country of origin|hergestellt in|ursprungsland)\s*[:\-]?\s*([^,.;:\n()]{2,40})/;

  function findCountry(text) {
    const nfc = (text || '').normalize('NFC');
    const m = COUNTRY_RE.exec(fold(nfc));
    if (!m) return '';
    const start = m.index + m[0].length - m[2].length;
    return nfc.slice(start, start + m[2].length).trim();
  }

  /* ---------- Ostali podaci s deklaracije ---------- */

  // Vrijednost iza oznake u istom retku (npr. „Proizvođač: Kraš d.d., Ravnice 48, Zagreb”).
  // Regex se izvršava nad tekstom bez dijakritika, a isječak se vraća iz izvornog teksta.
  function afterLabel(text, labelRe, maxLen = 160) {
    const nfc = (text || '').normalize('NFC');
    // Dopušta dodatak prije dvotočke: „Uvoznik za BiH: …”, „Importer for UK: …”.
    const re = new RegExp('(?:^|[\\s.;])(?:' + labelRe + ')(?:\\s+(?:za|for)\\s+[^:\\n]{1,25}(?=:))?\\s*[:\\-]?\\s*([^\\n]{2,' + maxLen + '})', 'm');
    const m = re.exec(fold(nfc));
    if (!m) return '';
    const start = m.index + m[0].length - m[1].length;
    return nfc.slice(start, start + m[1].length).replace(/[\s.;,]+$/, '').trim();
  }

  // „Kraš d.d., Ravnice 48, 10000 Zagreb” → naziv do prvog zareza, ostatak je adresa.
  function splitNameAddress(value) {
    if (!value) return { name: '', address: '' };
    const i = value.indexOf(',');
    return i === -1 ? { name: value, address: '' } : { name: value.slice(0, i).trim(), address: value.slice(i + 1).trim() };
  }

  function findManufacturer(text) {
    return splitNameAddress(afterLabel(text, 'proizvodac|proizvodi|proizveo|manufacturer|manufactured by|producer|hersteller'));
  }

  function findDistributor(text) {
    return splitNameAddress(afterLabel(text,
      'uvoznik|uvozi|distributer|distribuira|proizvedeno za|stavlja na trziste|importer|imported by|distributor|distributed by'));
  }

  function findStorage(text) {
    const nfc = (text || '').normalize('NFC');
    const m = /\b(cuvati|cuvajte|cuvat|store|keep)\b[^.\n]{3,150}\.?/.exec(fold(nfc));
    return m ? nfc.slice(m.index, m.index + m[0].length).trim() : '';
  }

  function findAlcohol(text) {
    const m = /(\d{1,2}(?:[.,]\d)?)\s*%\s*vol\b/.exec(fold(text || ''));
    return m ? toNumber(m[1]) : null;
  }

  const AMOUNT = '(\\d+(?:[.,]\\d+)?\\s*(?:kg|g|mg|l|ml|cl|dl))\\b';

  function findDrainedWeight(text) {
    const m = new RegExp('(?:neto ocijedena masa|ocijedena masa|drained weight)\\s*[:.]?\\s*' + AMOUNT).exec(fold(text || ''));
    return m ? m[1].replace(/\s+/g, ' ') : '';
  }

  function findQuantity(text) {
    const folded = fold(text || '');
    let m = new RegExp('(?:neto (?!ocijed)(?:kolicina|masa|kol\\.?|sadrzaj|volumen)?|net (?:weight|wt\\.?|quantity|content)|nazivna kolicina)\\s*[:.]?\\s*' + AMOUNT).exec(folded);
    if (!m) m = new RegExp(AMOUNT + '\\s*\u212e').exec(folded); // znak ℮ (procijenjena količina)
    return m ? m[1].replace(/\s+/g, ' ') : '';
  }

  // Ovalni žig: „HR 1234 EZ”, „FR 72.264.002 CE”, „DE BY 123 EG” (zemlja, broj objekta, oznaka EU).
  function findIdentificationMark(text) {
    const m = /\b([A-Z]{2})[\s-]?((?:[A-Z]{2}[\s-])?\d{1,6}(?:[.\-\s]\d{1,6}){0,3})[\s-]?(EZ|EC|EG|CE|EY|EK|EB|EU|WE|ES)\b/.exec(text || '');
    return m ? `${m[1]} ${m[2].trim()} ${m[3]}` : '';
  }

  // Vraća prijedloge vrijednosti s ključevima polja iz fields.js (country_text se pretvara u ISO kod u aplikaciji).
  function parseLabel(text) {
    const ingredients = findIngredients(text);
    const manufacturer = findManufacturer(text);
    const distributor = findDistributor(text);
    return {
      ingredients_text: ingredients,
      traces_text: findTraces(text),
      nutriments: findNutrition(text),
      allergens: suggestAllergens(ingredients),
      country_text: findCountry(text),
      manufacturer_name: manufacturer.name,
      manufacturer_address: manufacturer.address,
      distributor_name: distributor.name,
      distributor_address: distributor.address,
      storage_conditions: findStorage(text),
      alcohol_percent: findAlcohol(text),
      quantity: findQuantity(text),
      drained_weight: findDrainedWeight(text),
      identification_mark: findIdentificationMark(text),
    };
  }

  /* ---------- OCR ---------- */

  let workerPromise = null;
  let lastWorkerError = null;

  // Faze iz Tesseractovog izvještaja o napretku, na hrvatskom (prikazuju se korisniku).
  const STAGES = {
    'loading tesseract core': 'Učitavam program za prepoznavanje teksta',
    'initializing tesseract': 'Pokrećem prepoznavanje teksta',
    'loading language traineddata': 'Učitavam hrvatski i engleski jezik',
    'loading language traineddata (from cache)': 'Učitavam hrvatski i engleski jezik',
    'initializing api': 'Pripremam prepoznavanje',
    'recognizing text': 'Prepoznajem tekst',
  };
  const INIT_TIMEOUT_MS = 90000;
  const RECOGNIZE_TIMEOUT_MS = 180000;

  function abs(path) {
    return new URL(path, document.baseURI).href;
  }

  function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    ]).finally(() => clearTimeout(timer));
  }

  function errorText(e) {
    if (!e) return '';
    if (typeof e === 'string') return e;
    return e.message || String(e);
  }

  function getWorker(onProgress) {
    getWorker.onProgress = onProgress;
    if (!workerPromise) {
      lastWorkerError = null;
      let stage = 'pokretanje';
      // Tesseract pri neuspjelom učitavanju jezika ne odbija obećanje nego čeka zauvijek,
      // pa grešku iz errorHandlera prosljeđujemo odmah.
      let failInit = null;
      const initFailed = new Promise((_, reject) => { failInit = reject; });
      const created = root.Tesseract.createWorker(['hrv', 'eng'], root.Tesseract.OEM.LSTM_ONLY, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core/'),
        langPath: abs('vendor/tesseract/lang'),
        // Datoteke su komprimirane (gzip), ali namjerno BEZ nastavka .gz: Androidov alat za pakiranje
        // datoteke s nastavkom .gz raspakira i preimenuje, pa ih aplikacija ne bi našla. Tesseract
        // komprimiranost prepoznaje po sadržaju, a gzip: false znači samo da adresi ne dodaje „.gz”.
        gzip: false,
        // Pozadinski proces se učitava izravno s adrese aplikacije, a ne iz blob: URL-a — u Android
        // WebViewu (Capacitor) blob-radnik zna tiho zapeti pri učitavanju skripti.
        workerBlobURL: false,
        // Bez ovoga Tesseract grešku iz radnika baca kao neuhvaćenu iznimku umjesto da je javi.
        errorHandler: (e) => {
          lastWorkerError = e;
          if (failInit) failInit(new Error(errorText(e)));
        },
        logger: (m) => {
          if (m && m.status) stage = STAGES[m.status] || m.status;
          if (getWorker.onProgress) getWorker.onProgress({ ...m, label: STAGES[m.status] || m.status });
        },
      });
      workerPromise = withTimeout(Promise.race([created, initFailed]), INIT_TIMEOUT_MS, 'isteklo vrijeme')
        .then((w) => { failInit = null; return w; })
        .catch((err) => {
          failInit = null;
          workerPromise = null;
          created.then((w) => w.terminate()).catch(() => {});
          const detail = errorText(lastWorkerError) || errorText(err);
          throw new Error(`Prepoznavanje teksta se nije pokrenulo (zapelo kod: ${stage}). ${detail}`.trim());
        });
    }
    return workerPromise;
  }

  // Smanjuje fotografiju (mobiteli daju 12+ MP) i pretvara u sive tonove — brže i točnije za OCR.
  async function prepareImage(file, maxSide = 2000) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.3)';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    return canvas;
  }

  async function recognize(file, onProgress) {
    const worker = await getWorker(onProgress);
    if (onProgress) onProgress({ status: 'preparing', label: 'Pripremam fotografiju', progress: 0 });
    const canvas = await prepareImage(file);
    const { data } = await withTimeout(worker.recognize(canvas), RECOGNIZE_TIMEOUT_MS,
      'Prepoznavanje traje predugo. Pokušaj s manjim isječkom deklaracije.');
    return { text: data.text || '', confidence: data.confidence };
  }

  /* ---------- Android: izvorna kamera + Google ML Kit ---------- */

  // U Android aplikaciji (Capacitor) koristi se izvorna kamera i ML Kit umjesto Tesseracta u WebViewu.
  function native() {
    const cap = root.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform() || !cap.registerPlugin) return null;
    if (!native.plugins) {
      native.plugins = { camera: cap.registerPlugin('Camera'), text: cap.registerPlugin('TextRecognition') };
    }
    return native.plugins;
  }

  function isCancel(err) {
    return /cancel|odustao|no image/i.test(errorText(err));
  }

  // Snima fotografiju izvornom kamerom. Vraća { uri, webPath } ili null ako je korisnik odustao.
  async function takeNativePhoto() {
    try {
      const photo = await native().camera.takePhoto({ quality: 90, correctOrientation: true, saveToGallery: false });
      return photo && photo.uri ? photo : null;
    } catch (err) {
      if (isCancel(err)) return null;
      throw new Error('Kamera se ne može otvoriti: ' + errorText(err));
    }
  }

  async function recognizeNative(onProgress) {
    const photo = await takeNativePhoto();
    if (!photo) return null;
    if (onProgress) onProgress({ status: 'recognizing text', label: 'Prepoznajem tekst', progress: 0.5 });
    const result = await withTimeout(native().text.recognize({ uri: photo.uri }), RECOGNIZE_TIMEOUT_MS,
      'Prepoznavanje traje predugo.');
    return { text: (result && result.text) || '', confidence: null };
  }

  const api = {
    hasNative: () => Boolean(native()), recognizeNative, takeNativePhoto,
    parseLabel, findIngredients, findNutrition, findTraces, suggestAllergens, findCountry, findManufacturer,
    findDistributor, findStorage, findAlcohol, findQuantity, findDrainedWeight, findIdentificationMark, recognize, fold,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LabelOcr = api;
})(typeof self !== 'undefined' ? self : this);
