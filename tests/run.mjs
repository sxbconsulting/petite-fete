// Protocole de vérification (CLAUDE.md §10) — à lancer avant chaque livraison :
//   cd tests && npm test
// 1. syntaxe du <script> (node --check)
// 2. chaque $('#id') existe dans le HTML
// 3. parcours sans écran, réseau coupé (mode local), en anglais puis en français :
//    intro → création → appareil (+ envoi d'une photo) → galerie → réglages → renommage

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, '..', 'index.html');
const OUT = join(HERE, 'artifacts');
const ORIGIN = 'http://petite-fete.test/';
const QR_LIB = readFileSync(join(HERE, 'node_modules', 'qrcode-generator', 'qrcode.js'), 'utf8');

// Faux Supabase, pour le parcours « invité arrivé par le lien » : une seule fête FETE-TEST, aucune photo
const FAKE_EVENT = { id: 'ev-test', code: 'FETE-TEST', event_name: 'Lana 🎂', event_type: 'birthday',
  host_name: 'Billal', reveal_mode: 'immediate', reveal_at: null, is_closed: false, photo_limit: null };
const FAKE_SUPABASE = `window.supabase = { createClient: () => {
  const ev = ${JSON.stringify(FAKE_EVENT)};
  const from = table => {
    const row = table === 'once_events' ? ev : null, c = {};
    ['select','eq','order','limit','insert','update','delete'].forEach(m => c[m] = () => c);
    c.single = c.maybeSingle = () => Promise.resolve({ data: row, error: null });
    c.then = (ok, ko) => Promise.resolve({ data: row ? [row] : [], error: null }).then(ok, ko);
    return c;
  };
  return { from, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => ({}) }) } };
} };`;
mkdirSync(OUT, { recursive: true });

const html = readFileSync(INDEX, 'utf8');
const failures = [];
const fail = (where, msg) => { failures.push(`[${where}] ${msg}`); console.log(`  ✗ ${msg}`); };
const pass = msg => console.log(`  ✓ ${msg}`);
// défaut réel de l'app qui ne bloque pas le parcours : signalé, pas bloquant
const warnings = [];
const warn = (where, msg) => { warnings.push(`[${where}] ${msg}`); console.log(`  ⚠ ${msg}`); };

/* ---------- 1. syntaxe ---------- */
console.log('\n1. Syntaxe du script');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = scripts.join('\n;\n');
const tmp = join(tmpdir(), 'petite-fete-script.js');
writeFileSync(tmp, js);
const chk = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
if (chk.status === 0) pass(`node --check OK (${js.split('\n').length} lignes)`);
else fail('syntaxe', chk.stderr.trim());

const version = (js.match(/APP_VERSION\s*=\s*"([^"]+)"/) || [])[1];
pass(`APP_VERSION = ${version}`);

/* ---------- 2. ids ---------- */
console.log('\n2. Sélecteurs #id');
const ids = new Set([...html.matchAll(/\sid="([\w-]+)"/g)].map(m => m[1]));
// ids écrits en dur : $('#x') ou $$('#x .y') — pas $('#view-'+t)
const used = new Set([...js.matchAll(/\$\$?\(\s*['"]#([\w-]+)(?![\w-]|['"]\s*\+)/g)].map(m => m[1]));
// ids construits dynamiquement : $('#'+id) / $('#view-'+t)
for (const m of js.matchAll(/\[([^\]]+)\]\.forEach\(\s*(\w+)\s*=>\s*\$\('#(view-)?'\s*\+\s*\2\)/g)) {
  for (const s of m[1].matchAll(/'([\w-]+)'/g)) used.add((m[3] || '') + s[1]);
}
const missing = [...used].filter(id => !ids.has(id));
if (missing.length) fail('ids', 'introuvables dans le HTML : ' + missing.join(', '));
else pass(`${used.size} ids utilisés, tous présents`);

/* ---------- 3. parcours ---------- */
// Repère un texte resté en français dans la version anglaise
const FR_ALLOW = ['Français', 'Petite Fête', 'Langue · Language'];
const FR_RE = /[àâçéèêëîïôûùœ]|\b(le|la|les|des|du|une|et|tu|ton|ta|tes|pour|avec|sans|ici|dans|aucun|aucune|ouvrir|fermer|retour|photos? de)\b/i;

async function frenchLeftovers(page) {
  const found = await page.evaluate(() => {
    const out = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => /^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) ? 2 : 1
    });
    // seulement ce que l'utilisateur voit à l'écran
    while (tw.nextNode()) {
      const n = tw.currentNode, v = n.nodeValue.trim();
      if (v && n.parentElement.checkVisibility()) out.push(v);
    }
    document.querySelectorAll('[placeholder],[aria-label],[alt]').forEach(el => el.checkVisibility() &&
      ['placeholder', 'aria-label', 'alt'].forEach(a => el.hasAttribute(a) && out.push(el.getAttribute(a))));
    out.push(document.title);
    return out;
  });
  return [...new Set(found)].filter(s => FR_RE.test(s) && !FR_ALLOW.some(a => s.includes(a)));
}

// mode 'local' : l'organisateur crée et utilise un album hors ligne
// mode 'lien'  : un invité ouvre ?code=… et rejoint la fête (Supabase simulé)
async function journey(lang, browser, mode = 'local') {
  console.log(`\n3. Parcours ${lang.toUpperCase()} — ${mode === 'lien' ? 'invité par lien' : 'organisateur, mode local'}`);
  const where = `parcours ${lang} ${mode}`;
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && /Petite Fête/.test(m.text())) errors.push('console: ' + m.text()); });

  // réseau coupé : seuls la page, la librairie QR (copie locale) et, en mode lien, le faux Supabase sont servis
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = new URL(r.url()), js = body => r.respond({ status: 200, contentType: 'text/javascript', body });
    if (u.origin + u.pathname === ORIGIN) r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    else if (u.pathname.includes('/qrcode-generator@')) js(QR_LIB);
    else if (mode === 'lien' && u.pathname.includes('/@supabase/supabase-js')) js(FAKE_SUPABASE);
    else r.abort();
  });

  // confirm() → oui ; prompt() → nouveau nom
  const NEW_NAME = lang === 'en' ? 'Renamed party' : 'Fête renommée';
  page.on('dialog', d => d.type() === 'prompt' ? d.accept(NEW_NAME) : d.accept());

  await page.evaluateOnNewDocument(l => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear(); localStorage.setItem('once_lang', l); sessionStorage.setItem('seeded', '1');
    }
  }, lang);
  await page.goto(mode === 'lien' ? ORIGIN + '?code=fete-test' : ORIGIN, { waitUntil: 'domcontentloaded' });

  const leftovers = new Set();
  const visible = sel => page.$eval(sel, el => el.checkVisibility()).catch(() => false);
  const text = sel => page.$eval(sel, el => el.textContent.trim());
  const shot = name => page.screenshot({ path: join(OUT, `${lang}-${mode}-${name}.png`) });
  const step = async (name, fn) => {
    try { await fn(); pass(name); }
    catch (e) { fail(where, `${name} : ${e.message}`); }
    await shot(name.replace(/\W+/g, '-').toLowerCase());
    if (lang === 'en') (await frenchLeftovers(page)).forEach(s => leftovers.add(s));
  };
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  if (mode === 'lien') {
    await step('ouverture du lien', async () => {
      expect(!(await visible('#view-intro')), 'l\'intro s\'affiche alors que l\'invité arrive par un lien');
      expect(await visible('#form-join'), 'formulaire « Rejoindre » non affiché');
      expect((await page.$eval('#in-code', el => el.value)) === 'FETE-TEST', 'code non pré-rempli');
      await page.waitForSelector('#join-found:not(.hidden)', { timeout: 3000 });
      expect((await text('#join-title')).includes('Lana 🎂'), 'nom de la fête absent');
      expect(!page.url().includes('code='), 'le ?code= reste dans l\'adresse');
    });
    await step('entrée dans la fête', async () => {
      await page.type('#in-photog', 'Sarah');
      await page.click('#btn-join');
      await wait(300);
      expect(await visible('#view-camera'), 'vue appareil non visible');
      expect((await text('#cam-evname')) === 'Lana 🎂', 'mauvais album');
      await page.waitForSelector('#howto:not(.hidden)', { timeout: 2000 });
      await page.click('#ht-next'); await wait(100); await page.click('#ht-next');
    });
    await step('QR code dans les réglages', async () => {
      await page.click('#tabbar [data-tab="settings"]');
      await wait(200);
      expect(await visible('#qr-settings svg'), 'QR code absent des réglages');
      expect(await visible('#btn-share-set'), 'bouton « Partager le lien » absent');
    });
  } else {
  await step('intro affichée', async () => {
    expect(await visible('#view-intro'), 'intro non visible');
    for (let i = 0; i < 3; i++) { await page.click('#btn-intro-next'); await wait(150); }
    expect(await visible('#form-create'), 'le formulaire de création ne s\'ouvre pas');
  });

  await step('création d\'un album', async () => {
    await page.type('#in-evname', 'Test Lana');
    await page.type('#in-child', 'Lana');
    await page.type('#in-host', 'Billal');
    await page.click('#limit-chips [data-limit="5"]');
    await page.click('#btn-create');
    await page.waitForFunction(() => /^FETE-[A-Z0-9]{4}$/.test(document.querySelector('#out-code').textContent), { timeout: 3000 });
    expect(await visible('#block-code'), 'code non affiché');
    expect(!(await visible('#qr-created')), 'QR affiché pour un album local, que personne ne peut rejoindre');
  });

  await step('appareil photo', async () => {
    await page.click('#btn-enter-created');
    await wait(300);
    expect(await visible('#view-camera'), 'vue appareil non visible');
    expect((await text('#cam-evname')) === 'Test Lana', 'nom de l\'album absent');
    // mode d'emploi (1re entrée)
    await page.waitForSelector('#howto:not(.hidden)', { timeout: 2000 });
    await page.click('#ht-next'); await wait(100); await page.click('#ht-next');
    expect(!(await visible('#howto')), 'mode d\'emploi pas refermé');
  });

  await step('envoi d\'une photo', async () => {
    const input = await page.$('#file-in');
    await input.uploadFile(join(OUT, 'fixture.jpg'));
    await page.waitForSelector('#preview:not(.hidden)', { timeout: 4000 });
    await page.click('#rx-row [data-rx="🥳"]');
    await page.click('#btn-send');
    await page.waitForSelector('#strip img', { timeout: 4000 });
    expect(/^4\/5/.test(await text('#cam-count')), 'compteur de poses incorrect : ' + await text('#cam-count'));
  });

  await step('galerie', async () => {
    await page.click('#tabbar [data-tab="gallery"]');
    await wait(200);
    expect(await visible('#view-gallery'), 'galerie non visible');
    expect((await page.$$('#gal-body .ph')).length === 1, 'la photo n\'apparaît pas dans la galerie');
    await page.click('#gal-body .ph');
    expect(await visible('#lightbox'), 'lightbox non ouverte');
    // le ✕ est-il vraiment cliquable, ou recouvert (ex. bandeau mode local) ?
    const cover = await page.$eval('#lb-close', el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el.contains(top) ? null : '#' + (top.closest('[id]') || {}).id;
    });
    if (cover) {
      fail(where, `bouton ✕ de la lightbox recouvert par ${cover} : impossible de la fermer au doigt`);
      await page.$eval('#lb-close', el => el.click());
    } else await page.click('#lb-close');
    expect(!(await visible('#lightbox')), 'lightbox pas refermée');
  });

  await step('réglages', async () => {
    await page.click('#tabbar [data-tab="settings"]');
    await wait(200);
    expect(await visible('#view-settings'), 'réglages non visibles');
    expect((await text('#ver')) === version, 'version absente des réglages');
    expect((await text('#set-people')).includes('Billal'), 'photographe absent');
  });

  await step('renommage', async () => {
    await page.click('#btn-rename');
    await wait(200);
    expect((await text('#set-evname')) === NEW_NAME, 'nom non mis à jour : ' + await text('#set-evname'));
    expect((await text('#cam-evname')) === NEW_NAME, 'en-tête appareil non mis à jour');
  });

  await step('retour à l\'accueil', async () => {
    await page.click('#btn-new-album');
    await wait(400);
    expect(await visible('#form-create'), 'formulaire non affiché');
    await page.click('#form-create [data-go="home"]');
    expect((await page.$$('#home-sessions .sess')).length === 1, 'album absent de « Mes albums »');
  });
  }

  const toastTxt = await text('#toast');
  if (/^(Erreur|Error)/.test(toastTxt)) errors.push('toast: ' + toastTxt);
  if (errors.length) errors.forEach(e => fail(where, e)); else pass('zéro erreur JS');

  if (lang === 'en') {
    if (leftovers.size) fail(where, 'texte français résiduel : ' + [...leftovers].map(s => JSON.stringify(s)).join(', '));
    else pass('aucun texte français résiduel');
  }
  await page.close();
}

const browser = await puppeteer.launch({ headless: 'shell' });
try {
  // photo de test : une capture d'écran quelconque fait l'affaire
  const p = await browser.newPage();
  await p.setContent('<body style="margin:0;background:linear-gradient(#ffd6e8,#c9ecff);font:80px sans-serif">🎂🎈</body>');
  await p.screenshot({ path: join(OUT, 'fixture.jpg'), type: 'jpeg' });
  await p.close();

  for (const lang of ['en', 'fr']) {
    await journey(lang, browser, 'local');
    await journey(lang, browser, 'lien');
  }
} finally {
  await browser.close();
}

if (warnings.length) console.log(`\n⚠ ${warnings.length} avertissement(s)\n` + warnings.map(w => '  - ' + w).join('\n'));
console.log(failures.length
  ? `\n✗ ${failures.length} échec(s)\n` + failures.map(f => '  - ' + f).join('\n')
  : '\n✓ Tout passe. Captures dans tests/artifacts/');
process.exit(failures.length ? 1 : 0);
