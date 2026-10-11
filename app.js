'use strict';

// Open Food Facts API v2 — https://openfoodfacts.github.io/openfoodfacts-server/api/
const API = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = [
  'code', 'product_name', 'product_name_hr', 'generic_name', 'generic_name_hr',
  'brands', 'quantity', 'serving_size', 'image_front_url',
  'ingredients_text', 'ingredients_text_hr',
  'allergens_tags', 'traces_tags', 'additives_tags',
  'nutriments', 'nutriscore_grade', 'nova_group',
  'categories', 'labels', 'origins', 'manufacturing_places',
  'countries', 'packaging', 'stores', 'conservation_conditions', 'customer_service',
  'last_modified_t',
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

async function lookup(rawCode) {
  const code = String(rawCode).trim();
  if (!isValidGtin(code)) {
    setStatus(`„${code}“ nije ispravan EAN/UPC bar kod (kontrolna znamenka ne odgovara).`, true);
    return;
  }
  setStatus(`Tražim ${code}…`);
  resultEl.innerHTML = '';

  let data;
  try {
    const res = await fetch(`${API}${encodeURIComponent(code)}.json?fields=${FIELDS}`);
    // API za nepostojeći proizvod može vratiti HTTP 404 s JSON tijelom, pa tijelo čitamo u oba slučaja.
    data = await res.json().catch(() => null);
    if (!data && !res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    setStatus('Greška pri dohvatu podataka. Provjeri internetsku vezu. (' + err.message + ')', true);
    return;
  }

  if (!data || data.status !== 1 || !data.product) {
    setStatus('');
    renderNotFound(code);
    return;
  }
  setStatus('');
  const product = data.product;
  renderProduct(code, product);
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

function renderProduct(code, p) {
  const name = pickName(p);
  const parts = [];

  // Zaglavlje
  const badges = [];
  const ns = (p.nutriscore_grade || '').toLowerCase();
  if (/^[a-e]$/.test(ns)) badges.push(`<span class="badge ns-${ns}">Nutri-Score ${ns.toUpperCase()}</span>`);
  if (NOVA_HR[p.nova_group]) badges.push(`<span class="badge" title="${escapeHtml(NOVA_HR[p.nova_group])}">NOVA ${p.nova_group} · ${escapeHtml(NOVA_HR[p.nova_group])}</span>`);

  parts.push(`
    <section class="card">
      <div class="product-head">
        ${p.image_front_url ? `<img src="${escapeHtml(p.image_front_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <div>
          <h2>${escapeHtml(name)}</h2>
          ${p.brands ? `<p class="sub">${escapeHtml(p.brands)}</p>` : ''}
          ${p.quantity ? `<p class="sub">${escapeHtml(p.quantity)}</p>` : ''}
          <p class="code">EAN ${escapeHtml(code)}</p>
        </div>
      </div>
      ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
    </section>`);

  // Alergeni
  const allergens = (p.allergens_tags || []).map((t) => ALLERGENS_HR[t] || tagLabel(t));
  const traces = (p.traces_tags || []).map((t) => ALLERGENS_HR[t] || tagLabel(t));
  let allergenHtml = '';
  if (allergens.length) allergenHtml += `<p class="alert danger"><strong>Sadrži:</strong> ${escapeHtml(allergens.join(', '))}</p>`;
  if (traces.length) allergenHtml += `<p class="alert warn"><strong>Može sadržavati tragove:</strong> ${escapeHtml(traces.join(', '))}</p>`;
  if (!allergenHtml) allergenHtml = '<p class="muted">Alergeni nisu uneseni u bazu — to <strong>ne znači</strong> da ih proizvod ne sadrži. Provjeri pakiranje.</p>';
  parts.push(section('Alergeni', allergenHtml));

  // Sastojci
  const ingredients = p.ingredients_text_hr || p.ingredients_text;
  const ingrNote = !p.ingredients_text_hr && p.ingredients_text ? '<p class="muted">Sastav nije dostupan na hrvatskom; prikazan je izvorni tekst.</p>' : '';
  parts.push(section('Sastojci', ingredients
    ? `${ingrNote}<p class="ingredients">${escapeHtml(ingredients)}</p>`
    : '<p class="muted">Popis sastojaka nije unesen u bazu.</p>'));

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
  parts.push(section('Nutritivna vrijednost', rows
    ? `<table class="nutri"><thead><tr><th></th><th>na 100 g/ml</th>${hasServing ? `<th>po porciji${p.serving_size ? ` (${escapeHtml(p.serving_size)})` : ''}</th>` : ''}</tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="muted">Nutritivne vrijednosti nisu unesene u bazu.</p>'));

  // Aditivi
  const additives = (p.additives_tags || []).map(tagLabel);
  if (additives.length) parts.push(section(`Aditivi (${additives.length})`, chipList(additives)));

  // Ostali podaci s deklaracije
  const facts = [
    ['Kategorija', splitList(p.categories).slice(-2).join(', ')],
    ['Oznake', p.labels],
    ['Podrijetlo sastojaka', p.origins],
    ['Mjesto proizvodnje', p.manufacturing_places],
    ['Uvjeti čuvanja', p.conservation_conditions],
    ['Pakiranje', p.packaging],
    ['Prodaje se u', p.countries],
    ['Trgovine', p.stores],
    ['Kontakt proizvođača', p.customer_service],
  ].filter(([, v]) => v && String(v).trim());
  if (facts.length) {
    parts.push(section('Ostali podaci', `<dl class="facts">${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`));
  }

  const updated = p.last_modified_t ? new Date(p.last_modified_t * 1000).toLocaleDateString('hr-HR') : null;
  parts.push(`<p class="muted" style="font-size:.85rem;margin:0 0 16px">
    ${updated ? `Zadnja izmjena u bazi: ${escapeHtml(updated)} ` : ''}
    <a href="https://world.openfoodfacts.org/product/${encodeURIComponent(code)}" target="_blank" rel="noopener">Otvori na Open Food Facts</a>
    (možeš ispraviti ili dopuniti podatke).</p>`);

  resultEl.innerHTML = parts.join('');
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderNotFound(code) {
  resultEl.innerHTML = section('Proizvod nije pronađen', `
    <p>Bar kod <span class="code">${escapeHtml(code)}</span> još nije u bazi Open Food Facts.</p>
    <p class="muted">Možeš ga dodati fotografiranjem deklaracije u aplikaciji ili na stranici
    <a href="https://world.openfoodfacts.org/cgi/product.pl?type=search_or_add&code=${encodeURIComponent(code)}" target="_blank" rel="noopener">Open Food Facts</a>.</p>`);
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
