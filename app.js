'use strict';

// Baze iz obitelji Open Facts dijele isti API v2 — https://openfoodfacts.github.io/openfoodfacts-server/api/
// Redoslijed je ujedno i prioritet kad se isti bar kod nađe u više baza.
const SOURCES = [
  { id: 'food', name: 'Open Food Facts', kind: 'Hrana i piće', host: 'https://world.openfoodfacts.org' },
  { id: 'beauty', name: 'Open Beauty Facts', kind: 'Kozmetika i higijena', host: 'https://world.openbeautyfacts.org' },
  { id: 'pet', name: 'Open Pet Food Facts', kind: 'Hrana za kućne ljubimce', host: 'https://world.openpetfoodfacts.org' },
  { id: 'products', name: 'Open Products Facts', kind: 'Ostali proizvodi', host: 'https://world.openproductsfacts.org' },
];
const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
const FIELDS = [
  'code', 'product_name', 'product_name_hr', 'generic_name', 'generic_name_hr',
  'brands', 'quantity', 'serving_size', 'image_front_url',
  'ingredients_text', 'ingredients_text_hr',
  'allergens_tags', 'traces_tags', 'additives_tags',
  'nutriments', 'nutriscore_grade', 'nova_group',
  'categories', 'labels', 'origins', 'manufacturing_places',
  'countries', 'packaging', 'stores', 'conservation_conditions', 'customer_service',
  'emb_codes', 'last_modified_t',
].join(',');

// 14 alergena iz Priloga II. Uredbe (EU) br. 1169/2011, nazivi oznaka kako ih koristi Open Food Facts.
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

// Redoslijed i nazivi prema obveznoj nutritivnoj izjavi (Uredba (EU) br. 1169/2011, Prilog XV).
const NUTRIENTS = [
  { key: 'energy-kj', label: 'Energija', unit: 'kJ' },
  { key: 'energy-kcal', label: 'Energija', unit: 'kcal' },
  { key: 'fat', label: 'Masti', unit: 'g' },
  { key: 'saturated-fat', label: 'od kojih zasićene masne kiseline', unit: 'g', sub: true },
  { key: 'carbohydrates', label: 'Ugljikohidrati', unit: 'g' },
  { key: 'sugars', label: 'od kojih šećeri', unit: 'g', sub: true },
  { key: 'fiber', label: 'Vlakna', unit: 'g' },
  { key: 'proteins', label: 'Bjelančevine', unit: 'g' },
  { key: 'salt', label: 'Sol', unit: 'g' },
];

// GS1 prefiksi (prve 3 znamenke EAN-13) — https://www.gs1.org/standards/id-keys/company-prefix
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
  return hit ? { name: hit[2] } : null;
}

// Identifikacijska oznaka objekta (npr. „HR 1234 EZ”, „FR 72.264.002 CE”) za proizvode životinjskog
// podrijetla — prve dvije slova su ISO oznaka zemlje objekta koji je proizvod zadnji obradio/pakirao.
const regionNames = (() => {
  try { return new Intl.DisplayNames(['hr'], { type: 'region' }); } catch { return null; }
})();

function embCountries(embCodes) {
  return splitList(embCodes).map((c) => {
    const iso = /^([A-Z]{2})[\s-]/.exec(c.trim().toUpperCase());
    let country = null;
    if (iso && regionNames) {
      try { country = regionNames.of(iso[1] === 'UK' ? 'GB' : iso[1]); } catch { /* nepoznat kod */ }
    }
    return { code: c, country: country && country !== iso[1] ? country : null };
  });
}

const EXPIRY_KIND = {
  best_before: 'Najbolje upotrijebiti do',
  use_by: 'Upotrijebiti do',
};

const NOVA_HR = {
  1: 'Neprerađena ili minimalno prerađena hrana',
  2: 'Prerađeni kulinarski sastojci',
  3: 'Prerađena hrana',
  4: 'Ultraprerađena hrana',
};

const $ = (sel) => document.querySelector(sel);
const video = $('#video');
const videoWrap = $('#video-wrap');
const scanBtn = $('#scan-btn');
const stopBtn = $('#stop-btn');
const statusEl = $('#status');
const resultEl = $('#result');

let zxingReader = null;
let nativeStream = null;
let nativeLoop = null;
let scanning = false;

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Provjera kontrolne znamenke za EAN-8, UPC-A (12), EAN-13 i GTIN-14 (GS1 algoritam).
function isValidGtin(code) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/* ---------- Skeniranje ---------- */

async function startScan() {
  if (scanning) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Ovaj preglednik ne podržava kameru (potreban je HTTPS). Upiši broj ručno.', true);
    return;
  }
  scanning = true;
  videoWrap.hidden = false;
  scanBtn.hidden = true;
  stopBtn.hidden = false;
  setStatus('Usmjeri kameru prema bar kodu…');

  const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };

  try {
    if (await nativeDetectorAvailable()) {
      await startNative(constraints);
    } else {
      await startZxing(constraints);
    }
  } catch (err) {
    stopScan();
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setStatus(denied
      ? 'Pristup kameri je odbijen. Dozvoli kameru u postavkama preglednika ili upiši broj ručno.'
      : 'Kamera se ne može pokrenuti: ' + (err && err.message ? err.message : err), true);
  }
}

async function nativeDetectorAvailable() {
  if (!('BarcodeDetector' in window)) return false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('ean_13');
  } catch {
    return false;
  }
}

async function startNative(constraints) {
  const detector = new window.BarcodeDetector({
    formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'],
  });
  nativeStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = nativeStream;
  await video.play();

  const tick = async () => {
    if (!scanning) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        onDetected(codes[0].rawValue);
        return;
      }
    } catch { /* kadar još nije spreman */ }
    nativeLoop = setTimeout(tick, 150);
  };
  tick();
}

async function startZxing(constraints) {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
  ]);
  zxingReader = new ZXing.BrowserMultiFormatReader(hints, 200);
  await zxingReader.decodeFromConstraints(constraints, video, (result) => {
    if (result && scanning) onDetected(result.getText());
  });
}

function stopScan() {
  scanning = false;
  if (nativeLoop) clearTimeout(nativeLoop);
  nativeLoop = null;
  if (nativeStream) nativeStream.getTracks().forEach((t) => t.stop());
  nativeStream = null;
  if (zxingReader) zxingReader.reset();
  zxingReader = null;
  video.srcObject = null;
  videoWrap.hidden = true;
  scanBtn.hidden = false;
  stopBtn.hidden = true;
}

function onDetected(code) {
  stopScan();
  if (navigator.vibrate) navigator.vibrate(80);
  lookup(code);
}

/* ---------- Dohvat podataka ---------- */

let lookupSeq = 0;

async function fetchFromSource(source, code) {
  const res = await fetch(`${source.host}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  // API za nepostojeći proizvod može vratiti HTTP 404 s JSON tijelom, pa tijelo čitamo u oba slučaja.
  const data = await res.json().catch(() => null);
  if (!data && !res.ok) throw new Error(`HTTP ${res.status}`);
  return data && data.status === 1 && data.product ? data.product : null;
}

async function lookup(rawCode) {
  const code = String(rawCode).trim();
  if (!isValidGtin(code)) {
    setStatus(`„${code}“ nije ispravan EAN/UPC bar kod (kontrolna znamenka ne odgovara).`, true);
    return;
  }
  const seq = ++lookupSeq;
  showView('main');
  resultEl.innerHTML = '';

  // 1) Vlastiti (ručno uneseni) podaci imaju prednost.
  let local = null;
  try { local = await LocalDb.get(code); } catch { /* IndexedDB nedostupan (npr. privatni način) */ }
  if (seq !== lookupSeq) return;
  if (local) {
    setStatus('');
    renderProduct(code, local, { id: local.type || 'products', local: true });
    saveHistory(code, pickName(local));
    return;
  }

  // 2) Sve baze paralelno; uzima se prva po prioritetu u kojoj proizvod postoji.
  setStatus(`Tražim ${code} u ${SOURCES.length} baze…`);
  const results = await Promise.allSettled(SOURCES.map((s) => fetchFromSource(s, code)));
  if (seq !== lookupSeq) return;

  const hitIndex = results.findIndex((r) => r.status === 'fulfilled' && r.value);
  const failed = SOURCES.filter((_, i) => results[i].status === 'rejected');

  if (hitIndex === -1) {
    if (failed.length === SOURCES.length) {
      setStatus('Greška pri dohvatu podataka. Provjeri internetsku vezu.', true);
      renderNotFound(code, failed);
      return;
    }
    setStatus('');
    renderNotFound(code, failed);
    return;
  }
  setStatus('');
  const product = results[hitIndex].value;
  renderProduct(code, product, SOURCES[hitIndex]);
  saveHistory(code, pickName(product));
}

/* ---------- Prikaz ---------- */

function pickName(p) {
  return p.product_name_hr || p.product_name || p.generic_name_hr || p.generic_name || 'Nepoznat naziv';
}

function fmtNumber(n) {
  return new Intl.NumberFormat('hr-HR', { maximumFractionDigits: n < 10 ? 2 : 1 }).format(n);
}

function nutrientValue(nutriments, key, suffix) {
  const v = nutriments[`${key}_${suffix}`];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function section(title, innerHtml) {
  return `<section class="card"><h2>${escapeHtml(title)}</h2>${innerHtml}</section>`;
}

function tagLabel(tag) {
  // "en:e322i" -> "E322i", "en:some-thing" -> "some thing"
  const t = tag.replace(/^[a-z]{2}:/, '');
  return /^e\d/.test(t) ? 'E' + t.slice(1) : t.replace(/-/g, ' ');
}

function chipList(items) {
  return `<ul class="chips">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

function splitList(str) {
  return (str || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function originHtml(code, p) {
  const rows = [
    ['Zemlja proizvodnje', p.country_of_manufacture],
    ['Mjesto proizvodnje', p.manufacturing_places],
    ['Podrijetlo sastojaka', p.origins],
  ].filter(([, v]) => v && String(v).trim());
  const emb = embCountries(p.emb_codes);
  if (emb.length) {
    rows.push(['Identifikacijska oznaka objekta', emb.map((e) => (e.country ? `${e.code} (${e.country})` : e.code)).join(', ')]);
  }
  let html = rows.length
    ? `<dl class="facts">${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`
    : '';
  if (!p.country_of_manufacture && !p.manufacturing_places) {
    html += `<p class="muted">Zemlja proizvodnje nije navedena. Na pakiranju potraži „Proizvedeno u”, „Zemlja podrijetla”
      ili „Made in” i upiši je preko gumba ✏️ ispod (ili fotografiraj deklaraciju).</p>`;
  }
  if (emb.length) {
    html += '<p class="muted small">Identifikacijska oznaka (ovalni žig) označava zemlju objekta koji je proizvod životinjskog podrijetla zadnji obradio ili pakirao.</p>';
  }
  const gs1 = gs1Country(code);
  if (gs1 && gs1.internal) {
    html += '<p class="muted small">Ovo je interni bar kod trgovine (prefiks 2xx) — iz njega se ne može odrediti podrijetlo.</p>';
  } else if (gs1) {
    html += `<p class="muted small">Bar kod je dodijelila GS1 organizacija: <strong>${escapeHtml(gs1.name)}</strong> (prefiks ${escapeHtml(code.padStart(13, '0').slice(0, 3))}).
      To <strong>nije</strong> dokaz zemlje proizvodnje — tvrtke koriste bar kod zemlje u kojoj su registrirane, bez obzira gdje se proizvod radi.</p>`;
  }
  return html;
}

/* ---------- Rok trajanja (po pakiranju, lokalno) ---------- */

function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function fmtDate(iso, monthOnly) {
  const [y, m, d] = iso.split('-');
  return monthOnly ? `kraj ${m}/${y}` : `${Number(d)}. ${Number(m)}. ${y}.`;
}

function expiryStatusHtml(entry) {
  const days = daysUntil(entry.date);
  const label = `${EXPIRY_KIND[entry.kind] || EXPIRY_KIND.best_before}: <strong>${escapeHtml(fmtDate(entry.date, entry.monthOnly))}</strong>`;
  let cls = 'ok';
  let text;
  if (days < 0) {
    cls = 'danger';
    text = `Istekao prije ${-days} ${-days === 1 ? 'dan' : 'dana'}.`;
    text += entry.kind === 'use_by'
      ? ' Ne konzumirati — nakon roka „upotrijebiti do” hrana se smatra nesigurnom.'
      : ' Nakon roka „najbolje upotrijebiti do” proizvod može biti i dalje siguran ako je neoštećen i pravilno čuvan, ali proizvođač više ne jamči kvalitetu.';
  } else if (days === 0) {
    cls = 'warn';
    text = 'Ističe danas.';
  } else if (days <= 3) {
    cls = 'warn';
    text = `Ističe za ${days} ${days === 1 ? 'dan' : 'dana'}.`;
  } else {
    text = `Vrijedi još ${days} dana.`;
  }
  return `<p class="alert ${cls}">${label}<br>${escapeHtml(text)}</p>`;
}

async function renderExpiry(code) {
  let entry = null;
  try { entry = await LocalDb.getExpiry(code); } catch { /* bez lokalne baze */ }
  const body = document.querySelector('#expiry-body');
  if (!body || resultEl.dataset.code !== code) return;
  body.innerHTML = `
    ${entry ? expiryStatusHtml(entry) : '<p class="muted">Rok trajanja ovisi o pakiranju i ne postoji u bazama. Upiši ga ili ga očitaj fotografijom s pakiranja.</p>'}
    <div class="expiry-form">
      <select id="expiry-kind" aria-label="Vrsta roka">
        ${Object.entries(EXPIRY_KIND).map(([k, v]) => `<option value="${k}"${entry && entry.kind === k ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}
      </select>
      <input type="date" id="expiry-date" aria-label="Datum" value="${entry ? escapeHtml(entry.date) : ''}">
    </div>
    <div class="actions expiry-actions">
      <button type="button" data-action="expiry-ocr">📷 Očitaj s pakiranja</button>
      <button type="button" class="primary" data-action="expiry-save" data-code="${escapeHtml(code)}">Spremi rok</button>
    </div>
    ${entry ? `<button type="button" class="link" data-action="expiry-clear" data-code="${escapeHtml(code)}">Ukloni rok</button>` : ''}
    <input type="file" id="expiry-file" accept="image/*" capture="environment" hidden>
    <p id="expiry-msg" class="status small" role="status" aria-live="polite"></p>`;
}

async function saveExpiry(code, date, kind, monthOnly = false) {
  if (!date) {
    await LocalDb.removeExpiry(code);
    return;
  }
  await LocalDb.putExpiry({ code, date, kind, monthOnly, updated: Date.now() });
}

async function ocrExpiry(file) {
  const msg = $('#expiry-msg');
  msg.classList.remove('error');
  msg.textContent = 'Prepoznajem datum… (prvi put se preuzima oko 10 MB)';
  try {
    const { text } = await LabelOcr.recognize(file, (m) => {
      if (m.status === 'recognizing text') msg.textContent = `Prepoznajem datum… ${Math.round(m.progress * 100)} %`;
    });
    const found = LabelOcr.findExpiry(text);
    if (!found) {
      msg.textContent = 'Datum nije prepoznat. Fotografiraj izbliza samo datum, uz dobro svjetlo, ili ga upiši ručno.';
      return;
    }
    $('#expiry-date').value = found.date;
    $('#expiry-kind').value = found.kind;
    $('#expiry-date').dataset.monthOnly = found.monthOnly ? '1' : '';
    const shown = fmtDate(found.date, found.monthOnly);
    msg.textContent = `Prepoznato: ${EXPIRY_KIND[found.kind]} ${shown}${shown.endsWith('.') ? '' : '.'}`
      + (found.sure ? '' : ' Uz datum nije pronađen natpis roka — možda je to datum proizvodnje.')
      + ' Provjeri pa pritisni „Spremi rok”.';
  } catch (err) {
    msg.classList.add('error');
    msg.textContent = 'Prepoznavanje nije uspjelo: ' + (err && err.message ? err.message : err);
  }
}

resultEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action^="expiry-"]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'expiry-ocr') { $('#expiry-file').click(); return; }
  const code = btn.dataset.code;
  try {
    if (action === 'expiry-save') {
      const dateInput = $('#expiry-date');
      if (!dateInput.value) {
        $('#expiry-msg').textContent = 'Odaberi datum.';
        return;
      }
      await saveExpiry(code, dateInput.value, $('#expiry-kind').value, dateInput.dataset.monthOnly === '1');
    } else if (action === 'expiry-clear') {
      await LocalDb.removeExpiry(code);
    }
    renderExpiry(code);
  } catch (err) {
    $('#expiry-msg').textContent = 'Spremanje nije uspjelo: ' + (err && err.message ? err.message : err);
  }
});
resultEl.addEventListener('change', (e) => {
  if (e.target.id === 'expiry-date') e.target.dataset.monthOnly = '';
  if (e.target.id !== 'expiry-file') return;
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) ocrExpiry(file);
});

let currentObjectUrl = null;
let lastResult = null;

function renderProduct(code, p, source) {
  const name = pickName(p);
  const kind = source.id;
  const isEdible = kind === 'food' || kind === 'pet';
  const parts = [];

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = p.image_blob instanceof Blob ? URL.createObjectURL(p.image_blob) : null;
  const imageUrl = currentObjectUrl || p.image_front_url;

  // Zaglavlje
  const badges = [`<span class="badge">${escapeHtml(SOURCE_BY_ID[kind] ? SOURCE_BY_ID[kind].kind : 'Proizvod')}</span>`];
  if (source.local) badges.push('<span class="badge local">Ručno uneseno</span>');
  const ns = (p.nutriscore_grade || '').toLowerCase();
  if (/^[a-e]$/.test(ns)) badges.push(`<span class="badge ns-${ns}">Nutri-Score ${ns.toUpperCase()}</span>`);
  if (NOVA_HR[p.nova_group]) badges.push(`<span class="badge" title="${escapeHtml(NOVA_HR[p.nova_group])}">NOVA ${p.nova_group} · ${escapeHtml(NOVA_HR[p.nova_group])}</span>`);

  parts.push(`
    <section class="card">
      <div class="product-head">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <div>
          <h2>${escapeHtml(name)}</h2>
          ${p.brands ? `<p class="sub">${escapeHtml(p.brands)}</p>` : ''}
          ${p.quantity ? `<p class="sub">${escapeHtml(p.quantity)}</p>` : ''}
          <p class="code">EAN ${escapeHtml(code)}</p>
        </div>
      </div>
      <div class="badges">${badges.join('')}</div>
    </section>`);

  // Rok trajanja — uvijek, jer je to podatak s konkretnog pakiranja (popunjava se asinkrono).
  parts.push(`<section class="card" id="expiry-card"><h2>Rok trajanja</h2><div id="expiry-body"><p class="muted">Učitavam…</p></div></section>`);

  // Zemlja proizvodnje — uvijek
  parts.push(section('Zemlja proizvodnje', originHtml(code, p)));

  // Alergeni (samo hrana za ljude — Uredba 1169/2011)
  if (kind === 'food') {
    const allergens = (p.allergens_tags || []).map((t) => ALLERGENS_HR[t] || tagLabel(t));
    const traces = (p.traces_tags || []).map((t) => ALLERGENS_HR[t] || tagLabel(t));
    let allergenHtml = '';
    if (allergens.length) allergenHtml += `<p class="alert danger"><strong>Sadrži:</strong> ${escapeHtml(allergens.join(', '))}</p>`;
    if (traces.length) allergenHtml += `<p class="alert warn"><strong>Može sadržavati tragove:</strong> ${escapeHtml(traces.join(', '))}</p>`;
    if (p.traces_text) allergenHtml += `<p class="alert warn">${escapeHtml(p.traces_text)}</p>`;
    if (!allergenHtml) allergenHtml = '<p class="muted">Alergeni nisu uneseni — to <strong>ne znači</strong> da ih proizvod ne sadrži. Provjeri pakiranje.</p>';
    parts.push(section('Alergeni', allergenHtml));
  }

  // Sastojci
  const ingredients = p.ingredients_text_hr || p.ingredients_text;
  const ingrNote = !source.local && !p.ingredients_text_hr && p.ingredients_text ? '<p class="muted">Sastav nije dostupan na hrvatskom; prikazan je izvorni tekst.</p>' : '';
  if (ingredients || isEdible || kind === 'beauty') {
    parts.push(section(kind === 'beauty' ? 'Sastojci (INCI)' : 'Sastojci', ingredients
      ? `${ingrNote}<p class="ingredients">${escapeHtml(ingredients)}</p>`
      : '<p class="muted">Popis sastojaka nije unesen.</p>'));
  }

  // Nutritivna tablica
  const n = p.nutriments || {};
  const hasServing = NUTRIENTS.some((x) => nutrientValue(n, x.key, 'serving') !== null);
  const rows = NUTRIENTS.map((x) => {
    const v100 = nutrientValue(n, x.key, '100g');
    const vSrv = nutrientValue(n, x.key, 'serving');
    if (v100 === null && vSrv === null) return '';
    const cell = (v) => (v === null ? '—' : `${fmtNumber(v)} ${x.unit}`);
    return `<tr class="${x.sub ? 'sub-row' : ''}"><td>${escapeHtml(x.label)}</td><td>${cell(v100)}</td>${hasServing ? `<td>${cell(vSrv)}</td>` : ''}</tr>`;
  }).join('');
  if (rows || kind === 'food') {
    parts.push(section('Nutritivna vrijednost', rows
      ? `<table class="nutri"><thead><tr><th></th><th>na 100 g/ml</th>${hasServing ? `<th>po porciji${p.serving_size ? ` (${escapeHtml(p.serving_size)})` : ''}</th>` : ''}</tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted">Nutritivne vrijednosti nisu unesene.</p>'));
  }

  // Aditivi
  const additives = (p.additives_tags || []).map(tagLabel);
  if (additives.length) parts.push(section(`Aditivi (${additives.length})`, chipList(additives)));

  // Ostali podaci s deklaracije
  const facts = [
    ['Kategorija', source.local ? p.categories : splitList(p.categories).slice(-2).join(', ')],
    ['Oznake', p.labels],
    ['Uvjeti čuvanja', p.conservation_conditions],
    ['Upute i upozorenja', p.usage_text],
    ['Pakiranje', p.packaging],
    ['Prodaje se u', p.countries],
    ['Trgovine', p.stores],
    ['Proizvođač / kontakt', p.customer_service],
    ['Napomene', p.notes],
  ].filter(([, v]) => v && String(v).trim());
  if (facts.length) {
    parts.push(section('Ostali podaci', `<dl class="facts">${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`));
  }

  if (p.raw_text) {
    parts.push(`<section class="card"><details><summary>Cijeli prepoznati tekst s deklaracije</summary><p class="ingredients raw">${escapeHtml(p.raw_text)}</p></details></section>`);
  }

  let footer;
  if (source.local) {
    const updated = p.updated ? new Date(p.updated).toLocaleDateString('hr-HR') : null;
    footer = `Podaci su uneseni ručno${updated ? ` (${escapeHtml(updated)})` : ''} i spremljeni samo na ovom uređaju.`;
  } else {
    const updated = p.last_modified_t ? new Date(p.last_modified_t * 1000).toLocaleDateString('hr-HR') : null;
    footer = `Izvor: ${escapeHtml(source.name)}.${updated ? ` Zadnja izmjena u bazi: ${escapeHtml(updated)}` : ''}
      <a href="${source.host}/product/${encodeURIComponent(code)}" target="_blank" rel="noopener">Otvori u bazi</a>.`;
  }
  parts.push(`
    <div class="actions result-actions">
      <button type="button" data-action="edit" data-code="${escapeHtml(code)}">✏️ ${source.local ? 'Uredi' : 'Dopuni / ispravi ručno'}</button>
    </div>
    <p class="muted small">${footer}</p>`);

  resultEl.innerHTML = parts.join('');
  renderExpiry(code);
  resultEl.dataset.code = code;
  lastResult = { code, product: p, source };
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderNotFound(code, failed) {
  const failedNote = failed.length
    ? `<p class="alert warn">Nisu dostupne: ${escapeHtml(failed.map((s) => s.name).join(', '))}. Proizvod je možda ondje — pokušaj ponovno kasnije.</p>`
    : '';
  resultEl.innerHTML = section('Proizvod nije pronađen', `
    <p>Bar kod <span class="code">${escapeHtml(code)}</span> nije pronađen ni u jednoj od baza
    (${escapeHtml(SOURCES.map((s) => s.kind.toLowerCase()).join(', '))}).</p>
    ${failedNote}
    <p>Podatke možeš unijeti sam — ručno ili fotografiranjem deklaracije (prepoznavanje teksta).
    Spremaju se na ovom uređaju i prikazat će se kad idući put skeniraš isti proizvod.</p>
    <div class="actions">
      <button type="button" class="primary" data-action="edit" data-code="${escapeHtml(code)}">➕ Unesi podatke s deklaracije</button>
    </div>`);
  lastResult = { code, product: null, source: null };
}

/* ---------- Povijest (lokalno u pregledniku) ---------- */

const HISTORY_KEY = 'scan-history-v1';

function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveHistory(code, name) {
  const list = loadHistory().filter((h) => h.code !== code);
  list.unshift({ code, name });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 15))); } catch { /* npr. privatni način */ }
  renderHistory();
}

function renderHistory() {
  const list = loadHistory();
  $('#history-card').hidden = list.length === 0;
  $('#history').innerHTML = list.map((h) => `
    <li><button type="button" data-code="${escapeHtml(h.code)}">
      <span>${escapeHtml(h.name)}</span><span class="code">${escapeHtml(h.code)}</span>
    </button></li>`).join('');
}

/* ---------- Ručni unos i skeniranje teksta ---------- */

const editorForm = $('#editor-form');
const TEXT_FIELDS = [
  'product_name', 'brands', 'quantity', 'ingredients_text', 'traces_text', 'categories', 'origins',
  'country_of_manufacture', 'manufacturing_places', 'conservation_conditions', 'usage_text', 'customer_service', 'notes', 'raw_text',
];
let editorState = null; // { code, imageBlob, imageUrl, existing }

function showView(view) {
  $('#main-view').hidden = view !== 'main';
  $('#editor').hidden = view !== 'editor';
  if (view !== 'main' && scanning) stopScan();
  window.scrollTo(0, 0);
}

function buildEditorControls() {
  $('#allergen-boxes').innerHTML = Object.entries(ALLERGENS_HR).map(([tag, label]) => `
    <label class="check"><input type="checkbox" name="allergen" value="${tag}"> ${escapeHtml(label)}</label>`).join('');
  $('#nutrient-inputs').innerHTML = NUTRIENTS.map((x) => `
    <label class="${x.sub ? 'sub-row' : ''}"><span>${escapeHtml(x.label)} (${x.unit})</span>
      <input name="n:${x.key}" inputmode="decimal" autocomplete="off"></label>`).join('');
  $('#type-select').innerHTML = SOURCES.map((s) => `<option value="${s.id}">${escapeHtml(s.kind)}</option>`).join('');
}

function field(name) {
  return editorForm.elements.namedItem(name);
}

function parseDecimal(value) {
  const v = String(value || '').trim().replace(/\s/g, '').replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function updateTypeSections() {
  const type = field('type').value;
  $('#allergen-card').hidden = type !== 'food';
  $('#nutrition-card').hidden = type !== 'food' && type !== 'pet';
}

// Pretvara proizvod iz baze ili lokalni zapis u vrijednosti obrasca.
function productToForm(code, p, type) {
  editorForm.reset();
  $('#editor-code').textContent = `EAN ${code}`;
  $('#allergen-hint').textContent = '';
  $('#ocr-status').textContent = '';
  field('type').value = type || 'food';
  if (p) {
    const values = {
      ...p,
      product_name: pickName(p) === 'Nepoznat naziv' ? '' : pickName(p),
      ingredients_text: p.ingredients_text_hr || p.ingredients_text || '',
      traces_text: p.traces_text || (p.traces_tags || []).map((t) => ALLERGENS_HR[t] || tagLabel(t)).join(', '),
    };
    TEXT_FIELDS.forEach((f) => { if (values[f]) field(f).value = values[f]; });
    const tags = new Set(p.allergens_tags || []);
    editorForm.querySelectorAll('input[name="allergen"]').forEach((cb) => { cb.checked = tags.has(cb.value); });
    const n = p.nutriments || {};
    NUTRIENTS.forEach((x) => {
      const v = nutrientValue(n, x.key, '100g');
      if (v !== null) field(`n:${x.key}`).value = String(v).replace('.', ',');
    });
  }
  updateTypeSections();
}

async function openEditor(code) {
  let existing = null;
  try { existing = await LocalDb.get(code); } catch { /* bez lokalne baze */ }
  const fromDb = lastResult && lastResult.code === code && !lastResult.source?.local ? lastResult : null;
  const p = existing || (fromDb && fromDb.product) || null;
  const type = existing ? existing.type : (fromDb && fromDb.source ? fromDb.source.id : 'food');

  if (editorState && editorState.imageUrl) URL.revokeObjectURL(editorState.imageUrl);
  editorState = { code, existing: !!existing, imageBlob: existing ? existing.image_blob || null : null, remoteImage: p ? p.image_front_url || null : null, imageUrl: null };
  productToForm(code, p, type);
  let expiry = null;
  try { expiry = await LocalDb.getExpiry(code); } catch { /* bez lokalne baze */ }
  if (expiry) {
    field('expiry_date').value = expiry.date;
    field('expiry_kind').value = expiry.kind;
    editorState.expiryMonthOnly = !!expiry.monthOnly;
  }
  renderEditorPhoto();
  $('#delete-btn').hidden = !existing;
  showView('editor');
}

function renderEditorPhoto() {
  const img = $('#photo-preview');
  if (editorState.imageUrl) URL.revokeObjectURL(editorState.imageUrl);
  editorState.imageUrl = editorState.imageBlob ? URL.createObjectURL(editorState.imageBlob) : null;
  const src = editorState.imageUrl || editorState.remoteImage;
  img.hidden = !src;
  if (src) img.src = src;
}

async function resizeToBlob(file, maxSide = 800) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}

// Popunjava samo prazna polja, da OCR ne pregazi ono što je korisnik već upisao.
function applyParsed(parsed) {
  const filled = [];
  if (parsed.ingredients && !field('ingredients_text').value.trim()) {
    field('ingredients_text').value = parsed.ingredients;
    filled.push('sastojci');
  }
  if (parsed.traces && !field('traces_text').value.trim()) {
    field('traces_text').value = parsed.traces;
    filled.push('tragovi');
  }
  if (parsed.country && !field('country_of_manufacture').value.trim()) {
    field('country_of_manufacture').value = parsed.country;
    filled.push('zemlja proizvodnje');
  }
  if (parsed.expiry && !field('expiry_date').value) {
    field('expiry_date').value = parsed.expiry.date;
    field('expiry_kind').value = parsed.expiry.kind;
    editorState.expiryMonthOnly = parsed.expiry.monthOnly;
    filled.push(parsed.expiry.sure ? 'rok trajanja' : 'rok trajanja (nesigurno — provjeri da nije datum proizvodnje)');
  }
  let nCount = 0;
  NUTRIENTS.forEach((x) => {
    const v = parsed.nutriments[x.key];
    const input = field(`n:${x.key}`);
    if (v != null && !input.value.trim()) { input.value = String(v).replace('.', ','); nCount++; }
  });
  if (nCount) {
    const m10 = nCount % 10;
    const m100 = nCount % 100;
    const word = m10 === 1 && m100 !== 11 ? 'nutritivna vrijednost'
      : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'nutritivne vrijednosti' : 'nutritivnih vrijednosti';
    filled.push(`${nCount} ${word}`);
  }

  const suggested = parsed.allergens.filter((tag) => {
    const cb = editorForm.querySelector(`input[name="allergen"][value="${tag}"]`);
    if (cb && !cb.checked) { cb.checked = true; return true; }
    return false;
  });
  $('#allergen-hint').textContent = suggested.length
    ? `Prema tekstu sastojaka označeno: ${suggested.map((t) => ALLERGENS_HR[t]).join(', ')}. Provjeri na pakiranju — na deklaraciji su alergeni podebljani, a prepoznavanje teksta to ne vidi.`
    : '';
  return filled;
}

async function runOcr(file) {
  const status = $('#ocr-status');
  const progress = $('#ocr-progress');
  const btn = $('#ocr-btn');
  btn.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  status.classList.remove('error');
  status.textContent = 'Učitavam prepoznavanje teksta (prvi put može potrajati — preuzima se oko 10 MB)…';
  try {
    const { text, confidence } = await LabelOcr.recognize(file, (m) => {
      if (m.status === 'recognizing text') {
        status.textContent = 'Prepoznajem tekst…';
        progress.value = m.progress;
      }
    });
    if (!text.trim()) {
      status.textContent = 'Na slici nije prepoznat tekst. Pokušaj bliže, oštrije i uz bolje svjetlo.';
      return;
    }
    const raw = field('raw_text');
    raw.value = raw.value.trim() ? `${raw.value.trim()}\n\n${text.trim()}` : text.trim();
    const filled = applyParsed(LabelOcr.parseLabel(raw.value));
    status.textContent = `Tekst prepoznat (pouzdanost ${Math.round(confidence)} %). `
      + (filled.length ? `Popunjeno: ${filled.join(', ')}. ` : 'Polja nisu automatski prepoznata — prepiši ih iz teksta ispod. ')
      + 'Obavezno provjeri sve vrijednosti.';
  } catch (err) {
    status.classList.add('error');
    status.textContent = 'Prepoznavanje teksta nije uspjelo: ' + (err && err.message ? err.message : err);
  } finally {
    btn.disabled = false;
    progress.hidden = true;
  }
}

function formToProduct() {
  const fd = new FormData(editorForm);
  const product = { code: editorState.code, type: fd.get('type'), updated: Date.now() };
  TEXT_FIELDS.forEach((f) => {
    const v = String(fd.get(f) || '').trim();
    if (v) product[f] = v;
  });
  if (product.type === 'food') product.allergens_tags = fd.getAll('allergen');
  else delete product.traces_text;

  if (product.type === 'food' || product.type === 'pet') {
    const nutriments = {};
    const bad = [];
    NUTRIENTS.forEach((x) => {
      const v = parseDecimal(fd.get(`n:${x.key}`));
      if (Number.isNaN(v)) bad.push(x.label);
      else if (v !== null) nutriments[`${x.key}_100g`] = v;
    });
    if (bad.length) throw new Error(`Neispravan broj: ${bad.join(', ')}`);
    // Ako je upisana samo jedna jedinica energije, izračunaj drugu (1 kcal = 4,184 kJ).
    if (nutriments['energy-kj_100g'] == null && nutriments['energy-kcal_100g'] != null) nutriments['energy-kj_100g'] = Math.round(nutriments['energy-kcal_100g'] * 4.184);
    if (nutriments['energy-kcal_100g'] == null && nutriments['energy-kj_100g'] != null) nutriments['energy-kcal_100g'] = Math.round(nutriments['energy-kj_100g'] / 4.184);
    if (Object.keys(nutriments).length) product.nutriments = nutriments;
  }
  if (editorState.imageBlob) product.image_blob = editorState.imageBlob;
  else if (editorState.remoteImage) product.image_front_url = editorState.remoteImage;
  return product;
}

async function saveEditor(e) {
  e.preventDefault();
  const msg = $('#editor-msg');
  msg.classList.remove('error');
  let product;
  try {
    product = formToProduct();
  } catch (err) {
    msg.classList.add('error');
    msg.textContent = err.message;
    return;
  }
  if (!product.product_name) {
    msg.classList.add('error');
    msg.textContent = 'Upiši barem naziv proizvoda.';
    field('product_name').focus();
    return;
  }
  try {
    await LocalDb.put(product);
    const expiryDate = field('expiry_date').value;
    const prev = await LocalDb.getExpiry(product.code).catch(() => null);
    const monthOnly = !!(prev && prev.date === expiryDate ? prev.monthOnly : editorState.expiryMonthOnly);
    await saveExpiry(product.code, expiryDate, field('expiry_kind').value, monthOnly);
  } catch (err) {
    msg.classList.add('error');
    msg.textContent = 'Spremanje nije uspjelo (preglednik možda ne dopušta lokalnu pohranu): ' + (err && err.message ? err.message : err);
    return;
  }
  msg.textContent = '';
  showView('main');
  renderProduct(product.code, product, { id: product.type, local: true });
  saveHistory(product.code, product.product_name);
  setStatus('Spremljeno na ovom uređaju.');
}

async function deleteLocal() {
  if (!editorState || !confirm('Obrisati ručno unesene podatke za ovaj proizvod?')) return;
  try { await LocalDb.remove(editorState.code); } catch { /* već obrisano */ }
  lookup(editorState.code);
}

buildEditorControls();
editorForm.addEventListener('submit', saveEditor);
field('type').addEventListener('change', updateTypeSections);
field('expiry_date').addEventListener('change', () => { editorState.expiryMonthOnly = false; });
$('#cancel-btn').addEventListener('click', () => { showView('main'); });
$('#delete-btn').addEventListener('click', deleteLocal);
$('#ocr-btn').addEventListener('click', () => $('#ocr-file').click());
$('#ocr-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) runOcr(file);
});
$('#reparse-btn').addEventListener('click', () => {
  const filled = applyParsed(LabelOcr.parseLabel(field('raw_text').value));
  $('#ocr-status').textContent = filled.length ? `Popunjeno: ${filled.join(', ')}.` : 'Ništa novo nije prepoznato (popunjavaju se samo prazna polja).';
});
$('#photo-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    editorState.imageBlob = await resizeToBlob(file);
    renderEditorPhoto();
  } catch {
    $('#editor-msg').textContent = 'Fotografija se ne može učitati.';
  }
});
resultEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="edit"]');
  if (btn) openEditor(btn.dataset.code);
});

/* ---------- Događaji ---------- */

scanBtn.addEventListener('click', startScan);
stopBtn.addEventListener('click', () => { stopScan(); setStatus(''); });
$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  lookup($('#manual-input').value.replace(/\s+/g, ''));
});
$('#history').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-code]');
  if (btn) lookup(btn.dataset.code);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && scanning) stopScan(); });

renderHistory();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
