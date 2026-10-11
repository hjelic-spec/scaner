'use strict';

// Polja deklaracije — jedno mjesto koje određuje i obrazac za unos i prikaz proizvoda.
// Ključevi moraju odgovarati provjeri u supabase/migrations (validate_product_data).
//
// Izvori za hranu: Uredba (EU) br. 1169/2011, čl. 9. (obvezni podaci) i Prilog XV. (nutritivna izjava);
// za kozmetiku: Uredba (EC) br. 1223/2009, čl. 19.; za hranu za životinje: Uredba (EC) br. 767/2009.
// Rok trajanja i broj serije namjerno nisu polja — otisnuti su na svakom pakiranju drugačije.

const PRODUCT_TYPES = {
  food: 'Hrana i piće',
  beauty: 'Kozmetika i higijena',
  pet: 'Hrana za kućne ljubimce',
  products: 'Ostali proizvodi',
};

// 14 alergena iz Priloga II. Uredbe (EU) br. 1169/2011 (oznake kao u Open Food Facts).
const ALLERGENS_HR = {
  'en:gluten': 'Žitarice koje sadrže gluten',
  'en:crustaceans': 'Rakovi i proizvodi od rakova',
  'en:eggs': 'Jaja i proizvodi od jaja',
  'en:fish': 'Riba i riblji proizvodi',
  'en:peanuts': 'Kikiriki i proizvodi od kikirikija',
  'en:soybeans': 'Zrna soje i proizvodi od soje',
  'en:milk': 'Mlijeko i mliječni proizvodi',
  'en:nuts': 'Orašasti plodovi',
  'en:celery': 'Celer i proizvodi od celera',
  'en:mustard': 'Gorušica i proizvodi od gorušice',
  'en:sesame-seeds': 'Sjemenke sezama i proizvodi od sezama',
  'en:sulphur-dioxide-and-sulphites': 'Sumporov dioksid i sulfiti',
  'en:lupin': 'Lupina i proizvodi od lupine',
  'en:molluscs': 'Mekušci i proizvodi od mekušaca',
};

// Nutritivna izjava, redoslijedom iz Priloga XV. Uredbe 1169/2011 (neobavezni redci označeni optional).
const NUTRIENTS = [
  { key: 'energy-kj', label: 'Energija', unit: 'kJ' },
  { key: 'energy-kcal', label: 'Energija', unit: 'kcal' },
  { key: 'fat', label: 'Masti', unit: 'g' },
  { key: 'saturated-fat', label: 'od kojih zasićene masne kiseline', unit: 'g', sub: true },
  { key: 'monounsaturated-fat', label: 'od kojih jednostruko nezasićene', unit: 'g', sub: true, optional: true },
  { key: 'polyunsaturated-fat', label: 'od kojih višestruko nezasićene', unit: 'g', sub: true, optional: true },
  { key: 'carbohydrates', label: 'Ugljikohidrati', unit: 'g' },
  { key: 'sugars', label: 'od kojih šećeri', unit: 'g', sub: true },
  { key: 'polyols', label: 'od kojih polioli', unit: 'g', sub: true, optional: true },
  { key: 'starch', label: 'od kojih škrob', unit: 'g', sub: true, optional: true },
  { key: 'fiber', label: 'Vlakna', unit: 'g', optional: true },
  { key: 'proteins', label: 'Bjelančevine', unit: 'g' },
  { key: 'salt', label: 'Sol', unit: 'g' },
];

const ALL = ['food', 'beauty', 'pet', 'products'];
const FOOD = ['food'];
const EDIBLE = ['food', 'pet'];

// type: text | textarea | country | number | select | allergens | nutrition | image
// types: za koje vrste proizvoda se polje prikazuje; labelFor: drugačiji naziv po vrsti.
const FIELD_SECTIONS = [
  {
    id: 'basic',
    title: 'Osnovno',
    fields: [
      { key: 'type', label: 'Vrsta proizvoda', type: 'select', options: PRODUCT_TYPES, types: ALL },
      { key: 'product_name', label: 'Naziv proizvoda', type: 'text', required: true, types: ALL, placeholder: 'npr. Keksi s čokoladom' },
      {
        key: 'legal_name', label: 'Naziv hrane (opis s pakiranja)', type: 'text', types: ALL,
        labelFor: { beauty: 'Opis / vrsta proizvoda', products: 'Opis proizvoda' },
        placeholder: 'npr. Mliječna čokolada s lješnjacima',
      },
      { key: 'brands', label: 'Marka', type: 'text', types: ALL },
      {
        key: 'quantity', label: 'Neto količina', type: 'text', types: ALL,
        labelFor: { beauty: 'Nazivna količina' }, placeholder: 'npr. 500 g, 250 ml, 3 × 100 g',
      },
      { key: 'drained_weight', label: 'Neto ocijeđena masa', type: 'text', types: FOOD, placeholder: 'npr. 240 g' },
      { key: 'serving_size', label: 'Veličina porcije', type: 'text', types: EDIBLE, placeholder: 'npr. 30 g' },
      { key: 'categories', label: 'Kategorija', type: 'text', types: ALL },
      { key: 'image_path', label: 'Fotografija proizvoda', type: 'image', types: ALL },
    ],
  },
  {
    id: 'composition',
    title: 'Sastav',
    titleFor: { beauty: 'Sastojci (INCI)', products: 'Sastav i materijali' },
    fields: [
      {
        key: 'ingredients_text', label: 'Popis sastojaka', type: 'textarea', types: ALL,
        labelFor: { beauty: 'Sastojci (INCI popis)', pet: 'Sastav', products: 'Sastav / materijali' },
        help: 'Prepiši redom kako piše na pakiranju, s postocima (npr. „lješnjaci 13 %”).',
      },
      { key: 'allergens', label: 'Alergeni', type: 'allergens', types: FOOD },
      { key: 'traces_text', label: 'Može sadržavati tragove', type: 'text', types: FOOD, placeholder: 'npr. Može sadržavati tragove orašastih plodova.' },
    ],
  },
  {
    id: 'nutrition',
    title: 'Nutritivna izjava',
    fields: [
      { key: 'nutriments', label: 'Nutritivne vrijednosti', type: 'nutrition', types: FOOD },
      { key: 'alcohol_percent', label: 'Alkohol (% vol.)', type: 'number', types: FOOD, step: '0.1', max: 100 },
    ],
  },
  {
    id: 'pet-analysis',
    title: 'Analitički sastojci',
    fields: [
      { key: 'pet_protein', label: 'Sirove bjelančevine (%)', type: 'number', types: ['pet'], step: '0.1', max: 100 },
      { key: 'pet_fat', label: 'Sirove masti i ulja (%)', type: 'number', types: ['pet'], step: '0.1', max: 100 },
      { key: 'pet_fibre', label: 'Sirova vlakna (%)', type: 'number', types: ['pet'], step: '0.1', max: 100 },
      { key: 'pet_ash', label: 'Sirovi pepeo (%)', type: 'number', types: ['pet'], step: '0.1', max: 100 },
      { key: 'pet_moisture', label: 'Vlaga (%)', type: 'number', types: ['pet'], step: '0.1', max: 100 },
    ],
  },
  {
    id: 'origin',
    title: 'Podrijetlo',
    fields: [
      { key: 'country_of_origin', label: 'Zemlja podrijetla / proizvodnje', type: 'country', types: ALL },
      { key: 'place_of_provenance', label: 'Mjesto proizvodnje', type: 'text', types: ALL, placeholder: 'npr. Zagreb, tvornica Dubrava' },
      {
        key: 'primary_ingredient_origin', label: 'Podrijetlo glavnog sastojka', type: 'text', types: EDIBLE,
        placeholder: 'npr. Mlijeko podrijetlom iz Hrvatske',
      },
      {
        key: 'identification_mark', label: 'Identifikacijska oznaka (ovalni žig)', type: 'text', types: EDIBLE,
        placeholder: 'npr. HR 1234 EZ',
        help: 'Za proizvode životinjskog podrijetla: zemlja i broj objekta koji je proizvod zadnji obradio ili pakirao.',
      },
    ],
  },
  {
    id: 'operator',
    title: 'Proizvođač i distributer',
    fields: [
      {
        key: 'manufacturer_name', label: 'Proizvođač', type: 'text', types: ALL,
        labelFor: { beauty: 'Odgovorna osoba / proizvođač' },
      },
      { key: 'manufacturer_address', label: 'Adresa proizvođača', type: 'text', types: ALL },
      { key: 'manufacturer_country', label: 'Zemlja proizvođača', type: 'country', types: ALL },
      {
        key: 'distributor_name', label: 'Uvoznik / distributer / „Proizvedeno za”', type: 'text', types: ALL,
      },
      { key: 'distributor_address', label: 'Adresa uvoznika / distributera', type: 'text', types: ALL },
      { key: 'distributor_country', label: 'Zemlja uvoznika / distributera', type: 'country', types: ALL },
      { key: 'customer_service', label: 'Kontakt (telefon, e-mail, web)', type: 'text', types: ALL },
    ],
  },
  {
    id: 'usage',
    title: 'Čuvanje i uporaba',
    fields: [
      { key: 'storage_conditions', label: 'Uvjeti čuvanja', type: 'text', types: ALL, placeholder: 'npr. Čuvati na suhom i hladnom mjestu.' },
      {
        key: 'usage_instructions', label: 'Upute za uporabu', type: 'textarea', types: ALL,
        labelFor: { pet: 'Upute za hranjenje' },
      },
      { key: 'product_function', label: 'Namjena proizvoda', type: 'text', types: ['beauty', 'products'] },
      {
        key: 'pao_months', label: 'Rok nakon otvaranja (mjeseci)', type: 'number', types: ['beauty'], step: '1', max: 120,
        help: 'Simbol otvorene posudice, npr. „12M” = 12 mjeseci.',
      },
      {
        key: 'warnings', label: 'Upozorenja', type: 'textarea', types: ALL,
        placeholder: 'npr. Pakirano u zaštitnoj atmosferi. Sadrži sladila.',
      },
    ],
  },
  {
    id: 'other',
    title: 'Ostalo',
    fields: [
      { key: 'labels', label: 'Oznake i certifikati', type: 'text', types: ALL, placeholder: 'npr. Eko, Bez glutena, Halal' },
      { key: 'packaging', label: 'Ambalaža i oznake za recikliranje', type: 'text', types: ALL },
      { key: 'notes', label: 'Napomene', type: 'textarea', types: ALL },
    ],
  },
];

const FIELD_BY_KEY = Object.fromEntries(FIELD_SECTIONS.flatMap((s) => s.fields).map((f) => [f.key, f]));

function fieldLabel(field, type) {
  return (field.labelFor && field.labelFor[type]) || field.label;
}

function sectionTitle(section, type) {
  return (section.titleFor && section.titleFor[type]) || section.title;
}

function fieldApplies(field, type) {
  return field.types.includes(type);
}

/* ---------- Zemlje ---------- */

const COUNTRY_NAME = Object.fromEntries(COUNTRY_DATA.map(([code, hr]) => [code, hr[0]]));
const COUNTRY_OPTIONS = COUNTRY_DATA
  .map(([code, hr]) => [code, hr[0]])
  .sort((a, b) => a[1].localeCompare(b[1], 'hr'));

function countryName(code) {
  return COUNTRY_NAME[code] || code || '';
}

function foldText(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

// Prepoznaje zemlju iz slobodnog teksta („Hrvatska”, „Sloveniji”, „MADE IN ITALY”, „HR”).
// Vraća ISO kod ili null. Za padeže uspoređuje zajednički početak riječi (najmanje 5 slova).
const COUNTRY_INDEX = COUNTRY_DATA.flatMap(([code, hr, en]) => [...hr, ...en].map((n) => [foldText(n), code]));

function matchCountry(text) {
  if (!text) return null;
  const t = foldText(text).replace(/[.,;:]+$/, '');
  if (/^[a-z]{2}$/.test(t) && COUNTRY_NAME[t.toUpperCase()]) return t.toUpperCase();
  const exact = COUNTRY_INDEX.find(([n]) => n === t);
  if (exact) return exact[1];
  let best = null;
  let bestLen = 0;
  let tie = false;
  for (const [n, code] of COUNTRY_INDEX) {
    let i = 0;
    while (i < n.length && i < t.length && n[i] === t[i]) i++;
    // Riječ mora biti „ista” do kraja osnove: preostali dio i u tekstu i u nazivu najviše 3 slova (padež).
    if (i >= 5 && n.length - i <= 3 && t.length - i <= 3) {
      if (i > bestLen) { best = code; bestLen = i; tie = false; } else if (i === bestLen && code !== best) tie = true;
    }
  }
  if (best && !tie) return best;

  // Višeriječni nazivi u padežu („Bosni i Hercegovini”, „Sjedinjenim Američkim Državama”): riječ po riječ.
  const words = t.split(/\s+/);
  if (words.length > 1) {
    const sameWord = (a, b) => {
      if (a.length <= 2 || b.length <= 2) return a === b;
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return i >= 3 && a.length - i <= 3 && b.length - i <= 3;
    };
    const hits = new Set(COUNTRY_INDEX
      .filter(([n]) => { const nw = n.split(/\s+/); return nw.length === words.length && nw.every((w, k) => sameWord(w, words[k])); })
      .map(([, code]) => code));
    if (hits.size === 1) return [...hits][0];
  }
  return null;
}

/* ---------- GS1 prefiksi ---------- */

// https://www.gs1.org/standards/id-keys/company-prefix
// PAŽNJA: prefiks označava nacionalnu GS1 organizaciju koja je dodijelila broj, NE zemlju proizvodnje.
const GS1_PREFIXES = [
  [0, 19, 'SAD i Kanada'], [30, 39, 'SAD i Kanada'], [60, 139, 'SAD i Kanada'],
  [300, 379, 'Francuska'], [380, 380, 'Bugarska'], [383, 383, 'Slovenija'], [385, 385, 'Hrvatska'],
  [387, 387, 'Bosna i Hercegovina'], [389, 389, 'Crna Gora'], [400, 440, 'Njemačka'],
  [450, 459, 'Japan'], [490, 499, 'Japan'], [460, 469, 'Rusija'], [471, 471, 'Tajvan'],
  [474, 474, 'Estonija'], [475, 475, 'Latvija'], [477, 477, 'Litva'], [481, 481, 'Bjelorusija'],
  [482, 482, 'Ukrajina'], [484, 484, 'Moldavija'], [489, 489, 'Hong Kong'],
  [500, 509, 'Ujedinjeno Kraljevstvo'], [520, 521, 'Grčka'], [529, 529, 'Cipar'], [530, 530, 'Albanija'],
  [531, 531, 'Sjeverna Makedonija'], [535, 535, 'Malta'], [539, 539, 'Irska'],
  [540, 549, 'Belgija i Luksemburg'], [560, 560, 'Portugal'], [569, 569, 'Island'], [570, 579, 'Danska'],
  [590, 590, 'Poljska'], [594, 594, 'Rumunjska'], [599, 599, 'Mađarska'], [600, 601, 'Južna Afrika'],
  [640, 649, 'Finska'], [690, 699, 'Kina'], [700, 709, 'Norveška'], [729, 729, 'Izrael'],
  [730, 739, 'Švedska'], [750, 750, 'Meksiko'], [760, 769, 'Švicarska'], [779, 779, 'Argentina'],
  [780, 780, 'Čile'], [789, 790, 'Brazil'], [800, 839, 'Italija'], [840, 849, 'Španjolska'],
  [858, 858, 'Slovačka'], [859, 859, 'Češka'], [860, 860, 'Srbija'], [868, 869, 'Turska'],
  [870, 879, 'Nizozemska'], [880, 880, 'Južna Koreja'], [885, 885, 'Tajland'], [888, 888, 'Singapur'],
  [890, 890, 'Indija'], [893, 893, 'Vijetnam'], [899, 899, 'Indonezija'], [900, 919, 'Austrija'],
  [930, 939, 'Australija'], [940, 949, 'Novi Zeland'], [955, 955, 'Malezija'],
];

function gs1Country(code) {
  // UPC-A (12 znamenki) je EAN-13 s vodećom nulom; EAN-8 i GTIN-14 imaju drugačiju strukturu.
  const ean13 = code.length === 12 ? '0' + code : code;
  if (ean13.length !== 13) return null;
  const prefix = Number(ean13.slice(0, 3));
  if (prefix >= 200 && prefix <= 299) return { internal: true };
  const hit = GS1_PREFIXES.find(([a, b]) => prefix >= a && prefix <= b);
  return hit ? { name: hit[2], prefix: ean13.slice(0, 3) } : null;
}

const NOVA_HR = {
  1: 'Neprerađena ili minimalno prerađena hrana',
  2: 'Prerađeni kulinarski sastojci',
  3: 'Prerađena hrana',
  4: 'Ultraprerađena hrana',
};
