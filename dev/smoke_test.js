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
      window.confirm = () => true; // jsdom hat kein echtes confirm - Dirty-Guard-Dialoge immer bestätigen
    },
  });
  return dom;
}
const input = (win, el, val) => { el.value = val; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
// Wartet aktiv, bis die Statusmeldung den erwarteten Text enthält (fixe Wartezeiten
// sind beim Optimierer zu fragil: die Rechenzeit verschiebt alle nachgelagerten Timer).
const waitForStatus = async (d, substr, ms = 6000) => {
  const t0 = Date.now();
  while(Date.now() - t0 < ms){
    if(d.getElementById('saveStatus').textContent.includes(substr)) return true;
    await wait(120);
  }
  return false;
};
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
    let token = r.data.token; // wird nach jedem Passwortwechsel durch das jeweils frische ersetzt

    r = await api('/api/me/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: 'FALSCH', newPassword: 'neu1234' }) }, token);
    check('Passwort ändern mit falschem alten Passwort -> 401', r.status === 401, r.status);
    r = await api('/api/me/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: 'pass1234', newPassword: 'neu1234' }) }, token);
    check('Passwort ändern', r.status === 200 && r.data.token, r.status);
    const freshToken = r.data.token;
    r = await api('/api/me', {}, token);
    check('Altes Token ist nach Passwortwechsel ungültig', r.status === 401, r.status);
    r = await api('/api/me', {}, freshToken);
    check('Frisches Token aus der Antwort funktioniert', r.status === 200, r.status);
    token = freshToken; // ab hier mit dem gültigen Token weiterarbeiten
    r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: 'neu1234' }) });
    check('Login mit neuem Passwort', r.status === 200 && r.data.mustChangePassword === false, r.status);

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

    console.log('\n[3b] Admin: Sicherungen einsehen & wiederherstellen');
    r = await api('/api/admin/backups', {}, admToken);
    check('Backup-Liste abrufbar', r.status === 200 && Array.isArray(r.data.shared) && Array.isArray(r.data.daily), r.status);
    check('Shared-Historie enthält Stände', r.data.shared.length >= 2, r.data.shared.length);
    check('Tages-Backup gelistet', r.data.daily.length === 1, r.data.daily.length);
    const histFile = r.data.shared[r.data.shared.length - 1].file; // ältester Stand (vor dem Smoke-Eintrag)
    let dl = await fetch(BASE + '/api/admin/backups/shared/' + encodeURIComponent(histFile), { headers: { Authorization: 'Bearer ' + admToken } });
    check('Historie-Stand herunterladbar', dl.status === 200 && (dl.headers.get('content-disposition') || '').includes(histFile));
    r = await api('/api/admin/backups/shared/' + encodeURIComponent(histFile) + '/restore', { method: 'POST' }, admToken);
    check('Wiederherstellen liefert neue rev', r.status === 200 && typeof r.data.rev === 'number', r.status);
    const sharedAfter = (await api('/api/shared')).data;
    check('Wiederhergestellter Stand hat den Smoke-Eintrag nicht mehr', !(sharedAfter.companionDb && sharedAfter.companionDb.Smoke), JSON.stringify(sharedAfter.companionDb || {}).slice(0, 60));
    check('rev zählt nach Wiederherstellung weiter hoch', (sharedAfter.rev || 0) > rev0 + 1, sharedAfter.rev);
    r = await api('/api/admin/backups/shared/..%2F..%2Fusers.json/restore', { method: 'POST' }, admToken);
    check('Pfad-Trickserei beim Wiederherstellen -> 400/404', r.status === 400 || r.status === 404, r.status);
    r = await api('/api/admin/users', {}, admToken);
    check('Benutzerliste enthält updatedAt für Charaktere', r.data.some(u => (u.characters || []).some(c => c.updatedAt)), false);

    console.log('\n[3c] Admin-Reset erzwingt Passwortwechsel');
    r = await api('/api/admin/users/' + encodeURIComponent(user) + '/reset-password', { method: 'POST' }, admToken);
    check('Admin setzt Passwort zurück', r.status === 200, r.status);
    r = await api('/api/me', {}, freshToken);
    check('Auch das frische Token fliegt nach Admin-Reset raus', r.status === 401, r.status);
    r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: '123456789' }) });
    check('Login mit Standardpasswort meldet Wechsel-Pflicht', r.status === 200 && r.data.mustChangePassword === true, JSON.stringify(r.data).slice(0, 60));
    const resetToken = r.data.token;
    r = await api('/api/me/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: '123456789', newPassword: 'neu1234' }) }, resetToken);
    check('Wechsel-Pflicht nach Passwortänderung erledigt', r.status === 200, r.status);
    token = r.data.token; // frisches Token für die folgenden Abschnitte
    r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: 'neu1234' }) });
    check('Flag ist danach wieder aus', r.status === 200 && r.data.mustChangePassword === false, JSON.stringify(r.data).slice(0, 60));

    console.log('\n[3d] Gegner-Profile in den geteilten Presets');
    let curRev = ((await api('/api/shared')).data.rev) || 0;
    r = await api('/api/shared/presets', { method: 'PUT', body: JSON.stringify({ rev: curRev, gegnerProfile: { 'Boss Test': { gegnerDefensive: 75, gegnerDeflect: 50, gegnerDeflectSev: 90, gegnerAwareness: 0, gegnerKritvermeidung: 10, gegnerKraft: 90, gegnerZielgenauigkeit: 0, gegnerKampfvorteil: 90, gegnerKritwert: 50, gegnerKritschaden: 90 } } }) }, token);
    check('Gegner-Profil speicherbar (Moderator-Recht reicht)', r.status === 200, r.status + '/' + JSON.stringify(r.data).slice(0, 60));
    check('Gegner-Profil landet in shared.json', !!((await api('/api/shared')).data.gegnerProfile || {})['Boss Test']);

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
    check('Toast: Statusmeldung wird sichtbar eingeblendet', doc.getElementById('saveStatus').classList.contains('show') || doc.getElementById('saveStatus').textContent === '', undefined);
    // Klassen-Hinweis: Schadensberechnung ohne gewählte Klasse in einer frischen Instanz
    {
      const dg = loadFrontend();
      await wait(1100);
      dg.window.showPage('uebersicht'); await wait(200);
      const t = dg.window.document.getElementById('uebersichtContent').textContent;
      check('Hinweis bei fehlender Klasse auf der Schadensberechnung', t.includes('keine Klasse gewählt'), t.slice(0, 60));
      dg.window.close();
    }
    // Komma-Eingabe: "2,5" in einem %-Feld muss als 2,5 rechnen (nicht 0 oder 25)
    input(win, doc.querySelector('input[data-src="Kopf"][data-stat="kraft"][data-field="prozent"]'), '2,5');
    await wait(200);
    check('Komma-Eingabe "2,5 %" rechnet korrekt (55 -> 57,5)', doc.getElementById('F-kraft').textContent.startsWith('57,5'), doc.getElementById('F-kraft').textContent);
    // Unabhängige Werte-Ampel: Kraft E=110.000 bei Stufe 100.000 = Werte-Cap exakt
    // erreicht (grün), während die Gesamt-% weit unterm Cap liegen (Delta orange)
    {
      const eKraft = doc.getElementById('E-kraft'), dKraft = doc.getElementById('delta-kraft');
      check('Werte-Ampel unabhängig: Werte am Cap (grün), % zu wenig (orange)',
        eKraft.className.includes('delta-ok') && dKraft.className.includes('delta-toolittle'),
        eKraft.className + ' | ' + dKraft.className);
      // Werte weit übers Werte-Cap -> E rot, Delta bleibt orange (genau der Fall
      // "schon zu viele Werte, aber % noch nicht genug")
      input(win, doc.querySelector('input[data-role="H"][data-stat="kraft"]'), '130000'); await wait(200);
      check('Werte-Ampel: zu viele Werte (rot) trotz zu wenig % (orange)',
        doc.getElementById('E-kraft').className.includes('delta-toomuch') && doc.getElementById('delta-kraft').className.includes('delta-toolittle'),
        doc.getElementById('E-kraft').className + ' | ' + doc.getElementById('delta-kraft').className);
      check('Werte-Ampel: Tooltip erklärt die Verschwendung', doc.getElementById('E-kraft').title.includes('Zu viele Werte'));
      input(win, doc.querySelector('input[data-role="H"][data-stat="kraft"]'), '110000'); await wait(200);
    }

    // Buff-Food-Optimierer: klassenbewusst (DPS -> Schaden), Utility bleibt unangetastet
    {
      const fVorher = num(doc.getElementById('F-kraft').textContent);
      win.optimizeBuffFood();
      const gemeldet = await waitForStatus(doc, 'Bestes Buff Food gesetzt');
      check('Optimierer meldet die Auswahl', gemeldet, doc.getElementById('saveStatus').textContent.slice(0, 90));
      const fNachher = num(doc.getElementById('F-kraft').textContent);
      check('Buff-Food-Optimierer erhöht die Kraft-%', fNachher > fVorher, fVorher + ' -> ' + fNachher);
      const utilSelects = Array.from(doc.querySelectorAll('#sourceAccordions select')).filter(sel => {
        const card = sel.closest('.slot-card');
        return card && /Utility/.test(card.textContent);
      });
      check('Utility-Slots bleiben unverändert (Leer)', utilSelects.length === 2 && utilSelects.every(sel => sel.value === 'Leer'), utilSelects.map(sel=>sel.value).join('/'));
      check('DPS: Meldung nennt Gesamtschaden als Ziel', doc.getElementById('saveStatus').textContent.includes('Gesamtschaden (DPS)'), doc.getElementById('saveStatus').textContent.slice(0, 90));
      // Zweiter Lauf: keine weitere Verbesserung -> "bereits die bestmögliche"
      await wait(800); // Meldungs-Timer des ersten Laufs abklingen lassen
      win.optimizeBuffFood();
      check('Zweiter Lauf erkennt: bereits optimal', await waitForStatus(doc, 'bereits die bestmögliche'), doc.getElementById('saveStatus').textContent.slice(0, 90));

      // Klassenbewusst: als Tank optimiert der Knopf auf eHP - erst alle Essen leeren,
      // dann muss er Trefferpunkte-/Defensiv-Essen wählen statt der DPS-Auswahl
      change(win, doc.getElementById('vorbildpfad'), 'Wächter (Tank)'); await wait(150);
      input(win, doc.querySelector('input[data-role="H"][data-stat="trefferpunkte"]'), '500000'); await wait(150);
      ['Buff Food – Event-Food','Buff Food – Hauptgericht','Buff Food – Elixier','Buff Food – Sonderbuff','Buff Food – Gürtel Item'].forEach(k => win.loadFoodPreset(k, 'Leer'));
      await wait(200);
      const tpVorher = num(doc.getElementById('E-trefferpunkte').textContent);
      win.optimizeBuffFood();
      check('Tank: Meldung nennt eHP als Ziel', await waitForStatus(doc, 'eHP (Tank)'), doc.getElementById('saveStatus').textContent.slice(0, 90));
      const tpNachher = num(doc.getElementById('E-trefferpunkte').textContent);
      check('Tank: Optimierer wählt Trefferpunkte-/Defensiv-Essen', tpNachher > tpVorher, tpVorher + ' -> ' + tpNachher);
      // zurück auf DPS für die folgenden Checks
      change(win, doc.getElementById('vorbildpfad'), 'Schwertmeister (DPS)'); await wait(300);
    }
    // Alles auf-/zuklappen
    win.setAllStatSubgroups('stats', true);
    const statGroupsCount = doc.querySelectorAll('#statGroups .stat-subgroup').length;
    check('Alles aufklappen öffnet alle Stat-Gruppen', doc.querySelectorAll('#statGroups .stat-subgroup.open').length === statGroupsCount, doc.querySelectorAll('#statGroups .stat-subgroup.open').length + '/' + statGroupsCount);
    win.setAllStatSubgroups('stats', false);
    check('Alles zuklappen schließt alle Stat-Gruppen', doc.querySelectorAll('#statGroups .stat-subgroup.open').length === 0);
    win.setAllStatSubgroups('sources', true);
    check('Ausrüstung & Boni: alles aufklappbar', doc.querySelectorAll('#sourceAccordions .accordion.open').length === doc.querySelectorAll('#sourceAccordions .accordion').length);
    const guestSaved = win.localStorage.getItem('xselli_guest');
    check('Gast-Daten im Browser gespeichert', !!guestSaved && JSON.parse(guestSaved).grunddaten.itemlevel === 100000, (guestSaved || '').slice(0, 60));

    // "Neuer Besuch": zweite jsdom-Instanz mit denselben localStorage-Daten
    let dom2 = loadFrontend({ xselli_guest: guestSaved });
    await wait(1200);
    check('Gast-Daten beim nächsten Besuch wiederhergestellt', num(dom2.window.document.getElementById('itemlevel').value) === 100000, dom2.window.document.getElementById('itemlevel').value);
    check('Wiederherstellungs-Hinweis sichtbar', dom2.window.document.getElementById('saveStatus').textContent.includes('wiederhergestellt'));
    // Brücke Gast -> Konto: registrieren und die Gast-Eingaben als Vorlage übernehmen
    {
      const w2 = dom2.window, d2 = w2.document;
      w2.openAccountPanel(); await wait(300);
      input(w2, d2.getElementById('acc_username'), 'gastbruecke_' + uniq);
      input(w2, d2.getElementById('acc_password'), 'pass1234');
      await w2.registerAccount(); await wait(600);
      const vorlage = d2.getElementById('acc_copyfrom');
      check('Vorlage-Dropdown bietet Gast-Eingaben an', vorlage && Array.from(vorlage.options).some(o => o.value === '__guest__'));
      input(w2, d2.getElementById('acc_newchar'), 'AusGast_' + uniq);
      vorlage.value = '__guest__';
      await w2.createCharacter(); await wait(800);
      check('Charakter aus Gast-Eingaben übernimmt die Werte', num(d2.getElementById('itemlevel').value) === 100000, d2.getElementById('itemlevel').value);
      const onServer = await api('/api/characters/' + encodeURIComponent('AusGast_' + uniq), {}, (await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'gastbruecke_' + uniq, password: 'pass1234' }) })).data.token);
      check('Gast-Daten liegen auf dem Server', onServer.status === 200 && onServer.data.data.grunddaten.itemlevel === 100000, JSON.stringify(onServer.data && onServer.data.data && onServer.data.data.grunddaten).slice(0, 60));
    }
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
    // Tank VOR Heiler angelegt - die Übersicht muss trotzdem DPS, Heiler, Tank sortieren
    const cT = 'Tank_' + uniq, cH = 'Heil_' + uniq;
    await api('/api/characters', { method: 'POST', body: JSON.stringify({ name: cT }) }, t2);
    await api('/api/characters', { method: 'POST', body: JSON.stringify({ name: cH }) }, t2);
    await api('/api/characters/' + encodeURIComponent(cT), { method: 'PUT', body: JSON.stringify({ grunddaten: { itemlevel: 90000, klasse: 'Kämpfer', vorbildpfad: 'Wächter (Tank)', klassentyp: 'Tank' }, baseInputs: { verteidigung: { H: 150000, I: 100 }, trefferpunkte: { H: 1500000, I: 0 } }, sourceInputs: {} }) }, t2);
    await api('/api/characters/' + encodeURIComponent(cH), { method: 'PUT', body: JSON.stringify({ grunddaten: { itemlevel: 85000, klasse: 'Kleriker', vorbildpfad: 'Geweihter Kleriker (Heiler)', klassentyp: 'Heiler' }, baseInputs: { kraft: { H: 90000, I: 60 } }, sourceInputs: {} }) }, t2);

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

    // Gegner-Profil per Dropdown anwenden ("Boss Test" aus [3d], Defensive 75)
    {
      const sel = doc.querySelector('#acc-dmg-gegner select');
      check('Gegner-Profil-Dropdown vorhanden', !!sel);
      const opt = sel && Array.from(sel.options).find(o => o.textContent === 'Boss Test');
      check('Gepflegtes Profil erscheint im Dropdown', !!opt);
      if(opt){
        change(win, sel, opt.value); await wait(300);
        const defFeld = doc.querySelector('input[data-uparam="gegnerDefensive"]');
        check('Profil setzt die Gegner-Felder (Defensive 75)', defFeld && num(defFeld.value) === 75, defFeld && defFeld.value);
      }
    }

    // Charakter-Übersicht: Unterpunkt des Vergleichs, sortiert nach Klassentyp,
    // klappbare Stat-Gruppen, klassenrelevante Werte hervorgehoben
    {
      await win.loadAlleChars(); await wait(400);
      const ovw = doc.getElementById('acc-dmg-allechars');
      check('Übersicht ist Unterpunkt des Vergleichs', !!ovw && !!ovw.closest('#acc-dmg-vergleich'));
      ovw.classList.add('open');
      check('Übersicht: alle vier Charaktere in der Tabelle', [cA, cB, cT, cH].every(n => ovw.textContent.includes(n)));
      // Sortierung: DPS (A, B), dann Heiler (cH), dann Tank (cT) - obwohl Tank zuerst angelegt wurde
      const headNames = Array.from(ovw.querySelectorAll('thead .ovw-charbtn')).map(b => b.textContent.trim());
      check('Übersicht: sortiert DPS -> Heiler -> Tank', JSON.stringify(headNames) === JSON.stringify([cA, cB, cH, cT]), headNames.join(' | '));
      check('Übersicht: aktueller Charakter als live markiert', ovw.textContent.includes('(aktuell)') && ovw.textContent.includes('jetzt (live)'));
      check('Übersicht: bester Wert gold markiert', ovw.querySelectorAll('.best').length >= 3, ovw.querySelectorAll('.best').length);
      // Kennzahlen-Hervorhebung: Schaden-Zeile tönt die DPS-Spalten, eHP-Zeile die Tank-Spalte
      const rowsEls = Array.from(ovw.querySelectorAll('tbody tr'));
      const rowByLabel = l => rowsEls.find(tr => tr.querySelector('td') && tr.querySelector('td').textContent.trim() === l);
      check('Übersicht: Schaden-Zeile hebt DPS hervor', rowByLabel('Gesamtschaden der Fähigkeit').querySelectorAll('td.relev-dps').length === 2);
      check('Übersicht: eHP-Zeile hebt Tank hervor', rowByLabel('Effektive Trefferpunkte (eHP)').querySelectorAll('td.relev-tank').length === 1);
      check('Übersicht: Heilung-Zeile hebt Heiler hervor', rowByLabel('Heilung der Fähigkeit').querySelectorAll('td.relev-heal').length === 1);
      // Klappbare Gruppen: aktueller Charakter ist DPS -> Offensive offen, Defensive zu
      const off = doc.getElementById('srcgrp-ovw-offensive'), def = doc.getElementById('srcgrp-ovw-defensive');
      check('Übersicht: Offensive standardmäßig offen (DPS geladen)', off && off.classList.contains('open'));
      check('Übersicht: Defensive standardmäßig zu', def && !def.classList.contains('open'));
      win.toggleSrcSubgroup('ovw', 'defensive');
      check('Übersicht: Defensive aufklappbar', def.classList.contains('open'));
      check('Übersicht: Defensive-Stats heben Tank hervor', def.querySelectorAll('td.relev-tank').length >= 5, def.querySelectorAll('td.relev-tank').length);
      check('Übersicht: Offensive-Stats heben DPS und Heiler hervor', off.querySelectorAll('td.relev-dps').length >= 10 && off.querySelectorAll('td.relev-heal').length >= 5);
      // Klick auf B-Spaltenkopf -> Vergleich B = cB (B ist die zweite DPS-Spalte)
      const btns = ovw.querySelectorAll('.ovw-charbtn');
      btns[1].click(); await wait(700);
      const selBAfter = doc.querySelector('select[data-vgl="b"]');
      const chosen = Array.from(selBAfter.options).find(o => o.selected);
      check('Übersicht: Klick übernimmt Charakter in den Vergleich', chosen && chosen.textContent.includes('Beta_'), chosen && chosen.textContent);
      // Aufgeklappter Zustand überlebt den Rebuild durch die Vergleichsauswahl
      const defNeu = doc.getElementById('srcgrp-ovw-defensive');
      check('Übersicht: Aufklapp-Zustand überlebt Neuaufbau', defNeu && defNeu.classList.contains('open'));
    }

    // Snapshot ("Vorher/Nachher"): Stand einfrieren, Kraft erhöhen, Unterschied sichtbar
    win.freezeVergleichSnapshot(); await wait(300);
    const selA2 = doc.querySelector('select[data-vgl="a"]');
    check('Snapshot: Auswahl steht auf Eingefroren vs. Aktuell', selA2 && selA2.value === '__snapshot__' && doc.querySelector('select[data-vgl="b"]').value === '__current__');
    win.showPage('rechner'); await wait(200);
    input(win, doc.querySelector('input[data-role="I"][data-stat="kraft"]'), '100'); await wait(200);
    win.showPage('uebersicht'); await wait(300);
    const accSnap = doc.getElementById('acc-dmg-vergleich');
    accSnap.classList.add('open');
    const snapRows = Array.from(accSnap.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()));
    const snapGesamt = snapRows.find(r => r[0] === 'Gesamt');
    check('Snapshot: Vorher/Nachher zeigt den Zugewinn', snapGesamt && snapGesamt[5].includes('+'), snapGesamt && snapGesamt[5]);

    console.log('\n[8] Passwort-ändern-Formular + Formel-Vorschau');
    win.openAccountPanel(); await wait(400);
    check('Passwort-Bereich standardmäßig versteckt', doc.getElementById('pwChangeArea').style.display === 'none');
    win.togglePwChange();
    check('Passwort-Bereich per Knopf einblendbar', doc.getElementById('pwChangeArea').style.display !== 'none');
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
    // Login per Enter-Taste statt Knopf
    doc.getElementById('acc_password').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(800);
    check('Login per Enter-Taste', doc.getElementById('accountLabel').textContent.includes(user), doc.getElementById('accountLabel').textContent);
    win.closeAccountModal();
    win.showPage('formeln'); await wait(300);
    const preview = doc.getElementById('formelPreview');
    check('Formel-Vorschau rechnet', preview && preview.textContent.includes('Totale Werte') && preview.textContent.includes('105'), preview && preview.textContent.slice(0, 60));
    input(win, doc.getElementById('f_eTotal'), 'H + kaputt(');
    await wait(150);
    check('Formel-Vorschau zeigt Fehler an', doc.getElementById('formelPreview').textContent.includes('Fehler'));
    check('Ungespeichert-Markierung am Speichern-Knopf', doc.getElementById('btnSaveFormeln').textContent.includes('*'), doc.getElementById('btnSaveFormeln').textContent);
    let confirmAsked = false;
    win.confirm = () => { confirmAsked = true; return true; };
    win.showPage('rechner'); await wait(100);
    check('Nachfrage beim Verlassen mit ungespeicherten Formeln', confirmAsked);
    check('Versions-Link "Was ist neu?"', doc.getElementById('versionTag').innerHTML.includes('commits/main'));

    console.log('\n[9] Gruppenplaner + Insignienrechner (vorerst nur ab Moderator sichtbar)');
    // "user" ist an dieser Stelle bereits coadmin (Abschnitt 8) - reicht für GP_MIN_ROLE='moderator'.
    check('App-Switcher zeigt Gruppenplaner/Insignien', doc.getElementById('apptab-gruppenplaner').style.display !== 'none' && doc.getElementById('apptab-insignien').style.display !== 'none');

    r = await api('/api/gp/characters', { method: 'POST', body: JSON.stringify({ name: 'TankMax' }) }, token);
    check('GP-Charakter anlegen (eigener Datentopf)', r.status === 201, r.status);
    r = await api('/api/gp/characters/TankMax', { method: 'PUT', body: JSON.stringify({
      klasse: 'Kämpfer', rollen: { dps: false, heal: false, tank: true }, besitz: { mounts: ['Pegasus'], mountBonus: ['Mystische Aura'], gefaehrten: ['Skorpion'] },
    }) }, token);
    check('GP-Charakter speichern', r.status === 200, r.status);

    r = await api('/api/gp/plans', { method: 'POST', body: JSON.stringify({ name: 'Trial Sonntag' }) }, token);
    check('GP-Plan mit Leerzeichen im Namen anlegen', r.status === 201, r.status);
    r = await api('/api/gp/plans/' + encodeURIComponent('Trial Sonntag'), { method: 'PUT', body: JSON.stringify({ groups: [{ name: 'Gruppe 1', trial: true, showAusruestung: false,
      rows: [{ rolle: 'Tank', charKey: user + '::TankMax', party: 'A', artefakt: '', mount: 'Pegasus', mountBonus: 'Mystische Aura', gefaehrte: '', gefaehrtenBonus: '' }] }] }) }, token);
    check('GP-Plan speichern', r.status === 200, r.status);
    r = await api('/api/gp/plans', {}, token);
    check('Plan-Liste zeigt den vollen Namen (kein Unterstrich statt Leerzeichen)', r.data.some(p => p.name === 'Trial Sonntag'), JSON.stringify(r.data));

    win.showApp('gruppenplaner'); await wait(700);
    win.showGpPage('planung'); await wait(500);
    await win.gpOpenPlan('Trial Sonntag');
    await wait(300);
    const gpBoard = doc.getElementById('gpPlanBoard');
    const groupNameInput = gpBoard.querySelector('input.entry-name');
    check('Board lädt die gespeicherte Gruppe (Trial -> Party-Spalte da)', groupNameInput && groupNameInput.value === 'Gruppe 1' && gpBoard.textContent.includes('Party'), groupNameInput && groupNameInput.value);
    const charSelectGp = gpBoard.querySelector('tbody select');
    check('Zugewiesener Charakter ist im Board vorausgewählt', charSelectGp && charSelectGp.value === user + '::TankMax', charSelectGp && charSelectGp.value);
    const mountSelectGp = Array.from(gpBoard.querySelectorAll('tbody select')).find(sel => Array.from(sel.options).some(o => o.value === 'Pegasus'));
    check('Mount-Dropdown ist auf Besitz gefiltert (nur Pegasus + Leer)', mountSelectGp && mountSelectGp.options.length === 2, mountSelectGp && Array.from(mountSelectGp.options).map(o => o.value));

    win.showApp('insignien'); await wait(300);
    const insStart = doc.getElementById('insStart'), insZiel = doc.getElementById('insZiel'), insMenge = doc.getElementById('insMenge');
    insStart.value = 'Blau'; insStart.dispatchEvent(new win.Event('change', { bubbles: true }));
    insZiel.value = 'legendär'; insZiel.dispatchEvent(new win.Event('change', { bubbles: true }));
    insMenge.value = '2'; insMenge.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(150);
    // Blau->episch->legendär: 250 * 10 = 2500 pro legendär, ×2 Menge = 5000 benötigte blaue Insignien
    check('Insignienrechner: Kette über zwei Zwischenstufen korrekt (5.000)', doc.getElementById('insignienContent').textContent.includes('5.000'), doc.getElementById('insignienContent').textContent.slice(0, 200));
    // Referenz-Szenario (vom Nutzer per Screenshot bestätigt): mystisch -> celestisch, Menge 1
    // -> 2 benötigte mystische Insignien, 2.300.000 Hochstufen vs. 2.499.999 Direktkauf (AH-Preis
    // celestisch 2.000.000 UND Direktkaufpreis 2.499.999 sind bewusst zwei getrennte Zahlen).
    insStart.value = 'mystisch'; insStart.dispatchEvent(new win.Event('change', { bubbles: true }));
    insZiel.value = 'celestisch'; insZiel.dispatchEvent(new win.Event('change', { bubbles: true }));
    insMenge.value = '1'; insMenge.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(150);
    const insRefText = doc.getElementById('insignienContent').textContent;
    check('Insignienrechner: Referenz-Szenario Hochstufen 2.300.000', insRefText.includes('2.300.000'), insRefText.slice(0, 300));
    check('Insignienrechner: Referenz-Szenario Direktkauf 2.499.999 (getrennt vom AH-Preis)', insRefText.includes('2.499.999'), insRefText.slice(0, 300));
    const ahInput = doc.querySelector('input[data-insprice="celestisch"][data-field="ah"]');
    const direktInput = doc.querySelector('input[data-insprice="celestisch"][data-field="direkt"]');
    check('Insignienrechner: AH-Preis und Direktkaufpreis sind unabhängige Felder', ahInput && direktInput && ahInput.value !== direktInput.value, ahInput && direktInput && [ahInput.value, direktInput.value]);

    // Pulver-Bedarf über eine mehrstufige Kette (grün -> legendär, Menge 1):
    // 15.625.000 grün benötigt, die verwertet exakt das Pulver für die ganze Kette
    // liefern (2 Pulver/grün -> 31.250.000). Ohne vorhandenes Pulver muss die
    // "noch nötige Insignien"-Anzeige exakt der "Benötigte Insignien"-Zahl entsprechen.
    insStart.value = 'grün'; insStart.dispatchEvent(new win.Event('change', { bubbles: true }));
    insZiel.value = 'legendär'; insZiel.dispatchEvent(new win.Event('change', { bubbles: true }));
    insMenge.value = '1'; insMenge.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(150);
    let pulverText = doc.getElementById('insignienContent').textContent;
    check('Pulver-Bedarf (Kette grün->legendär) korrekt: 31.250.000', pulverText.includes('31.250.000'), pulverText.slice(0, 400));
    check('Ohne vorhandenes Pulver: "weitere Insignien" = volle Menge (15.625.000)', pulverText.includes('≈ 15.625.000 weitere grün-Insignien'), pulverText.slice(0, 400));
    const insPulverInput = doc.getElementById('insPulver');
    insPulverInput.value = '1000000'; insPulverInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(150);
    pulverText = doc.getElementById('insignienContent').textContent;
    // 1.000.000 Pulver / 2 (Ertrag grün) = 500.000 weniger grün nötig -> 15.125.000
    check('Vorhandenes Pulver reduziert den Bedarf korrekt (15.125.000)', pulverText.includes('15.125.000'), pulverText.slice(0, 400));
    insPulverInput.value = '999999999'; insPulverInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(150);
    check('Mehr als genug Pulver: Hinweis statt negativer Zahl', doc.getElementById('insignienContent').textContent.includes('genug Pulver vorhanden'));

    win.showApp('stats'); await wait(200);
    check('Zurück zum Statrechner funktioniert', doc.getElementById('appStats').style.display !== 'none');

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
