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

  function parseLabel(text) {
    const ingredients = findIngredients(text);
    return {
      ingredients,
      traces: findTraces(text),
      nutriments: findNutrition(text),
      allergens: suggestAllergens(ingredients),
    };
  }

  /* ---------- OCR ---------- */

  let workerPromise = null;

  function abs(path) {
    // Tesseract radnik se pokreće iz blob: URL-a, pa su potrebne apsolutne adrese.
    return new URL(path, document.baseURI).href;
  }

  function getWorker(onProgress) {
    if (!workerPromise) {
      workerPromise = root.Tesseract.createWorker(['hrv', 'eng'], root.Tesseract.OEM.LSTM_ONLY, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core/'),
        langPath: abs('vendor/tesseract/lang'),
        logger: (m) => { if (getWorker.onProgress) getWorker.onProgress(m); },
      }).catch((err) => { workerPromise = null; throw err; });
    }
    getWorker.onProgress = onProgress;
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
    const canvas = await prepareImage(file);
    const { data } = await worker.recognize(canvas);
    return { text: data.text || '', confidence: data.confidence };
  }

  const api = { parseLabel, findIngredients, findNutrition, findTraces, suggestAllergens, recognize, fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LabelOcr = api;
})(typeof self !== 'undefined' ? self : this);
