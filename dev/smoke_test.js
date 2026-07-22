// Smoke-Test für Xselli's Stats-Rechner
// ------------------------------------------------------------------
// Startet eine eigene Server-Instanz (Temp-Datenverzeichnis, freier Port),
// testet die Server-API direkt per fetch und das Frontend in jsdom.
//
// Voraussetzungen (einmalig, NICHT Teil der Produktions-Abhängigkeiten):
//   npm install jsdom
// Ausführen (aus dem Repo-Hauptverzeichnis):
//   node dev/smoke_test.js
//
// mathjs wird aus public/vendor/ eingebunden (liegt seit v0.10.0 lokal bei),
// es ist also kein Netzwerkzugriff nötig.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
const ADMIN = 'SmokeAdmin';
const wait = ms => new Promise(r => setTimeout(r, ms));
const uniq = Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
const num = s => Number(String(s).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.error('jsdom fehlt - bitte einmalig "npm install jsdom" ausführen.'); process.exit(2); }

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  OK  ' + name); }
  else { failed++; console.error('  FEHLER  ' + name + (detail !== undefined ? ' -> ' + detail : '')); }
}

async function api(p, opts, token) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {});
  const res = await fetch(BASE + p, Object.assign({ headers }, opts || {}));
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

// Frontend in jsdom laden. mathjs (CDN-Tag oder vendor-Tag) wird durch den
// lokalen vendor-Inhalt ersetzt, damit kein Netz-/Timing-Problem entsteht.
// extraLocalStorage: Einträge, die VOR dem Skriptstart gesetzt werden.
function loadFrontend(extraLocalStorage) {
  let html = fs.readFileSync(path.join(REPO, 'public/index.html'), 'utf8');
  const mathSrc = fs.readFileSync(path.join(REPO, 'public/vendor/mathjs-11.8.0.min.js'), 'utf8');
  html = html.replace(/<script src="[^"]*mathjs[^"]*"><\/script>/, () => '<script>' + mathSrc + '</script>');
  const dom = new JSDOM(html, {
    url: BASE + '/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      if (extraLocalStorage) for (const k in extraLocalStorage) window.localStorage.setItem(k, extraLocalStorage[k]);
      window.fetch = (u, o) => fetch(typeof u === 'string' && u.startsWith('/') ? BASE + u : u, o);
    },
  });
  return dom;
}
const input = (win, el, val) => { el.value = val; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
const change = (win, el, val) => { el.value = val; el.dispatchEvent(new win.Event('change', { bubbles: true })); };

(async () => {
  /* ================= Server starten ================= */
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xselli-smoke-'));
  const server = spawn('node', ['server.js'], {
    cwd: REPO,
    env: Object.assign({}, process.env, { DATA_DIR: dataDir, JWT_SECRET: 'smoketest', PORT: String(PORT), ADMIN_USERNAME: ADMIN }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await wait(250);
    try { up = (await fetch(BASE + '/api/version')).ok; } catch (e) { /* noch nicht bereit */ }
  }
  if (!up) { console.error('Server startet nicht'); server.kill('SIGKILL'); process.exit(2); }
  console.log('Server läuft auf Port ' + PORT + ', Daten in ' + dataDir);

  try {
    /* ================= 1) Server-API ================= */
    console.log('\n[1] Auth, Passwort ändern, Login-Bremse');
    const user = 'smoke_' + uniq;
    let r = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: user, password: 'pass1234' }) });
    check('Registrieren', r.status === 201 && r.data.token, r.status);
    const token = r.data.token;

    r = await api('/api/me/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: 'FALSCH', newPassword: 'neu1234' }) }, token);
    check('Passwort ändern mit falschem alten Passwort -> 401', r.status === 401, r.status);
    r = await api('/api/me/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: 'pass1234', newPassword: 'neu1234' }) }, token);
    check('Passwort ändern', r.status === 200, r.status);
    r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: 'neu1234' }) });
    check('Login mit neuem Passwort', r.status === 200, r.status);

    const bruteUser = 'brute_' + uniq;
    await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: bruteUser, password: 'richtig' }) });
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: bruteUser, password: 'falsch' + i }) })).status;
    }
    check('Login-Bremse: 11. Fehlversuch -> 429', last === 429, last);
    r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: bruteUser, password: 'richtig' }) });
    check('Auch richtiges Passwort ist während der Sperre blockiert', r.status === 429, r.status);

    console.log('\n[2] Charakterdaten-Validierung');
    const charV = 'Valid_' + uniq;
    await api('/api/characters', { method: 'POST', body: JSON.stringify({ name: charV }) }, token);
    r = await api('/api/characters/' + encodeURIComponent(charV), { method: 'PUT', body: JSON.stringify({ grunddaten: { itemlevel: 1000 }, boesesFeld: { x: 1 }, __proto__x: 2 }) }, token);
    check('Speichern mit Fremd-Schlüsseln akzeptiert', r.status === 200, r.status);
    r = await api('/api/characters/' + encodeURIComponent(charV), {}, token);
    check('Fremd-Schlüssel wurden verworfen', r.data && r.data.data && r.data.data.grunddaten && !('boesesFeld' in r.data.data), JSON.stringify(r.data && r.data.data).slice(0, 80));
    r = await api('/api/characters/' + encodeURIComponent(charV), { method: 'PUT', body: JSON.stringify({ grunddaten: { itemlevel: 1, riesig: 'x'.repeat(400000) } }) }, token);
    check('Übergroße Daten -> 413', r.status === 413, r.status);

    console.log('\n[3] Shared: rev-Konflikt + Historie');
    // Moderator-Rechte nötig: Admin registrieren und dem Test-User die Rolle geben
    const adm = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: ADMIN, password: 'adminpw' }) });
    const admToken = adm.data && adm.data.token;
    await api('/api/admin/users/' + encodeURIComponent(user), { method: 'PUT', body: JSON.stringify({ role: 'coadmin' }) }, admToken);
    let shared = (await api('/api/shared')).data;
    const rev0 = shared.rev || 0;
    r = await api('/api/shared/presets', { method: 'PUT', body: JSON.stringify({ rev: rev0, companionDb: { Smoke: {} } }) }, token);
    check('Presets speichern mit aktueller rev', r.status === 200 && r.data.rev === rev0 + 1, r.status + '/' + (r.data && r.data.rev));
    r = await api('/api/shared/presets', { method: 'PUT', body: JSON.stringify({ rev: rev0, companionDb: { Alt: {} } }) }, token);
    check('Presets speichern mit veralteter rev -> 409', r.status === 409, r.status);
    r = await api('/api/shared/formulas', { method: 'PUT', body: JSON.stringify({ formulas: { eTotal: 'H + sourcesWerte' } }) }, token);
    check('Speichern ohne rev bleibt möglich (Altclient)', r.status === 200, r.status);
    const histDir = path.join(dataDir, 'backups', 'shared');
    check('Shared-Historie wird geschrieben', fs.existsSync(histDir) && fs.readdirSync(histDir).length >= 2, fs.existsSync(histDir) && fs.readdirSync(histDir).length);
    check('Tägliches Backup existiert', fs.existsSync(path.join(dataDir, 'backups', 'daily')) && fs.readdirSync(path.join(dataDir, 'backups', 'daily')).length === 1);

    console.log('\n[4] Cache-Header');
    let res = await fetch(BASE + '/index.html');
    check('HTML: Cache-Control no-cache', (res.headers.get('cache-control') || '').includes('no-cache'), res.headers.get('cache-control'));
    res = await fetch(BASE + '/vendor/mathjs-11.8.0.min.js');
    check('vendor: langlebig gecacht', (res.headers.get('cache-control') || '').includes('max-age=2592000'), res.headers.get('cache-control'));

    /* ================= 2) Frontend (jsdom) ================= */
    console.log('\n[5] Rechner-Basis (Gast) + Gast-Zwischenspeicher');
    let dom = loadFrontend();
    let win = dom.window, doc = win.document;
    await wait(1200);
    input(win, doc.getElementById('itemlevel'), '100000');
    change(win, doc.getElementById('klasse'), 'Kämpfer');
    await wait(150);
    change(win, doc.getElementById('vorbildpfad'), 'Schwertmeister (DPS)');
    await wait(150);
    input(win, doc.querySelector('input[data-role="H"][data-stat="kraft"]'), '110000');
    input(win, doc.querySelector('input[data-role="I"][data-stat="kraft"]'), '50');
    await wait(700); // debounce des Gast-Speicherns abwarten
    check('E-Zelle rechnet', doc.getElementById('E-kraft').textContent.replace(/\./g, '') === '110000', doc.getElementById('E-kraft').textContent);
    // Wehrhaftigkeit-Umverteilung (Regression nach computeAll-Umbau)
    input(win, doc.querySelector('input[data-role="H"][data-stat="wehrhaftigkeit"]'), '80000');
    input(win, doc.querySelector('input[data-src="Kopf"][data-stat="wehrhaftigkeit"][data-field="prozent"]'), '10');
    await wait(200);
    check('Wehrhaftigkeit-Umverteilung (+50 % der Differenz auf Kraft)', doc.getElementById('F-kraft').textContent.startsWith('55'), doc.getElementById('F-kraft').textContent);
    const guestSaved = win.localStorage.getItem('xselli_guest');
    check('Gast-Daten im Browser gespeichert', !!guestSaved && JSON.parse(guestSaved).grunddaten.itemlevel === 100000, (guestSaved || '').slice(0, 60));

    // "Neuer Besuch": zweite jsdom-Instanz mit denselben localStorage-Daten
    let dom2 = loadFrontend({ xselli_guest: guestSaved });
    await wait(1200);
    check('Gast-Daten beim nächsten Besuch wiederhergestellt', num(dom2.window.document.getElementById('itemlevel').value) === 100000, dom2.window.document.getElementById('itemlevel').value);
    check('Wiederherstellungs-Hinweis sichtbar', dom2.window.document.getElementById('saveStatus').textContent.includes('wiederhergestellt'));
    dom2.window.close();

    console.log('\n[6] Beispielcharakter');
    win.confirmAction('demo');
    doc.getElementById('modalConfirm').click();
    await wait(400);
    check('Demo: Gegenstandsstufe gesetzt', num(doc.getElementById('itemlevel').value) === 95000, doc.getElementById('itemlevel').value);
    check('Demo: Klasse gesetzt', doc.getElementById('klasse').value === 'Kämpfer');
    check('Demo: Kraft-Prozent gefüllt', doc.getElementById('F-kraft').textContent.trim() !== '' && !doc.getElementById('F-kraft').textContent.startsWith('0'));
    dom.window.close();

    console.log('\n[7] Login, Vergleich, Waffenschaden-Bonus');
    // Zwei Charaktere per API: A DPS ohne Bonus, B identisch mit Waffenschaden-Bonus
    const vglUser = 'vgl_' + uniq;
    const reg2 = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: vglUser, password: 'pass1234' }) });
    const t2 = reg2.data.token;
    const cA = 'Alpha_' + uniq, cB = 'Beta_' + uniq;
    await api('/api/characters', { method: 'POST', body: JSON.stringify({ name: cA }) }, t2);
    await api('/api/characters', { method: 'POST', body: JSON.stringify({ name: cB }) }, t2);
    const common = { grunddaten: { itemlevel: 100000, klasse: 'Kämpfer', vorbildpfad: 'Schwertmeister (DPS)', klassentyp: 'DPS' }, baseInputs: { kraft: { H: 140000, I: 90 } }, sourceInputs: {} };
    await api('/api/characters/' + encodeURIComponent(cA), { method: 'PUT', body: JSON.stringify(common) }, t2);
    await api('/api/characters/' + encodeURIComponent(cB), { method: 'PUT', body: JSON.stringify(Object.assign({}, common, { uebersichtParams: { waffenschadenBonus: 1000, waffenschadenBonusPct: 10 } })) }, t2);

    dom = loadFrontend();
    win = dom.window; doc = win.document;
    await wait(1200);
    win.openAccountPanel(); await wait(300);
    input(win, doc.getElementById('acc_username'), vglUser);
    input(win, doc.getElementById('acc_password'), 'pass1234');
    win.loginAccount(); await wait(800);
    win.selectCharacterByIndex(0); await wait(800);
    win.showPage('uebersicht'); await wait(800);
    check('Waffenschaden-Basis 12.000', num((doc.getElementById('uebersichtContent').textContent.match(/Waffenschaden:\s*([\d.,]+)/) || [])[1]) === 12000);
    const selB = doc.querySelector('select[data-vgl="b"]');
    check('Vergleichs-Dropdowns vorhanden', !!selB);
    const optB = Array.from(selB.options).find(o => o.textContent.includes('Beta_'));
    change(win, selB, optB.value); await wait(900);
    const acc = doc.getElementById('acc-dmg-vergleich');
    acc.classList.add('open');
    const rows = Array.from(acc.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()));
    const wsRow = rows.find(r => r[0] && r[0].startsWith('Waffenschaden'));
    check('Vergleich: B nutzt eigenen gespeicherten Bonus (14.300)', wsRow && num(wsRow[4]) === 14300, wsRow && wsRow[4]);
    const gesamtRow = rows.find(r => r[0] === 'Gesamt');
    check('Vergleich: Gesamtdifferenz +19,17 %', gesamtRow && gesamtRow[5].includes('+19,17'), gesamtRow && gesamtRow[5]);
    const checks = acc.querySelectorAll('input[type="checkbox"]');
    check('Vergleich: 3 Ankreuzfelder, Schaden vorbelegt', checks.length === 3 && checks[0].checked && !checks[2].checked);
    win.toggleVergleichSection('tank', true); await wait(300);
    check('Vergleich: Tank-Bereich zuschaltbar', doc.getElementById('acc-dmg-vergleich').textContent.includes('Tank (effektive Trefferpunkte)'));

    console.log('\n[8] Passwort-ändern-Formular + Formel-Vorschau');
    win.openAccountPanel(); await wait(400);
    input(win, doc.getElementById('acc_oldpw'), 'pass1234');
    input(win, doc.getElementById('acc_newpw'), 'anders123');
    await win.changePassword(); await wait(300);
    check('Passwort-Formular meldet Erfolg', doc.getElementById('accMsg').textContent.includes('geändert'), doc.getElementById('accMsg').textContent);
    win.closeAccountModal();
    dom.window.close();

    // Formel-Vorschau braucht Coadmin: als Test-User (hat die Rolle aus [3]) einloggen
    dom = loadFrontend();
    win = dom.window; doc = win.document;
    await wait(1200);
    win.openAccountPanel(); await wait(300);
    input(win, doc.getElementById('acc_username'), user);
    input(win, doc.getElementById('acc_password'), 'neu1234');
    win.loginAccount(); await wait(800);
    win.closeAccountModal();
    win.showPage('formeln'); await wait(300);
    const preview = doc.getElementById('formelPreview');
    check('Formel-Vorschau rechnet', preview && preview.textContent.includes('Totale Werte') && preview.textContent.includes('105'), preview && preview.textContent.slice(0, 60));
    input(win, doc.getElementById('f_eTotal'), 'H + kaputt(');
    await wait(150);
    check('Formel-Vorschau zeigt Fehler an', doc.getElementById('formelPreview').textContent.includes('Fehler'));
    dom.window.close();
  } catch (e) {
    failed++;
    console.error('\nUNERWARTETER TESTFEHLER:', e.message);
  }

  server.kill('SIGKILL');
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`\nErgebnis: ${passed} OK, ${failed} Fehler`);
  process.exit(failed ? 1 : 0);
})();
