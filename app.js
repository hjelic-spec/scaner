'use strict';

// Redoslijed pretrage: 1) zajednička baza (Supabase), 2) lokalno spremljeno na uređaju,
// 3) baze Open Facts (hrana → kozmetika → ljubimci → ostalo).
// Open Facts API v2 — https://openfoodfacts.github.io/openfoodfacts-server/api/
const SOURCES = [
  { id: 'food', name: 'Open Food Facts', host: 'https://world.openfoodfacts.org' },
  { id: 'beauty', name: 'Open Beauty Facts', host: 'https://world.openbeautyfacts.org' },
  { id: 'pet', name: 'Open Pet Food Facts', host: 'https://world.openpetfoodfacts.org' },
  { id: 'products', name: 'Open Products Facts', host: 'https://world.openproductsfacts.org' },
];
const OFF_FIELDS = [
  'code', 'product_name', 'product_name_hr', 'generic_name', 'generic_name_hr',
  'brands', 'quantity', 'serving_size', 'image_front_url',
  'ingredients_text', 'ingredients_text_hr',
  'allergens_tags', 'traces_tags', 'additives_tags',
  'nutriments', 'nutriscore_grade', 'nova_group',
  'categories', 'labels', 'origins', 'manufacturing_places',
  'countries', 'packaging', 'stores', 'conservation_conditions', 'customer_service',
  'emb_codes', 'last_modified_t',
].join(',');

const STATUS_LABEL = {
  unverified: 'Neprovjereno',
  verified: '✓ Provjereno',
  disputed: '⚠ Prijavljena greška',
};
const VERIFY_THRESHOLD = 2; // mora odgovarati cfg_verify_threshold() u bazi

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
let lookupSeq = 0;
let lastResult = null; // { code, data, meta }
let currentObjectUrl = null;

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function errMsg(err) {
  return err && err.message ? err.message : String(err);
}

// Provjera kontrolne znamenke za EAN-8, UPC-A (12), EAN-13 i GTIN-14 (GS1 algoritam).
function isValidGtin(code) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function showView(view) {
  for (const id of ['main-view', 'editor', 'login', 'account']) $(`#${id}`).hidden = id !== view;
  if (view !== 'main-view' && scanning) stopScan();
  window.scrollTo(0, 0);
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
      ? 'Pristup kameri je odbijen. Dozvoli kameru u postavkama ili upiši broj ručno.'
      : 'Kamera se ne može pokrenuti: ' + errMsg(err), true);
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
  const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
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

/* ---------- Pretvorba podataka u zajednički oblik (ključevi iz fields.js) ---------- */

function splitList(str) {
  return (str || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function tagLabel(tag) {
  // "en:e322i" -> "E322i", "en:some-thing" -> "some thing"
  const t = tag.replace(/^[a-z]{2}:/, '');
  return /^e\d/.test(t) ? 'E' + t.slice(1) : t.replace(/-/g, ' ');
}

function offToData(p, typeId) {
  const nutriments = {};
  const n = p.nutriments || {};
  for (const x of NUTRIENTS) {
    for (const suffix of ['100g', 'serving']) {
      const v = n[`${x.key}_${suffix}`];
      if (typeof v === 'number' && Number.isFinite(v)) nutriments[`${x.key}_${suffix}`] = v;
    }
  }
  const emb = splitList(p.emb_codes);
  const data = {
    type: typeId,
    product_name: p.product_name_hr || p.product_name || '',
    legal_name: p.generic_name_hr || p.generic_name || '',
    brands: p.brands || '',
    quantity: p.quantity || '',
    serving_size: p.serving_size || '',
    categories: splitList(p.categories).slice(-2).join(', '),
    ingredients_text: p.ingredients_text_hr || p.ingredients_text || '',
    allergens: (p.allergens_tags || []).filter((t) => ALLERGENS_HR[t]),
    traces_text: (p.traces_tags || []).map((t) => ALLERGENS_HR[t] || tagLabel(t)).join(', '),
    nutriments,
    place_of_provenance: p.manufacturing_places || '',
    primary_ingredient_origin: p.origins || '',
    identification_mark: emb.join(', '),
    storage_conditions: p.conservation_conditions || '',
    customer_service: p.customer_service || '',
    labels: p.labels || '',
    packaging: p.packaging || '',
  };
  if (typeof n.alcohol_100g === 'number') data.alcohol_percent = n.alcohol_100g;
  // Zemlju proizvodnje Open Facts nema kao zasebno polje; „manufacturing_places” je ponekad samo zemlja.
  const placeCountry = matchCountry(p.manufacturing_places);
  if (placeCountry) {
    data.country_of_origin = placeCountry;
    delete data.place_of_provenance;
  }
  return cleanData(data);
}

// Zapisi spremljeni lokalno u ranijoj verziji aplikacije (drugačiji nazivi polja).
function legacyToData(rec) {
  if (rec.v === 2) return rec.data;
  const data = {
    type: rec.type || 'food',
    product_name: rec.product_name, brands: rec.brands, quantity: rec.quantity,
    ingredients_text: rec.ingredients_text, allergens: rec.allergens_tags, traces_text: rec.traces_text,
    nutriments: rec.nutriments, categories: rec.categories,
    primary_ingredient_origin: rec.origins, place_of_provenance: rec.manufacturing_places,
    storage_conditions: rec.conservation_conditions, usage_instructions: rec.usage_text,
    customer_service: rec.customer_service, notes: rec.notes,
  };
  const country = matchCountry(rec.country_of_manufacture);
  if (country) data.country_of_origin = country;
  else if (rec.country_of_manufacture) {
    data.place_of_provenance = [rec.country_of_manufacture, rec.manufacturing_places].filter(Boolean).join(', ');
  }
  return cleanData(data);
}

function cleanData(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    if (Array.isArray(v) && !v.length && k !== 'allergens') continue;
    if (k === 'nutriments' && !Object.keys(v).length) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/* ---------- Dohvat podataka ---------- */

async function fetchFromSource(source, code) {
  const res = await fetch(`${source.host}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
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
  showView('main-view');
  resultEl.innerHTML = '';
  setStatus(`Tražim ${code}…`);
  let communityError = null;

  // 1) Zajednička baza
  if (Api.enabled) {
    try {
      const product = await Api.getProduct(code);
      if (seq !== lookupSeq) return;
      if (product) {
        const revIds = [product.current && product.current.id, ...product.pending.map((r) => r.id)].filter(Boolean);
        const votes = await Api.myVotes(revIds).catch(() => ({}));
        const user = await Api.currentUser();
        if (seq !== lookupSeq) return;
        setStatus('');
        renderProduct(code, product.data, { source: 'community', product, votes, user });
        saveHistory(code, product.data.product_name);
        return;
      }
    } catch (err) {
      communityError = err;
    }
  }

  // 2) Lokalno spremljeno na uređaju
  let local = null;
  try { local = await LocalDb.get(code); } catch { /* IndexedDB nedostupan */ }
  if (seq !== lookupSeq) return;
  if (local) {
    setStatus(communityError ? 'Zajednička baza trenutno nije dostupna — prikazujem podatke s ovog uređaja.' : '');
    renderProduct(code, legacyToData(local), { source: 'local', local });
    saveHistory(code, legacyToData(local).product_name);
    return;
  }

  // 3) Open Facts baze, paralelno; prva po prioritetu u kojoj proizvod postoji
  const results = await Promise.allSettled(SOURCES.map((s) => fetchFromSource(s, code)));
  if (seq !== lookupSeq) return;
  const hit = results.findIndex((r) => r.status === 'fulfilled' && r.value);
  const failed = SOURCES.filter((_, i) => results[i].status === 'rejected');
  if (communityError) failed.unshift({ name: 'zajednička baza' });

  if (hit === -1) {
    const allFailed = results.every((r) => r.status === 'rejected');
    setStatus(allFailed ? 'Greška pri dohvatu podataka. Provjeri internetsku vezu.' : '', allFailed);
    renderNotFound(code, failed);
    return;
  }
  setStatus(communityError ? 'Zajednička baza trenutno nije dostupna — prikazujem podatke iz Open Facts.' : '');
  const offProduct = results[hit].value;
  const data = offToData(offProduct, SOURCES[hit].id);
  renderProduct(code, data, { source: 'off', off: SOURCES[hit], offProduct });
  saveHistory(code, data.product_name || 'Nepoznat naziv');
}

/* ---------- Prikaz ---------- */

function fmtNumber(n) {
  return new Intl.NumberFormat('hr-HR', { maximumFractionDigits: n < 10 ? 2 : 1 }).format(n);
}

function section(title, innerHtml, extraClass = '') {
  return `<section class="card ${extraClass}"><h2>${escapeHtml(title)}</h2>${innerHtml}</section>`;
}

function chipList(items) {
  return `<ul class="chips">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

// Tekstualni prikaz vrijednosti polja (za popise i usporedbu izmjena).
function displayValue(field, value) {
  if (value == null || value === '') return '';
  switch (field.type) {
    case 'country': return countryName(value);
    case 'select': return (field.options && field.options[value]) || value;
    case 'allergens': return value.map((t) => ALLERGENS_HR[t] || t).join(', ');
    case 'number': return fmtNumber(value);
    case 'nutrition': return 'izmijenjene vrijednosti';
    case 'image': return 'fotografija';
    default: return String(value);
  }
}

function nutritionTable(data) {
  const n = data.nutriments || {};
  const val = (key, suffix) => (typeof n[`${key}_${suffix}`] === 'number' ? n[`${key}_${suffix}`] : null);
  const hasServing = NUTRIENTS.some((x) => val(x.key, 'serving') !== null);
  const rows = NUTRIENTS.map((x) => {
    const a = val(x.key, '100g');
    const b = val(x.key, 'serving');
    if (a === null && b === null) return '';
    const cell = (v) => (v === null ? '—' : `${fmtNumber(v)} ${x.unit}`);
    return `<tr class="${x.sub ? 'sub-row' : ''}"><td>${escapeHtml(x.label)}</td><td>${cell(a)}</td>${hasServing ? `<td>${cell(b)}</td>` : ''}</tr>`;
  }).join('');
  if (!rows) return '';
  return `<table class="nutri"><thead><tr><th></th><th>na 100 g/ml</th>${hasServing
    ? `<th>po porciji${data.serving_size ? ` (${escapeHtml(data.serving_size)})` : ''}</th>` : ''}</tr></thead><tbody>${rows}</tbody></table>`;
}

function factsList(rows) {
  return rows.length
    ? `<dl class="facts">${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`
    : '';
}

function originNotes(code, data) {
  let html = '';
  if (!data.country_of_origin) {
    html += `<p class="muted">Zemlja podrijetla nije unesena. Na pakiranju potraži „Zemlja podrijetla”, „Proizvedeno u”
      ili „Made in” i dodaj je preko gumba ✏️ ispod.</p>`;
  }
  if (data.identification_mark) {
    html += '<p class="muted small">Identifikacijska oznaka (ovalni žig) označava zemlju objekta koji je proizvod životinjskog podrijetla zadnji obradio ili pakirao.</p>';
  }
  const gs1 = gs1Country(code);
  if (gs1 && gs1.internal) {
    html += '<p class="muted small">Ovo je interni bar kod trgovine (prefiks 2xx) — iz njega se ne može odrediti podrijetlo.</p>';
  } else if (gs1) {
    html += `<p class="muted small">Bar kod je dodijelila GS1 organizacija: <strong>${escapeHtml(gs1.name)}</strong> (prefiks ${escapeHtml(gs1.prefix)}).
      To <strong>nije</strong> dokaz zemlje proizvodnje — tvrtke koriste bar kod zemlje u kojoj su registrirane.</p>`;
  }
  return html;
}

function communityHtml(code, meta) {
  const { product, votes, user } = meta;
  const cur = product.current;
  const isAuthor = (rev) => user && rev && rev.author === user.id;
  const voteButtons = (rev) => {
    if (!rev) return '';
    if (isAuthor(rev)) return '<p class="muted small">Ovo je tvoj unos — potvrditi ga mogu drugi korisnici.</p>';
    const mine = votes[rev.id];
    return `<div class="actions vote-actions">
      <button type="button" data-action="vote" data-rev="${rev.id}" data-value="1" class="${mine === 1 ? 'chosen' : ''}">👍 Točno je</button>
      <button type="button" data-action="vote" data-rev="${rev.id}" data-value="-1" class="${mine === -1 ? 'chosen' : ''}">👎 Prijavi grešku</button>
    </div>${mine ? `<p class="muted small">Već si ${mine === 1 ? 'potvrdio/la' : 'prijavio/la grešku za'} ove podatke; možeš promijeniti glas.</p>` : ''}`;
  };

  let html = `<p class="status-line status-${product.status}"><strong>${escapeHtml(STATUS_LABEL[product.status] || product.status)}</strong>`;
  if (cur) {
    if (product.status === 'unverified') html += ` · potvrde: ${cur.confirmations}/${VERIFY_THRESHOLD}`;
    if (cur.reports) html += ` · prijave greške: ${cur.reports}`;
  }
  html += '</p>';
  if (product.status === 'unverified') {
    html += '<p class="muted small">Podatke je unio korisnik i još ih nisu potvrdila dva druga korisnika. Ako imaš proizvod pred sobom, usporedi s pakiranjem.</p>';
  } else if (product.status === 'disputed') {
    html += '<p class="alert warn small">Korisnici su prijavili da podaci možda nisu točni. Provjeri pakiranje ili ispravi podatke.</p>';
  }
  html += voteButtons(cur);

  for (const rev of product.pending) {
    const changes = diffData(product.data, rev.data);
    html += `<div class="pending">
      <h3>Predložena izmjena čeka potvrdu (${rev.confirmations}/${VERIFY_THRESHOLD})</h3>
      ${changes.length ? `<ul class="diff">${changes.map((c) => `<li><span class="muted">${escapeHtml(c.label)}:</span>
        ${c.before ? `<del>${escapeHtml(c.before)}</del> → ` : ''}<ins>${escapeHtml(c.after || '(obrisano)')}</ins></li>`).join('')}</ul>`
        : '<p class="muted small">Nema razlike u odnosu na trenutne podatke.</p>'}
      ${voteButtons(rev)}
    </div>`;
  }
  if (!user) {
    html += '<p class="muted small"><button type="button" class="link-btn" data-action="login">Prijavi se</button> da bi potvrdio/la ili ispravio/la podatke.</p>';
  }
  return section('Provjera podataka', html, 'community');
}

function diffData(before, after) {
  const changes = [];
  for (const sec of FIELD_SECTIONS) {
    for (const f of sec.fields) {
      const a = before[f.key];
      const b = after[f.key];
      if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
      changes.push({ label: fieldLabel(f, after.type || before.type), before: displayValue(f, a), after: displayValue(f, b) });
    }
  }
  return changes;
}

function renderProduct(code, data, meta) {
  const type = data.type || 'food';
  const parts = [];

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = meta.local && meta.local.image_blob instanceof Blob ? URL.createObjectURL(meta.local.image_blob) : null;
  const imageUrl = currentObjectUrl
    || (data.image_path ? Api.imageUrl(data.image_path) : null)
    || (meta.offProduct && meta.offProduct.image_front_url);

  // Zaglavlje
  const badges = [`<span class="badge">${escapeHtml(PRODUCT_TYPES[type] || 'Proizvod')}</span>`];
  if (meta.source === 'community') badges.push(`<span class="badge st-${meta.product.status}">${escapeHtml(STATUS_LABEL[meta.product.status])}</span>`);
  if (meta.source === 'local') badges.push('<span class="badge local">Spremljeno na uređaju</span>');
  if (meta.source === 'off') {
    const ns = (meta.offProduct.nutriscore_grade || '').toLowerCase();
    if (/^[a-e]$/.test(ns)) badges.push(`<span class="badge ns-${ns}">Nutri-Score ${ns.toUpperCase()}</span>`);
    const nova = meta.offProduct.nova_group;
    if (NOVA_HR[nova]) badges.push(`<span class="badge">NOVA ${nova} · ${escapeHtml(NOVA_HR[nova])}</span>`);
  }
  parts.push(`
    <section class="card">
      <div class="product-head">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <div>
          <h2>${escapeHtml(data.product_name || 'Nepoznat naziv')}</h2>
          ${data.legal_name ? `<p class="sub">${escapeHtml(data.legal_name)}</p>` : ''}
          ${data.brands ? `<p class="sub">${escapeHtml(data.brands)}</p>` : ''}
          ${data.quantity ? `<p class="sub">${escapeHtml(data.quantity)}${data.drained_weight ? ` · ocijeđeno ${escapeHtml(data.drained_weight)}` : ''}</p>` : ''}
          <p class="code">EAN ${escapeHtml(code)}</p>
        </div>
      </div>
      <div class="badges">${badges.join('')}</div>
    </section>`);

  if (meta.source === 'community') parts.push(communityHtml(code, meta));

  // Alergeni — uvijek za hranu
  if (type === 'food') {
    const allergens = (data.allergens || []).map((t) => ALLERGENS_HR[t] || t);
    let html = '';
    if (allergens.length) html += `<p class="alert danger"><strong>Sadrži:</strong> ${escapeHtml(allergens.join(', '))}</p>`;
    if (data.traces_text) html += `<p class="alert warn"><strong>Tragovi:</strong> ${escapeHtml(data.traces_text)}</p>`;
    if (!html) html = '<p class="muted">Alergeni nisu uneseni — to <strong>ne znači</strong> da ih proizvod ne sadrži. Provjeri pakiranje.</p>';
    parts.push(section('Alergeni', html));
  }

  // Sekcije iz fields.js
  for (const sec of FIELD_SECTIONS) {
    if (sec.id === 'basic') continue; // prikazano u zaglavlju i dolje
    const fields = sec.fields.filter((f) => fieldApplies(f, type) && f.type !== 'allergens' && f.key !== 'traces_text');
    if (!fields.length) continue;
    let html = '';
    const rows = [];
    for (const f of fields) {
      const v = data[f.key];
      if (f.type === 'nutrition') { html += nutritionTable(data); continue; }
      if (f.key === 'ingredients_text') {
        if (v) html += `<p class="ingredients">${escapeHtml(v)}</p>`;
        continue;
      }
      if (v != null && v !== '') rows.push([fieldLabel(f, type), displayValue(f, v)]);
    }
    html += factsList(rows);
    if (sec.id === 'origin') {
      html += originNotes(code, data);
    }
    if (!html) {
      if (sec.id === 'composition' || (sec.id === 'nutrition' && type === 'food')) {
        html = `<p class="muted">${sec.id === 'composition' ? 'Sastav nije unesen.' : 'Nutritivne vrijednosti nisu unesene.'}</p>`;
      } else continue;
    }
    parts.push(section(sectionTitle(sec, type), html));
  }

  // Osnovni podaci koji nisu u zaglavlju
  const basicRows = [['Veličina porcije', data.serving_size], ['Kategorija', data.categories]].filter(([, v]) => v);
  if (basicRows.length) parts.push(section('Ostali osnovni podaci', factsList(basicRows)));

  // Dodatno iz Open Facts
  if (meta.source === 'off') {
    const p = meta.offProduct;
    const additives = (p.additives_tags || []).map(tagLabel);
    let html = additives.length ? `<p><strong>Aditivi (${additives.length}):</strong></p>${chipList(additives)}` : '';
    html += factsList([['Prodaje se u', p.countries], ['Trgovine', p.stores]].filter(([, v]) => v));
    if (html) parts.push(section(`Dodatno iz ${meta.off.name}`, html));
  }

  // Podnožje: izvor i akcije
  let footer = '';
  let editLabel = '✏️ Dopuni / ispravi';
  if (meta.source === 'community') {
    const updated = new Date(meta.product.updated_at).toLocaleDateString('hr-HR');
    footer = `Izvor: zajednička baza korisnika aplikacije. Zadnja izmjena: ${escapeHtml(updated)}`;
    editLabel = meta.product.status === 'verified' ? '✏️ Predloži izmjenu' : '✏️ Ispravi / dopuni';
  } else if (meta.source === 'local') {
    footer = 'Podaci su spremljeni samo na ovom uređaju.';
    if (Api.enabled) editLabel = '☁️ Pregledaj i pošalji u zajedničku bazu';
  } else {
    const updated = meta.offProduct.last_modified_t ? new Date(meta.offProduct.last_modified_t * 1000).toLocaleDateString('hr-HR') : null;
    footer = `Izvor: ${escapeHtml(meta.off.name)}${updated ? ` (zadnja izmjena ${escapeHtml(updated)})` : ''} ·
      <a href="${meta.off.host}/product/${encodeURIComponent(code)}" target="_blank" rel="noopener">otvori u bazi</a>`;
    if (Api.enabled) editLabel = '✏️ Dopuni i spremi u zajedničku bazu';
  }
  parts.push(`
    <div class="actions result-actions">
      <button type="button" data-action="edit" data-code="${escapeHtml(code)}">${editLabel}</button>
    </div>
    <p class="muted small">${footer}</p>`);

  resultEl.innerHTML = parts.join('');
  resultEl.dataset.code = code;
  lastResult = { code, data, meta };
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderNotFound(code, failed) {
  const failedNote = failed.length
    ? `<p class="alert warn">Nisu dostupne: ${escapeHtml(failed.map((s) => s.name).join(', '))}. Proizvod je možda ondje — pokušaj ponovno kasnije.</p>`
    : '';
  const where = Api.enabled ? 'u zajedničkoj bazi ni u bazama Open Facts' : 'ni u jednoj od baza Open Facts';
  const target = Api.enabled
    ? 'Dodaj ga u zajedničku bazu — ručno ili fotografiranjem deklaracije — pa će ga vidjeti svi korisnici.'
    : 'Podatke možeš unijeti ručno ili fotografiranjem deklaracije; spremaju se na ovom uređaju.';
  resultEl.innerHTML = section('Proizvod nije pronađen', `
    <p>Bar kod <span class="code">${escapeHtml(code)}</span> nije pronađen ${where}.</p>
    ${failedNote}
    <p>${target}</p>
    <div class="actions">
      <button type="button" class="primary" data-action="edit" data-code="${escapeHtml(code)}">➕ Unesi podatke s deklaracije</button>
    </div>`);
  resultEl.dataset.code = code;
  lastResult = { code, data: null, meta: { source: 'none' } };
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
  list.unshift({ code, name: name || 'Nepoznat naziv' });
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

/* ---------- Obrazac za unos ---------- */

const editorForm = $('#editor-form');
let editorState = null; // { code, baseData, imageBlob, imagePath, previewUrl, localRecord, mode }

function inputHtml(f) {
  const id = `f-${f.key}`;
  const req = f.required ? ' *' : '';
  const help = f.help ? `<span class="help">${escapeHtml(f.help)}</span>` : '';
  const ph = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : '';
  switch (f.type) {
    case 'textarea':
      return `<label class="field" data-field="${f.key}"><span class="lbl">${escapeHtml(f.label)}${req}</span>${help}
        <textarea id="${id}" name="${f.key}" rows="4"${ph}></textarea></label>`;
    case 'select':
      return `<label class="field" data-field="${f.key}"><span class="lbl">${escapeHtml(f.label)}</span>
        <select id="${id}" name="${f.key}">${Object.entries(f.options).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></label>`;
    case 'country':
      return `<label class="field" data-field="${f.key}"><span class="lbl">${escapeHtml(f.label)}</span>${help}
        <select id="${id}" name="${f.key}"><option value="">— nije navedeno —</option>
        ${COUNTRY_OPTIONS.map(([code, name]) => `<option value="${code}">${escapeHtml(name)}</option>`).join('')}</select></label>`;
    case 'number':
      return `<label class="field" data-field="${f.key}"><span class="lbl">${escapeHtml(f.label)}</span>${help}
        <input id="${id}" name="${f.key}" inputmode="decimal" autocomplete="off"${ph}></label>`;
    case 'allergens':
      return `<div class="field" data-field="${f.key}"><span class="lbl">${escapeHtml(f.label)}</span>
        <div class="checks">${Object.entries(ALLERGENS_HR).map(([tag, label]) => `
          <label class="check"><input type="checkbox" name="allergen" value="${tag}"> ${escapeHtml(label)}</label>`).join('')}</div>
        <p id="allergen-hint" class="alert warn small" aria-live="polite"></p></div>`;
    case 'nutrition':
      return `<div class="field" data-field="${f.key}">
        <div class="nutrient-grid"><span></span><span class="lbl">na 100 g/ml</span><span class="lbl">po porciji</span>
        ${NUTRIENTS.map((x) => `
          <span class="${x.sub ? 'sub-row' : ''}">${escapeHtml(x.label)} (${x.unit})</span>
          <input name="n:${x.key}_100g" inputmode="decimal" autocomplete="off" aria-label="${escapeHtml(x.label)} na 100 g">
          <input name="n:${x.key}_serving" inputmode="decimal" autocomplete="off" aria-label="${escapeHtml(x.label)} po porciji">`).join('')}
        </div><p class="muted small">Ako upišeš samo kJ ili samo kcal, druga vrijednost se izračuna (1 kcal = 4,184 kJ).</p></div>`;
    case 'image':
      return `<div class="field" data-field="${f.key}"><span class="lbl">${escapeHtml(f.label)}</span>
        <div class="photo-row"><img id="photo-preview" alt="" hidden>
          <label class="button-like">📷 Odaberi / snimi
            <input type="file" id="photo-file" accept="image/*" capture="environment" hidden></label>
        </div></div>`;
    default:
      return `<label class="field" data-field="${f.key}"><span class="lbl">${escapeHtml(f.label)}${req}</span>${help}
        <input id="${id}" name="${f.key}"${ph}></label>`;
  }
}

function buildEditor() {
  $('#editor-fields').innerHTML = FIELD_SECTIONS.map((sec) => `
    <section class="card" data-section="${sec.id}">
      <h2 data-title>${escapeHtml(sec.title)}</h2>
      ${sec.fields.map(inputHtml).join('')}
    </section>`).join('');
}

function field(name) {
  return editorForm.elements.namedItem(name);
}

// Prikazuje samo polja koja vrijede za odabranu vrstu proizvoda, s nazivima za tu vrstu.
function updateTypeVisibility() {
  const type = field('type').value;
  for (const sec of FIELD_SECTIONS) {
    const el = editorForm.querySelector(`[data-section="${sec.id}"]`);
    let visible = 0;
    for (const f of sec.fields) {
      const fe = el.querySelector(`[data-field="${f.key}"]`);
      const on = fieldApplies(f, type);
      fe.hidden = !on;
      if (on) visible++;
      const lbl = fe.querySelector('.lbl');
      if (lbl && !['nutrition'].includes(f.type)) lbl.textContent = fieldLabel(f, type) + (f.required ? ' *' : '');
    }
    el.hidden = visible === 0;
    el.querySelector('[data-title]').textContent = sectionTitle(sec, type);
  }
}

function parseDecimal(value) {
  const v = String(value || '').trim().replace(/\s/g, '').replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function fmtInput(n) {
  return String(n).replace('.', ',');
}

function dataToForm(data) {
  editorForm.reset();
  $('#allergen-hint').textContent = '';
  $('#ocr-status').textContent = '';
  $('#raw-text').value = '';
  $('#editor-msg').textContent = '';
  field('type').value = data.type || 'food';
  for (const sec of FIELD_SECTIONS) {
    for (const f of sec.fields) {
      const v = data[f.key];
      if (v == null) continue;
      if (['text', 'textarea', 'select', 'country'].includes(f.type)) field(f.key).value = v;
      else if (f.type === 'number') field(f.key).value = fmtInput(v);
    }
  }
  const tags = new Set(data.allergens || []);
  editorForm.querySelectorAll('input[name="allergen"]').forEach((cb) => { cb.checked = tags.has(cb.value); });
  for (const [k, v] of Object.entries(data.nutriments || {})) {
    const input = field(`n:${k}`);
    if (input) input.value = fmtInput(v);
  }
  updateTypeVisibility();
}

function formToData() {
  const type = field('type').value;
  const data = { type };
  const bad = [];
  for (const sec of FIELD_SECTIONS) {
    for (const f of sec.fields) {
      if (!fieldApplies(f, type) || f.key === 'type') continue;
      if (['text', 'textarea', 'country'].includes(f.type)) {
        const v = field(f.key).value.trim();
        if (v) data[f.key] = v;
      } else if (f.type === 'number') {
        const v = parseDecimal(field(f.key).value);
        if (Number.isNaN(v) || (v !== null && f.max != null && v > f.max)) bad.push(fieldLabel(f, type));
        else if (v !== null) data[f.key] = f.step === '1' ? Math.round(v) : v;
      } else if (f.type === 'allergens') {
        data.allergens = [...editorForm.querySelectorAll('input[name="allergen"]:checked')].map((cb) => cb.value);
      } else if (f.type === 'nutrition') {
        const n = {};
        for (const x of NUTRIENTS) {
          for (const suffix of ['100g', 'serving']) {
            const v = parseDecimal(field(`n:${x.key}_${suffix}`).value);
            if (Number.isNaN(v)) bad.push(`${x.label} (${suffix === '100g' ? '100 g' : 'porcija'})`);
            else if (v !== null) n[`${x.key}_${suffix}`] = v;
          }
        }
        for (const suffix of ['100g', 'serving']) {
          const kj = n[`energy-kj_${suffix}`];
          const kcal = n[`energy-kcal_${suffix}`];
          if (kj == null && kcal != null) n[`energy-kj_${suffix}`] = Math.round(kcal * 4.184);
          if (kcal == null && kj != null) n[`energy-kcal_${suffix}`] = Math.round(kj / 4.184);
        }
        if (Object.keys(n).length) data.nutriments = n;
      }
    }
  }
  if (bad.length) throw new Error(`Neispravan broj: ${bad.join(', ')}`);
  if (editorState.imagePath) data.image_path = editorState.imagePath;
  return data;
}

async function openEditor(code) {
  const lr = lastResult && lastResult.code === code ? lastResult : null;
  let base = lr && lr.data ? { ...lr.data } : { type: 'food' };
  let localRecord = lr && lr.meta.local ? lr.meta.local : null;
  if (!localRecord) {
    try { localRecord = await LocalDb.get(code); } catch { /* bez lokalne baze */ }
    if (localRecord && !(lr && lr.data)) base = legacyToData(localRecord);
  }
  if (editorState && editorState.previewUrl) URL.revokeObjectURL(editorState.previewUrl);
  editorState = {
    code,
    imageBlob: localRecord && localRecord.image_blob instanceof Blob ? localRecord.image_blob : null,
    imagePath: base.image_path || null,
    remoteImage: lr && lr.meta.offProduct ? lr.meta.offProduct.image_front_url : null,
    previewUrl: null,
    localRecord,
    status: lr && lr.meta.product ? lr.meta.product.status : null,
  };
  dataToForm(base);
  renderEditorPhoto();

  const isNew = !(lr && lr.data);
  $('#editor-title').textContent = isNew ? 'Novi proizvod' : 'Izmjena podataka';
  $('#editor-code').textContent = `EAN ${code}`;
  let note;
  if (!Api.enabled) note = 'Zajednička baza nije spojena — podaci se spremaju samo na ovom uređaju.';
  else if (editorState.status === 'verified') note = 'Ovaj proizvod je provjeren. Tvoja izmjena bit će prijedlog i postat će važeća kad je potvrde dva druga korisnika.';
  else note = 'Podaci se šalju u zajedničku bazu i odmah su vidljivi svima s oznakom „neprovjereno”, dok ih ne potvrde dva druga korisnika.';
  if (lr && lr.meta.source === 'off') note += ' Polja su popunjena iz Open Facts — provjeri ih prema pakiranju.';
  $('#editor-note').textContent = note;
  $('#save-btn').textContent = Api.enabled ? '☁️ Pošalji u zajedničku bazu' : '💾 Spremi na uređaju';
  $('#delete-btn').hidden = !localRecord;
  showView('editor');
}

function renderEditorPhoto() {
  const img = $('#photo-preview');
  if (editorState.previewUrl) URL.revokeObjectURL(editorState.previewUrl);
  editorState.previewUrl = editorState.imageBlob ? URL.createObjectURL(editorState.imageBlob) : null;
  const src = editorState.previewUrl || (editorState.imagePath && Api.imageUrl(editorState.imagePath)) || editorState.remoteImage;
  img.hidden = !src;
  if (src) img.src = src;
}

async function resizeToBlob(file, maxSide = 1000) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}

function pluralValues(n) {
  return n % 10 === 1 && n % 100 !== 11 ? `${n} vrijednost` : `${n} vrijednosti`;
}

// Popunjava samo prazna polja, da OCR ne pregazi ono što je korisnik već upisao.
function applyParsed(parsed) {
  const filled = [];
  const type = field('type').value;
  const setIfEmpty = (key, value, label) => {
    const el = field(key);
    if (!el || value == null || value === '' || !fieldApplies(FIELD_BY_KEY[key], type)) return;
    if (String(el.value).trim()) return;
    el.value = typeof value === 'number' ? fmtInput(value) : value;
    filled.push(label || fieldLabel(FIELD_BY_KEY[key], type).toLowerCase());
  };
  setIfEmpty('ingredients_text', parsed.ingredients_text, 'sastojci');
  setIfEmpty('traces_text', parsed.traces_text, 'tragovi');
  setIfEmpty('quantity', parsed.quantity);
  setIfEmpty('drained_weight', parsed.drained_weight);
  setIfEmpty('storage_conditions', parsed.storage_conditions);
  setIfEmpty('manufacturer_name', parsed.manufacturer_name);
  setIfEmpty('manufacturer_address', parsed.manufacturer_address);
  setIfEmpty('distributor_name', parsed.distributor_name, 'uvoznik / distributer');
  setIfEmpty('distributor_address', parsed.distributor_address);
  setIfEmpty('identification_mark', parsed.identification_mark, 'identifikacijska oznaka');
  setIfEmpty('alcohol_percent', parsed.alcohol_percent, 'alkohol');

  if (parsed.country_text) {
    const iso = matchCountry(parsed.country_text);
    if (iso) setIfEmpty('country_of_origin', iso, 'zemlja podrijetla');
    else setIfEmpty('place_of_provenance', parsed.country_text, 'mjesto proizvodnje');
  }
  // Zemlja proizvođača iz adrese (zadnji dio adrese je obično zemlja).
  const addrCountry = parsed.manufacturer_address && matchCountry(parsed.manufacturer_address.split(',').pop());
  if (addrCountry) setIfEmpty('manufacturer_country', addrCountry, 'zemlja proizvođača');
  const distCountry = parsed.distributor_address && matchCountry(parsed.distributor_address.split(',').pop());
  if (distCountry) setIfEmpty('distributor_country', distCountry, 'zemlja distributera');

  if (fieldApplies(FIELD_BY_KEY.nutriments, type)) {
    let n = 0;
    for (const [key, v] of Object.entries(parsed.nutriments || {})) {
      const input = field(`n:${key}_100g`);
      if (input && v != null && !input.value.trim()) { input.value = fmtInput(v); n++; }
    }
    if (n) filled.push(`${pluralValues(n)} u nutritivnoj tablici`);
  }

  if (fieldApplies(FIELD_BY_KEY.allergens, type)) {
    const suggested = (parsed.allergens || []).filter((tag) => {
      const cb = editorForm.querySelector(`input[name="allergen"][value="${tag}"]`);
      if (cb && !cb.checked) { cb.checked = true; return true; }
      return false;
    });
    $('#allergen-hint').textContent = suggested.length
      ? `Prema tekstu sastojaka označeno: ${suggested.map((t) => ALLERGENS_HR[t]).join(', ')}. Provjeri na pakiranju — na deklaraciji su alergeni podebljani, a prepoznavanje teksta to ne vidi.`
      : '';
    if (suggested.length) filled.push('prijedlog alergena');
  }
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
  const onProgress = (m) => {
    if (!m.label) return;
    const pct = typeof m.progress === 'number' ? m.progress : 0;
    status.textContent = file ? `${m.label}… ${Math.round(pct * 100)} %` : `${m.label}…`;
    progress.value = pct;
  };
  try {
    let result;
    if (file) {
      status.textContent = 'Pokrećem prepoznavanje teksta (prvi put se preuzima oko 10 MB, zatim radi bez interneta)…';
      result = await LabelOcr.recognize(file, onProgress);
    } else {
      // Android aplikacija: izvorna kamera + Google ML Kit
      status.textContent = 'Otvaram kameru…';
      result = await LabelOcr.recognizeNative(onProgress);
      if (!result) { status.textContent = ''; return; } // korisnik je odustao
    }
    const { text, confidence } = result;
    if (!text.trim()) {
      status.textContent = 'Na slici nije prepoznat tekst. Pokušaj bliže, oštrije i uz bolje svjetlo.';
      return;
    }
    const raw = $('#raw-text');
    raw.value = raw.value.trim() ? `${raw.value.trim()}\n\n${text.trim()}` : text.trim();
    const filled = applyParsed(LabelOcr.parseLabel(raw.value));
    status.textContent = `Tekst prepoznat${confidence != null ? ` (pouzdanost ${Math.round(confidence)} %)` : ''}. `
      + (filled.length ? `Popunjeno: ${filled.join(', ')}. ` : 'Polja nisu automatski prepoznata — prepiši ih iz prepoznatog teksta. ')
      + 'Obavezno provjeri sve vrijednosti.';
  } catch (err) {
    status.classList.add('error');
    status.textContent = 'Prepoznavanje teksta nije uspjelo: ' + errMsg(err);
  } finally {
    btn.disabled = false;
    progress.hidden = true;
  }
}

async function saveEditor(e) {
  e.preventDefault();
  const msg = $('#editor-msg');
  msg.classList.remove('error');
  const fail = (text) => { msg.classList.add('error'); msg.textContent = text; };
  let data;
  try {
    data = formToData();
  } catch (err) {
    fail(err.message);
    return;
  }
  if (!data.product_name) {
    fail('Upiši barem naziv proizvoda.');
    field('product_name').focus();
    return;
  }
  const code = editorState.code;

  if (!Api.enabled) {
    try {
      await LocalDb.put({ code, v: 2, data, image_blob: editorState.imageBlob || undefined, updated: Date.now() });
    } catch (err) {
      fail('Spremanje nije uspjelo (preglednik možda ne dopušta lokalnu pohranu): ' + errMsg(err));
      return;
    }
    showView('main-view');
    setStatus('Spremljeno na ovom uređaju.');
    lookup(code);
    return;
  }

  if (!(await Api.currentUser())) {
    pendingAfterLogin = () => { showView('editor'); $('#editor-msg').textContent = 'Prijavljen/a si — pritisni ponovno „Pošalji”.'; };
    openLogin('Za slanje podataka u zajedničku bazu prijavi se.');
    return;
  }

  const btn = $('#save-btn');
  btn.disabled = true;
  msg.textContent = 'Šaljem…';
  try {
    if (editorState.imageBlob && !editorState.uploaded) {
      msg.textContent = 'Šaljem fotografiju…';
      editorState.imagePath = await Api.uploadImage(code, editorState.imageBlob);
      editorState.uploaded = true;
      data.image_path = editorState.imagePath;
    }
    const res = await Api.submit(code, data);
    // Poslano u zajedničku bazu — lokalna kopija više nije potrebna.
    if (editorState.localRecord) await LocalDb.remove(code).catch(() => {});
    showView('main-view');
    setStatus(res.state === 'pending'
      ? 'Izmjena je poslana kao prijedlog. Postat će važeća kad je potvrde dva druga korisnika.'
      : 'Poslano u zajedničku bazu. Podaci su vidljivi svima s oznakom „neprovjereno” dok ih ne potvrde dva druga korisnika.');
    const status = statusEl.textContent;
    await lookup(code);
    setStatus(status);
  } catch (err) {
    fail('Slanje nije uspjelo: ' + errMsg(err));
  } finally {
    btn.disabled = false;
  }
}

async function deleteLocal() {
  if (!editorState || !confirm('Obrisati podatke spremljene na ovom uređaju za ovaj proizvod?')) return;
  try { await LocalDb.remove(editorState.code); } catch { /* već obrisano */ }
  lookup(editorState.code);
}

/* ---------- Glasanje ---------- */

async function castVote(revisionId, value) {
  if (!(await Api.currentUser())) {
    const code = resultEl.dataset.code;
    pendingAfterLogin = () => lookup(code);
    openLogin('Za potvrdu ili prijavu greške prijavi se.');
    return;
  }
  let comment = null;
  if (value === -1) {
    comment = prompt('Što nije točno? (neobavezno)');
    if (comment === null) return; // odustao
  }
  const code = resultEl.dataset.code;
  try {
    const res = await Api.vote(revisionId, value, comment);
    await lookup(code);
    setStatus(value === 1
      ? (res.revision_state === 'published' && res.status === 'verified' ? 'Hvala! Podaci su sada provjereni.' : 'Hvala na potvrdi!')
      : 'Hvala, greška je prijavljena.');
  } catch (err) {
    setStatus('Glasanje nije uspjelo: ' + errMsg(err), true);
  }
}

/* ---------- Prijava i račun ---------- */

let pendingAfterLogin = null;
let loginEmail = '';
let loginReturnView = 'main-view';

function openLogin(reason) {
  loginReturnView = ['main-view', 'editor', 'account'].find((id) => !$(`#${id}`).hidden) || 'main-view';
  $('#email-form').hidden = false;
  $('#code-form').hidden = true;
  $('#login-msg').classList.remove('error');
  $('#login-msg').textContent = reason || '';
  showView('login');
}

async function refreshAccount(user) {
  const btn = $('#account-btn');
  btn.hidden = !Api.enabled;
  if (!Api.enabled) return;
  btn.textContent = user ? '👤 Račun' : 'Prijava';
  if (user) {
    $('#account-email').textContent = user.email || '';
    $('#account-admin').hidden = !(await Api.isAdmin().catch(() => false));
  }
}

$('#account-btn').addEventListener('click', async () => {
  const user = await Api.currentUser();
  if (user) { await refreshAccount(user); showView('account'); } else { pendingAfterLogin = null; openLogin(); }
});

$('#email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#login-msg');
  msg.classList.remove('error');
  loginEmail = $('#login-email').value.trim();
  msg.textContent = 'Šaljem kod…';
  try {
    await Api.sendCode(loginEmail);
    $('#email-form').hidden = true;
    $('#code-form').hidden = false;
    msg.textContent = `Kod je poslan na ${loginEmail}. Provjeri i mapu neželjene pošte.`;
    $('#login-code').focus();
  } catch (err) {
    msg.classList.add('error');
    msg.textContent = 'Slanje koda nije uspjelo: ' + errMsg(err);
  }
});

$('#code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#login-msg');
  msg.classList.remove('error');
  try {
    await Api.verifyCode(loginEmail, $('#login-code').value.trim());
    $('#login-code').value = '';
    const after = pendingAfterLogin;
    pendingAfterLogin = null;
    if (after) after(); else { showView('main-view'); setStatus('Prijavljen/a si.'); }
  } catch (err) {
    msg.classList.add('error');
    msg.textContent = 'Kod nije ispravan ili je istekao: ' + errMsg(err);
  }
});

$('#login-cancel').addEventListener('click', () => {
  pendingAfterLogin = null;
  showView(loginReturnView);
});
$('#account-back').addEventListener('click', () => showView('main-view'));
$('#logout-btn').addEventListener('click', async () => {
  try { await Api.signOut(); } catch { /* lokalna odjava svejedno */ }
  showView('main-view');
  setStatus('Odjavljen/a si.');
});
$('#delete-account-btn').addEventListener('click', async () => {
  if (!confirm('Trajno obrisati račun? Ova radnja se ne može poništiti.')) return;
  try {
    await Api.deleteAccount();
    showView('main-view');
    setStatus('Račun je obrisan.');
  } catch (err) {
    $('#account-msg').textContent = 'Brisanje nije uspjelo: ' + errMsg(err);
  }
});

/* ---------- Događaji ---------- */

buildEditor();
editorForm.addEventListener('submit', saveEditor);
field('type').addEventListener('change', updateTypeVisibility);
$('#cancel-btn').addEventListener('click', () => showView('main-view'));
$('#delete-btn').addEventListener('click', deleteLocal);
$('#ocr-btn').addEventListener('click', () => {
  if (LabelOcr.hasNative()) runOcr(null); else $('#ocr-file').click();
});
$('#ocr-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) runOcr(file);
});
$('#reparse-btn').addEventListener('click', () => {
  const filled = applyParsed(LabelOcr.parseLabel($('#raw-text').value));
  $('#ocr-status').textContent = filled.length ? `Popunjeno: ${filled.join(', ')}.` : 'Ništa novo nije prepoznato (popunjavaju se samo prazna polja).';
});
// Android aplikacija: fotografija proizvoda izvornom kamerom (pouzdanije od odabira datoteke u WebViewu).
editorForm.addEventListener('click', async (e) => {
  const label = e.target.closest('.button-like');
  if (!label || !LabelOcr.hasNative()) return;
  e.preventDefault();
  try {
    const photo = await LabelOcr.takeNativePhoto();
    if (!photo) return;
    const cap = window.Capacitor;
    const src = photo.webPath || (cap && cap.convertFileSrc ? cap.convertFileSrc(photo.uri) : photo.uri);
    const blob = await (await fetch(src)).blob();
    editorState.imageBlob = await resizeToBlob(blob);
    editorState.uploaded = false;
    editorState.imagePath = null;
    renderEditorPhoto();
  } catch (err) {
    $('#editor-msg').textContent = 'Fotografija se ne može učitati: ' + errMsg(err);
  }
});
$('#photo-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    editorState.imageBlob = await resizeToBlob(file);
    editorState.uploaded = false;
    editorState.imagePath = null;
    renderEditorPhoto();
  } catch {
    $('#editor-msg').textContent = 'Fotografija se ne može učitati.';
  }
});

resultEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'edit') openEditor(btn.dataset.code);
  else if (btn.dataset.action === 'vote') castVote(Number(btn.dataset.rev), Number(btn.dataset.value));
  else if (btn.dataset.action === 'login') { const code = resultEl.dataset.code; pendingAfterLogin = () => lookup(code); openLogin(); }
});

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
Api.onAuthChange((user) => refreshAccount(user));
Api.currentUser().then(refreshAccount).catch(() => refreshAccount(null));

// Service worker samo za web verziju (u Android aplikaciji datoteke su već na uređaju).
if ('serviceWorker' in navigator && location.protocol === 'https:' && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
