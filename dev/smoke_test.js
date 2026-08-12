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
    check('App-Switcher (Dropdown) zeigt Gruppenplaner/Insignien-Optionen', Array.from(doc.getElementById('appSelect').options).map(o=>o.value).join(',') === 'stats,gruppenplaner,insignien', Array.from(doc.getElementById('appSelect').options).map(o=>o.value));

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
    check('Gruppenplaner: eigener Titel/Untertitel', doc.getElementById('mainTitle').textContent === 'Gruppenplaner' && !doc.getElementById('mainSubtitle').textContent.includes('grün markierten Feldern'));

    // "Meine Charaktere": über die ECHTEN Buttons bedienen (nicht die JS-Funktionen
    // direkt aufrufen) - deckt Bugs im onclick-HTML ab, die ein direkter Funktions-
    // aufruf nicht sehen würde (genau das ist beim Bearbeiten-Button und beim
    // Besitz-Akkordeon passiert: kaputtes onclick durch nicht escapte Anführungszeichen
    // bzw. eine falsche Element-ID - beides fiel erst durch echte Klicks auf).
    win.showGpPage('charaktere'); await wait(300);
    doc.getElementById('gpNewCharName').value = 'CharA'; win.gpCreateCharacter(); await wait(600);
    doc.getElementById('gpNewCharName').value = 'CharB'; win.gpCreateCharacter(); await wait(600);
    const bearbeitenBtnFuer = name => Array.from(doc.querySelectorAll('#gpCharList .char-item'))
      .find(item => item.textContent.includes(name))
      ?.querySelector('button');
    const btnCharA = bearbeitenBtnFuer('CharA'), btnCharB = bearbeitenBtnFuer('CharB');
    check('Meine Charaktere: Bearbeiten-Buttons für CharA und CharB vorhanden', !!btnCharA && !!btnCharB);
    btnCharA.click(); await wait(200);
    check('Bearbeiten-Button (echter Klick) öffnet den richtigen Charakter (CharA)', doc.querySelector('#gpCharEditor h2').textContent.includes('CharA'), doc.querySelector('#gpCharEditor h2').textContent);
    btnCharB.click(); await wait(200);
    check('Bearbeiten-Button wechselt beim zweiten Klick korrekt zu CharB', doc.querySelector('#gpCharEditor h2').textContent.includes('CharB'), doc.querySelector('#gpCharEditor h2').textContent);
    const gpAccBtn = doc.querySelector('#gpCharEditor .accordion button');
    const gpAccDiv = gpAccBtn.closest('.accordion');
    check('Besitz-Akkordeon ist zunächst zu', !gpAccDiv.classList.contains('open'));
    gpAccBtn.click(); await wait(100);
    check('Besitz-Akkordeon lässt sich per Klick öffnen (Artefakte-Liste)', gpAccDiv.classList.contains('open'));

    // Seit v0.24.0 (Nutzerwunsch "@handle im Charakter-Editor ändern können"):
    // eigenes Eingabefeld für den Ingame-Handle, unabhängig vom Website-Login.
    const gpEditHandleInput = doc.getElementById('gpEditHandle');
    check('Charakter-Editor hat ein Ingame-Handle-Feld', !!gpEditHandleInput);
    if(gpEditHandleInput){
      input(win, gpEditHandleInput, 'charb_handle');
      await win.gpSaveCharEditor(); await wait(300);
      const charBNachHandle = (await api('/api/gp/characters', {}, token)).data.find(c => c.name === `CharB@${user}`);
      check('Ingame-Handle wird über den Editor gespeichert', charBNachHandle && charBNachHandle.data && charBNachHandle.data.handle === 'charb_handle', charBNachHandle);
      const charBDatalistOption = doc.querySelector('#gpCharList').textContent; // Liste neu geladen durch gpSaveCharEditor -> renderGpCharList
      check('"Meine Charaktere"-Liste zeigt den Handle mit an', doc.getElementById('gpCharList').textContent.includes('@charb_handle'), doc.getElementById('gpCharList').textContent);
    }

    // Seit v0.25.0 (Nutzerwunsch "Charakternamen auch nachträglich ändern
    // können"): Umbenennen-Button pro Charakter im "Meine Charaktere"-Bereich,
    // analog zum bestehenden Plan-Umbenennen.
    const charBItem = Array.from(doc.querySelectorAll('#gpCharList .char-item')).find(item => item.textContent.includes('CharB'));
    const umbenennenCharBtn = charBItem && Array.from(charBItem.querySelectorAll('button')).find(b => b.textContent.trim() === 'Umbenennen');
    check('"Umbenennen"-Knopf pro Charakter vorhanden', !!umbenennenCharBtn);
    win.prompt = () => 'CharB_Renamed';
    if(umbenennenCharBtn){ umbenennenCharBtn.click(); await wait(400); }
    r = await api('/api/gp/characters', {}, token);
    check('Charakter wurde über den Button umbenannt', r.data.some(c => c.name === `CharB_Renamed@${user}`) && !r.data.some(c => c.name === `CharB@${user}`), JSON.stringify(r.data.map(c=>c.name)));
    const charBRenamedRec = r.data.find(c => c.name === `CharB_Renamed@${user}`);
    check('Umbenennen behält die restlichen Daten (Ingame-Handle) bei', charBRenamedRec && charBRenamedRec.data && charBRenamedRec.data.handle === 'charb_handle', charBRenamedRec);
    check('"Meine Charaktere"-Liste zeigt den neuen Kurznamen', doc.getElementById('gpCharList').textContent.includes('CharB_Renamed') && !doc.getElementById('gpCharList').textContent.includes(`CharB_Renamed@${user}`), doc.getElementById('gpCharList').textContent);

    // Umbenennen zieht bestehende Gruppenplaner-Zuweisungen (charKey =
    // "Account::Charname") in ALLEN Plänen nach - eigener, isolierter
    // Wegwerf-Charakter/-Plan statt TankMax wiederzuverwenden, damit die
    // vielen späteren TankMax-Tests unangetastet bleiben.
    r = await api('/api/gp/characters', { method: 'POST', body: JSON.stringify({ name: 'RenameTestChar' }) }, token);
    check('Umbenennen-Test: Wegwerf-Charakter angelegt', r.status === 201, r.status);
    r = await api('/api/gp/plans', { method: 'POST', body: JSON.stringify({ name: 'Umbenennen-Testplan' }) }, token);
    check('Umbenennen-Test: Wegwerf-Plan angelegt', r.status === 201, r.status);
    r = await api('/api/gp/plans/' + encodeURIComponent('Umbenennen-Testplan'), { method: 'PUT', body: JSON.stringify({ groups: [{ name: 'G', modus: 'dungeon',
      rows: [{ rolle: 'Tank', charKey: user + '::RenameTestChar', artefakt: '', mount: '', mountBonus: '', gefaehrte: '', gefaehrtenBonus: '' }] }] }) }, token);
    check('Umbenennen-Test: Charakter im Wegwerf-Plan zugewiesen', r.status === 200, r.status);
    r = await api('/api/gp/characters/RenameTestChar/rename', { method: 'POST', body: JSON.stringify({ newName: 'RenameTestChar2' }) }, token);
    check('Umbenennen-Test: Rename-Endpunkt liefert Erfolg', r.status === 200 && r.data.name === 'RenameTestChar2', r.status + '/' + JSON.stringify(r.data));
    r = await api('/api/gp/plans/' + encodeURIComponent('Umbenennen-Testplan'), {}, token);
    check('Umbenennen-Test: charKey im Plan wurde automatisch auf den neuen Namen nachgezogen', r.data.data.groups[0].rows[0].charKey === user + '::RenameTestChar2', r.data.data.groups[0].rows[0].charKey);
    await api('/api/gp/plans/' + encodeURIComponent('Umbenennen-Testplan'), { method: 'DELETE' }, token);
    await api('/api/gp/characters/RenameTestChar2', { method: 'DELETE' }, token);

    // Seit v0.19.0: der gespeicherte Charaktername ist "Charname@Accountname" (schützt
    // vor Verwechslung bei gleichnamigen Charakteren verschiedener Accounts), die
    // eigene Liste zeigt zur Lesbarkeit aber nur den Kurznamen (gpOwnDisplayName).
    r = await api('/api/gp/characters', {}, token);
    check('Neu angelegter GP-Charakter heißt "Charname@Accountname"', r.data.some(c => c.name === `CharA@${user}`), JSON.stringify(r.data.map(c => c.name)));
    check('"Meine Charaktere"-Liste zeigt den Kurznamen ohne @Account', !doc.getElementById('gpCharList').textContent.includes(`CharA@${user}`) && doc.getElementById('gpCharList').textContent.includes('CharA'));

    // Referenzlisten: kompakte <table> statt einer Karte pro Eintrag (Nutzerwunsch
    // "platzsparender"), inkl. Icon-Spalte je Eintrag - Icon wird mitgespeichert und
    // taucht in der Besitz-Checkliste des Charakter-Editors als <img> auf.
    win.showGpPage('referenz'); await wait(300);
    const refTable = doc.getElementById('gpref-gpArtefakte');
    check('Referenzlisten: Artefakte als <table> mit Icon-Spalte', !!refTable && refTable.tagName === 'TABLE' && !!refTable.querySelector('input[data-field="icon"]'));
    // Seit v0.21.0: Gefährten/Gefährten-Verstärkung haben jetzt auch ein
    // numerisches Dmg-Buff-Feld (vorher nur Freitext-Beschreibung) - Voraus-
    // setzung für den weiter unten getesteten Gruppen-Optimierer.
    const refGefaehrtenTable = doc.getElementById('gpref-gpGefaehrten');
    check('Referenzlisten: Gefährten haben jetzt ein numerisches Dmg-Buff-Feld', !!refGefaehrtenTable && !!refGefaehrtenTable.querySelector('input[data-field="buff"]'));
    const refGefaehrtenVerstTable = doc.getElementById('gpref-gpGefaehrtenVerstaerkung');
    check('Referenzlisten: Gefährten-Verstärkung hat jetzt ein numerisches Dmg-Buff-Feld', !!refGefaehrtenVerstTable && !!refGefaehrtenVerstTable.querySelector('input[data-field="buff"]'));
    const refNameInput = refTable.querySelector('tbody tr input[data-field="name"]');
    const refIconInput = refTable.querySelector('tbody tr input[data-field="icon"]');
    input(win, refNameInput, 'Icon-Test-Artefakt');
    input(win, refIconInput, 'https://example.invalid/icon.png');
    await win.gpSaveReferenzlisten(); await wait(300);
    const sharedNachIcon = (await api('/api/shared')).data;
    const gespeichertesArtefakt = (sharedNachIcon.gpArtefakte || []).find(e => e.name === 'Icon-Test-Artefakt');
    check('Referenzlisten: Icon-URL wird mit dem Eintrag gespeichert', gespeichertesArtefakt && gespeichertesArtefakt.icon === 'https://example.invalid/icon.png', gespeichertesArtefakt);

    // Seit v0.20.0 (Nutzerwunsch "Icon direkt reinladen statt URL eintippen"):
    // das Icon-Feld ist ein Datei-Upload (input type=file), das Textfeld ist nur
    // noch ein verstecktes Trägerfeld für den erzeugten data:URL-String. Der
    // eigentliche Bild-Resize-Pfad (FileReader/Image/canvas) lässt sich in jsdom
    // nicht sauber simulieren - hier wird nur die Feldstruktur und der
    // "Icon entfernen"-Knopf geprüft, das Speichern des Ergebnisses deckt der
    // Test oben (identisches Feld, ob URL oder data:URL) bereits ab.
    const refFileInput = refTable.querySelector('tbody tr input[type="file"]');
    check('Referenzlisten: Icon-Feld ist ein Datei-Upload (kein Text-URL-Feld mehr)', !!refFileInput && refIconInput.type === 'hidden');
    const refClearBtn = Array.from(refTable.querySelectorAll('tbody tr:first-child button')).find(b => b.title === 'Icon entfernen');
    check('Referenzlisten: "Icon entfernen"-Knopf vorhanden', !!refClearBtn);
    refClearBtn.click();
    check('Referenzlisten: "Icon entfernen" leert das Feld', refIconInput.value === '');

    win.showGpPage('charaktere'); await wait(300);
    btnCharA.click(); await wait(200);
    const gpAccBtn2 = doc.querySelector('#gpCharEditor .accordion button');
    gpAccBtn2.click(); await wait(100);
    const besitzChip = Array.from(doc.querySelectorAll('#gpCharEditor .besitz-chip')).find(c => c.textContent.includes('Icon-Test-Artefakt'));
    check('Besitz-Checkliste zeigt das Icon des Referenzeintrags als <img>', !!besitzChip && !!besitzChip.querySelector('img'), besitzChip && besitzChip.innerHTML);

    win.showGpPage('planung'); await wait(500);
    const oeffnenBtn = Array.from(doc.querySelectorAll('#gpPlanList button')).find(b => b.textContent.trim() === 'Öffnen');
    check('Plan-Liste: "Öffnen"-Button vorhanden', !!oeffnenBtn);
    if(oeffnenBtn) oeffnenBtn.click();
    await wait(400);
    const gpBoard = doc.getElementById('gpPlanBoard');
    const groupNameInput = gpBoard.querySelector('input.entry-name');
    check('Board lädt die gespeicherte Gruppe (Trial -> Party-Spalte da)', groupNameInput && groupNameInput.value === 'Gruppe 1' && gpBoard.textContent.includes('Party'), groupNameInput && groupNameInput.value);
    // Rolle ist ein <select>, der Spieler jetzt ein Text-Kombifeld (input+datalist)
    // statt eines separaten Dropdowns - so lässt sich direkt reintippen.
    const ersteZeileSelects = gpBoard.querySelectorAll('tbody tr:first-child select');
    check('Rolle-Dropdown ist vorhanden und steht auf Tank', ersteZeileSelects[0] && ersteZeileSelects[0].value === 'Tank', ersteZeileSelects[0] && ersteZeileSelects[0].value);
    const spielerInputGp = gpBoard.querySelector('tbody tr:first-child input[list="gpCharDatalist"]');
    check('Zugewiesener Charakter ist im Board vorausgewählt', spielerInputGp && spielerInputGp.value === `TankMax (${user})`, spielerInputGp && spielerInputGp.value);
    check('Datalist bietet den Charakter als Vorschlag an', !!doc.querySelector(`#gpCharDatalist option[value="TankMax (${user})"]`));
    const mountSelectGp = Array.from(gpBoard.querySelectorAll('tbody select')).find(sel => Array.from(sel.options).some(o => o.value === 'Pegasus'));
    check('Mount-Dropdown ist auf Besitz gefiltert (nur Pegasus + Leer)', mountSelectGp && mountSelectGp.options.length === 2, mountSelectGp && Array.from(mountSelectGp.options).map(o => o.value));
    // Seit v0.22.1 (Nutzerwunsch): der Dmg-Buff-Wert steht schon im
    // Options-Text selbst (nicht erst als Badge nach der Auswahl) - der
    // "value" bleibt der reine Name, nur der sichtbare Text bekommt "(X %)".
    const pegasusOption = mountSelectGp && Array.from(mountSelectGp.options).find(o => o.value === 'Pegasus');
    check('Dropdown-Option zeigt den Dmg-Buff-Wert direkt im Text an', pegasusOption && pegasusOption.textContent.includes('Pegasus') && pegasusOption.textContent.includes('7,89 %'), pegasusOption && pegasusOption.textContent);

    // Seit v0.22.2 (Nutzerwunsch: Wert stand doppelt da, im Select-Text UND im
    // Badge): das Badge zeigt jetzt NUR noch das Icon, keinen Text mehr - der
    // %-Wert steht seit v0.22.1 bereits im Options-Text (s. o.). Pegasus hat in
    // den Default-Referenzdaten kein Icon hinterlegt, das Badge bleibt für ihn
    // also leer. Seit v0.24.0 sitzt ein evtl. Icon ohnehin IM Select
    // (.gp-field-icon, s. u.) statt als eigenständiges .dmgbuff-badge daneben -
    // dieser Selektor findet also für den Mount ohnehin nichts mehr.
    const mountBadge = mountSelectGp.parentElement.querySelector('.dmgbuff-badge');
    check('Icon-loses Badge bleibt leer (kein doppelter %-Text mehr)', !mountBadge, mountBadge && mountBadge.outerHTML);
    // Seit v0.24.0 (Nutzerwunsch "Icon im Textfeld statt daneben, größer"):
    // Mount ohne Icon (Pegasus) bekommt kein .gp-field-icon und keine
    // .gp-has-icon-Klasse (kein unnötiges Innenpolster ohne Icon).
    check('Select ohne Icon bekommt keine gp-has-icon-Klasse', !mountSelectGp.classList.contains('gp-has-icon'), mountSelectGp.className);
    check('Icon-Wrapper sitzt direkt um das Select (kein Icon daneben)', mountSelectGp.closest('.gp-select-icon-wrap') && !mountSelectGp.closest('.gp-select-icon-wrap').querySelector('.dmgbuff-badge'));
    // (Nicht gpBoard.querySelector('.entry-head') - das trifft zuerst den
    // Plan-Titel-Header, nicht den Gruppen-Header; groupNameInput sitzt bereits
    // im richtigen .entry-head der Gruppenkarte.)
    check('Gruppen-Header zeigt eine Σ-Dmg-Buff-Summe', groupNameInput.closest('.entry-head').textContent.includes('Σ Dmg-Buff'));

    // Rolle einer bestehenden Zeile nachträglich ändern (DPS -> Heiler), ohne die
    // Zeile zu löschen und neu anzulegen.
    win.gpAddRow(0, 'DPS'); await wait(100);
    let gpRows = doc.querySelectorAll('#gpPlanBoard tbody tr');
    const neueZeileIdx = gpRows.length - 1;
    const rolleSelectNeu = gpRows[neueZeileIdx].querySelector('select');
    check('Neue Zeile hat Rolle DPS', rolleSelectNeu.value === 'DPS');
    win.gpUpdateRowRolle(0, neueZeileIdx, 'Heiler'); await wait(100);
    gpRows = doc.querySelectorAll('#gpPlanBoard tbody tr');
    check('Rolle einer Zeile lässt sich nachträglich auf Heiler ändern', gpRows[neueZeileIdx].querySelector('select').value === 'Heiler', gpRows[neueZeileIdx].querySelector('select').value);

    // Freier Name (Mitspieler ohne eigenes Konto/Profil): einfach einen Namen ins
    // SELBE Spieler-Feld eintippen, der zu keinem registrierten Charakter passt -
    // kein separates Fenster/Feld nötig (Nutzerwunsch "platzsparend").
    const freierNameInput = gpRows[neueZeileIdx].querySelector('input[list="gpCharDatalist"]');
    check('Spieler-Feld ist ein einzelnes Kombifeld (kein extra Fenster)', !!freierNameInput);
    if(freierNameInput){
      freierNameInput.value = 'Gast Mira';
      freierNameInput.dispatchEvent(new win.Event('input', { bubbles: true }));
      await wait(50);
      check('Tippen allein ändert noch nichts an der Zuweisung (kein Re-Render mitten im Tippen)', freierNameInput.value === 'Gast Mira');
      freierNameInput.dispatchEvent(new win.Event('change', { bubbles: true }));
      await wait(100);
      gpRows = doc.querySelectorAll('#gpPlanBoard tbody tr');
      const freierNameInputNeu = gpRows[neueZeileIdx].querySelector('input[list="gpCharDatalist"]');
      check('Name ohne Treffer in der Datalist wird als freier Name übernommen', freierNameInputNeu && freierNameInputNeu.value === 'Gast Mira', freierNameInputNeu && freierNameInputNeu.value);
      // Jetzt exakt einen bekannten Charakter-Namen eintragen -> muss sich verknüpfen
      // (Besitz-Dropdowns filtern sich danach auf dessen Besitzliste statt der vollen Liste).
      // Seit v0.24.0 (Rollen-Passung): TankMax ist nur als Tank markiert (s. Anlage
      // weiter oben) - die Zeile muss also erst auf Tank umgestellt werden, sonst
      // lehnt gpResolveRowSpieler die Zuweisung ab.
      win.gpUpdateRowRolle(0, neueZeileIdx, 'Tank'); await wait(50);
      freierNameInputNeu.value = `TankMax (${user})`;
      freierNameInputNeu.dispatchEvent(new win.Event('change', { bubbles: true }));
      await wait(100);
      const mountSelectNeu = Array.from(doc.querySelectorAll('#gpPlanBoard tbody tr')[neueZeileIdx].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Pegasus'));
      check('Exakter Treffer verknüpft den registrierten Charakter (Besitz-Filter greift)', mountSelectNeu && mountSelectNeu.options.length === 2, mountSelectNeu && Array.from(mountSelectNeu.options).map(o=>o.value));
    }

    // Rollen-Passung (seit v0.24.0, Nutzervorgabe "Charaktere nur wo sie hinpassen"):
    // TankMax ist NICHT als Heiler markiert - die Zuweisung auf eine Heiler-Zeile
    // muss abgelehnt werden (alert + Feld bleibt unverändert).
    win.gpAddRow(0, 'Heiler'); await wait(100);
    gpRows = doc.querySelectorAll('#gpPlanBoard tbody tr');
    const heilerZeileIdx = gpRows.length - 1;
    const heilerSpielerFeld = gpRows[heilerZeileIdx].querySelector('input[list="gpCharDatalist"]');
    let alertMsg = '';
    win.alert = m => { alertMsg = m; };
    heilerSpielerFeld.value = `TankMax (${user})`;
    heilerSpielerFeld.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(100);
    const heilerZeileNach = doc.querySelectorAll('#gpPlanBoard tbody tr')[heilerZeileIdx];
    const heilerSpielerFeldNach = heilerZeileNach.querySelector('input[list="gpCharDatalist"]');
    check('Rollen-Passung: TankMax (nur Tank) wird auf Heiler-Slot abgelehnt', alertMsg.includes('nicht als Heiler markiert') && heilerSpielerFeldNach.value !== `TankMax (${user})`, { alertMsg, wert: heilerSpielerFeldNach.value });
    win.gpRemoveRow(0, heilerZeileIdx); await wait(100); // aufräumen

    // Doppelte Spieler-Zuweisung wird optisch markiert: TankMax jetzt ZUSAETZLICH
    // in eine zweite (ebenfalls Tank-)Zeile eintragen -> beide Zeilen sollten die
    // Warnung zeigen.
    win.gpAddRow(0, 'Tank'); await wait(100);
    gpRows = doc.querySelectorAll('#gpPlanBoard tbody tr');
    const zweiteHealerZeileIdx = gpRows.length - 1;
    const zweitesSpielerFeld = gpRows[zweiteHealerZeileIdx].querySelector('input[list="gpCharDatalist"]');
    zweitesSpielerFeld.value = `TankMax (${user})`;
    zweitesSpielerFeld.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(150);
    gpRows = doc.querySelectorAll('#gpPlanBoard tbody tr');
    const spielerFelder = Array.from(gpRows).map(tr => tr.querySelector('input[list="gpCharDatalist"]')).filter(Boolean);
    const doppelteMarkiert = spielerFelder.filter(inp => inp.value === `TankMax (${user})` && (inp.getAttribute('style')||'').includes('var(--off)'));
    check('Doppelte Spieler-Zuweisung wird optisch markiert (mind. zwei Zeilen)', doppelteMarkiert.length >= 2, spielerFelder.map(i=>[i.value, i.getAttribute('style')]));
    win.gpRemoveRow(0, zweiteHealerZeileIdx); await wait(100); // aufräumen für die folgenden Checks

    // ------------------------------------------------------------------
    // Seit v0.24.0: Ingame-Handle (frei editierbar, wird bei Anzeige und bei
    // der Mehrfachbelegungs-Prüfung statt des Website-Accountnamens
    // verwendet), Rollen-Passung (Ablehnung s. o.) und "Ausrüstung bleibt
    // beim Charakterwechsel erhalten, fehlender Besitz wird rot markiert
    // statt automatisch geleert zu werden" (Nutzervorgabe).
    // ------------------------------------------------------------------
    r = await api('/api/gp/characters/TankMax', { method: 'PUT', body: JSON.stringify({
      klasse: 'Kämpfer', handle: 'sharedhandle', rollen: { dps: false, heal: false, tank: true }, besitz: { mounts: ['Pegasus'], mountBonus: ['Mystische Aura'], gefaehrten: ['Skorpion'] },
    }) }, token);
    check('Handle-Test: TankMax bekommt einen Ingame-Handle gesetzt', r.status === 200, r.status);
    r = await api('/api/gp/characters', { method: 'POST', body: JSON.stringify({ name: 'TankMax2' }) }, token);
    check('Handle-Test: zweiter Charakter "TankMax2" angelegt', r.status === 201, r.status);
    r = await api('/api/gp/characters/TankMax2', { method: 'PUT', body: JSON.stringify({
      klasse: 'Kämpfer', handle: 'sharedhandle', rollen: { dps: false, heal: false, tank: true }, besitz: { mounts: ['Zauberkessel der Vettel'] },
    }) }, token);
    check('Handle-Test: TankMax2 bekommt DENSELBEN Ingame-Handle wie TankMax', r.status === 200, r.status);
    await win.ensureGpCharactersLoaded(true); await wait(200);
    check('Handle wird in der Anzeige verwendet (Kurzname@Handle statt Kurzname (Account))',
      !!doc.querySelector('#gpCharDatalist option[value="TankMax@sharedhandle"]') && !!doc.querySelector('#gpCharDatalist option[value="TankMax2@sharedhandle"]'));

    // Zeile neueZeileIdx (Rolle Tank seit dem Rollen-Passung-Test oben, aktuell
    // TankMax zugewiesen) bekommt jetzt manuell den Mount "Pegasus" gesetzt und
    // wird dann auf TankMax2 umgestellt: gleiche Rolle (Tank) -> Zuweisung
    // klappt; der Mount bleibt "Pegasus" stehen (NICHT geleert), obwohl
    // TankMax2 laut Checkliste nur "Zauberkessel der Vettel" besitzt - das
    // Feld muss deshalb rot markiert werden.
    win.gpUpdateRowField(0, neueZeileIdx, 'mount', 'Pegasus'); win.renderGpPlanBoard(); await wait(100);
    gpRows = doc.querySelectorAll('#gpPlanBoard tbody tr');
    const handleSpielerFeld = gpRows[neueZeileIdx].querySelector('input[list="gpCharDatalist"]');
    handleSpielerFeld.value = 'TankMax2@sharedhandle';
    handleSpielerFeld.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(150);
    gpRows = doc.querySelectorAll('#gpPlanBoard tbody tr');
    const handleZeileNach = gpRows[neueZeileIdx];
    check('Rollen-Passung erlaubt gleiche Rolle (Tank -> Tank) zwischen zwei Charakteren', handleZeileNach.querySelector('input[list="gpCharDatalist"]').value === 'TankMax2@sharedhandle', handleZeileNach.querySelector('input[list="gpCharDatalist"]').value);
    const mountSelectHandle = Array.from(handleZeileNach.querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Pegasus'));
    check('Ausrüstung bleibt beim Charakterwechsel erhalten (Mount weiterhin Pegasus, nicht geleert)', mountSelectHandle && mountSelectHandle.value === 'Pegasus', mountSelectHandle && mountSelectHandle.value);
    check('Nicht besessene Ausrüstung wird rot markiert statt stillschweigend geleert zu werden', mountSelectHandle && (mountSelectHandle.getAttribute('style')||'').includes('var(--off)'), mountSelectHandle && mountSelectHandle.getAttribute('style'));

    const alleSpielerFelderHandle = Array.from(doc.querySelectorAll('#gpPlanBoard tbody tr')).map(tr => tr.querySelector('input[list="gpCharDatalist"]')).filter(Boolean);
    const handleDoppeltMarkiert = alleSpielerFelderHandle.filter(inp => (inp.value === 'TankMax@sharedhandle' || inp.value === 'TankMax2@sharedhandle') && (inp.getAttribute('style')||'').includes('var(--off)'));
    check('Gleicher Ingame-Handle bei ZWEI VERSCHIEDENEN Charakteren wird als Mehrfachbelegung markiert', handleDoppeltMarkiert.length >= 2, alleSpielerFelderHandle.map(i=>[i.value,i.getAttribute('style')]));
    win.gpResolveRowSpieler(0, neueZeileIdx, ''); await wait(100); // aufräumen für die folgenden Checks

    // Seit v0.24.0 (Nutzerbeschwerde "Plan speichern schließt den offenen Plan"):
    // der "Plan speichern"-Knopf im Board darf #gpPlanBoard NICHT leeren -
    // ensureGpPlansLoaded() -> renderGpPlanList() tut das immer, muss also
    // danach wieder mit renderGpPlanBoard() überschrieben werden.
    const planSpeichernBtn = Array.from(doc.querySelectorAll('#gpPlanBoard .btnrow button')).find(b => b.textContent.trim() === 'Plan speichern');
    check('"Plan speichern"-Knopf im Board vorhanden', !!planSpeichernBtn);
    if(planSpeichernBtn) planSpeichernBtn.click();
    await wait(300);
    check('Board bleibt nach "Plan speichern" sichtbar (schließt sich nicht)', doc.querySelectorAll('#gpPlanBoard .card').length > 0, doc.getElementById('gpPlanBoard').innerHTML.slice(0, 120));

    // Rev-Schutz beim Plan-Speichern (wie bei Presets/Formeln): veraltete rev -> 409.
    r = await api('/api/gp/plans/' + encodeURIComponent('Trial Sonntag'), {}, token);
    const planRevVorher = r.data.data.rev;
    check('Plan liefert eine numerische rev', typeof planRevVorher === 'number');
    r = await api('/api/gp/plans/' + encodeURIComponent('Trial Sonntag'), { method: 'PUT', body: JSON.stringify({ rev: planRevVorher, groups: [] }) }, token);
    check('Plan speichern mit aktueller rev klappt und liefert neue rev', r.status === 200 && r.data.rev === planRevVorher + 1, r.status + '/' + JSON.stringify(r.data));
    r = await api('/api/gp/plans/' + encodeURIComponent('Trial Sonntag'), { method: 'PUT', body: JSON.stringify({ rev: planRevVorher, groups: [] }) }, token);
    check('Plan speichern mit veralteter rev -> 409', r.status === 409, r.status);

    // Plan umbenennen (Server-Funktion gab es schon, jetzt auch per Button in der UI).
    win.showGpPage('planung'); await wait(500);
    win.prompt = () => 'Trial Sonntag Umbenannt';
    const umbenennenBtn = Array.from(doc.querySelectorAll('#gpPlanList button')).find(b => b.textContent.trim() === 'Umbenennen');
    check('Plan-Liste: "Umbenennen"-Button vorhanden', !!umbenennenBtn);
    if(umbenennenBtn){ umbenennenBtn.click(); await wait(400); }
    r = await api('/api/gp/plans', {}, token);
    check('Plan wurde über den Button umbenannt', r.data.some(p => p.name === 'Trial Sonntag Umbenannt'), JSON.stringify(r.data));

    // Plan duplizieren.
    win.prompt = () => 'Trial Sonntag Kopie';
    const duplizierenBtn = Array.from(doc.querySelectorAll('#gpPlanList button')).find(b => b.textContent.trim() === 'Duplizieren');
    check('Plan-Liste: "Duplizieren"-Button vorhanden', !!duplizierenBtn);
    if(duplizierenBtn){ duplizierenBtn.click(); await wait(500); }
    r = await api('/api/gp/plans', {}, token);
    check('Duplikat erscheint zusätzlich in der Plan-Liste', r.data.some(p => p.name === 'Trial Sonntag Kopie'), JSON.stringify(r.data));

    // Nur-Ansicht: Board ohne Eingabeelemente, zum Screenshotten/Teilen.
    await win.gpOpenPlan('Trial Sonntag Umbenannt'); await wait(300);
    win.gpAddGroup(); await wait(100); // der rev-Konflikt-Test oben hat die Gruppen dieses Plans geleert
    let ansichtBtn = doc.getElementById('gpAnsichtToggleBtn');
    check('"Nur-Ansicht"-Button vorhanden', !!ansichtBtn && ansichtBtn.textContent.includes('Nur-Ansicht'), ansichtBtn && ansichtBtn.textContent);
    if(ansichtBtn){
      ansichtBtn.click(); await wait(150);
      check('Nur-Ansicht zeigt keine Eingabefelder/Selects mehr', doc.querySelectorAll('#gpPlanBoard select, #gpPlanBoard input').length === 0);
      const zurueckBtn = doc.getElementById('gpAnsichtToggleBtn');
      check('Umschalt-Button zeigt jetzt "Zurück zur Bearbeitung"', zurueckBtn && zurueckBtn.textContent.includes('Zurück zur Bearbeitung'), zurueckBtn && zurueckBtn.textContent);
      if(zurueckBtn) zurueckBtn.click();
      await wait(150);
      check('Zurück zur Bearbeitung zeigt wieder Eingabefelder', doc.querySelectorAll('#gpPlanBoard select, #gpPlanBoard input').length > 0);
    }

    // Rollen-Überbelegung-Warnung (seit v0.22.0, Nutzerwunsch): die frische
    // Dungeon-Gruppe hier hat noch die Standardbesetzung aus gpAddGroup()
    // (DPS,DPS,DPS,Heiler,Tank an Index 0-4) - Zeile 0 zusätzlich auf Tank
    // umstellen und beide Tank-Zeilen mit Spielern besetzen (nur BESETZTE
    // Zeilen zählen), damit die Überbelegung entsteht.
    win.gpUpdateRowRolle(0, 0, 'Tank'); await wait(50);
    win.gpResolveRowSpieler(0, 0, 'Testspieler1'); await wait(50);
    win.gpResolveRowSpieler(0, 4, 'Testspieler2'); await wait(100);
    let warnGroupCard = doc.querySelectorAll('#gpPlanBoard .card')[0];
    check('Rollen-Warnung erscheint bei 2 Tanks in einer Dungeon-Gruppe',
      warnGroupCard.textContent.includes('⚠ 2 Tanks') && warnGroupCard.textContent.includes('erwartet: 1'),
      warnGroupCard.textContent.slice(0, 300));
    win.gpUpdateRowRolle(0, 0, 'DPS'); await wait(50); // aufräumen für die folgenden Checks

    // Artefakt-Duplikat INNERHALB derselben Gruppe wird markiert (anders als
    // die Spieler-Duplikatserkennung, die planweit gilt). 'Icon-Test-Artefakt'
    // wurde weiter oben über die Referenzlisten-Seite angelegt und gespeichert,
    // ist also ein gültiger Auswahlwert.
    win.gpUpdateRowField(0, 1, 'artefakt', 'Icon-Test-Artefakt');
    win.gpUpdateRowField(0, 2, 'artefakt', 'Icon-Test-Artefakt');
    win.renderGpPlanBoard(); await wait(100);
    const gpRowsArtefakt = doc.querySelectorAll('#gpPlanBoard .card')[0].querySelectorAll('tbody tr');
    const artefaktSelect1 = gpRowsArtefakt[1].querySelectorAll('select')[1];
    const artefaktSelect2 = gpRowsArtefakt[2].querySelectorAll('select')[1];
    check('Doppelt vergebenes Artefakt wird in beiden Zeilen markiert',
      artefaktSelect1 && artefaktSelect2 && artefaktSelect1.value === 'Icon-Test-Artefakt' && artefaktSelect2.value === 'Icon-Test-Artefakt' &&
      (artefaktSelect1.getAttribute('style') || '').includes('var(--off)') && (artefaktSelect2.getAttribute('style') || '').includes('var(--off)'),
      [artefaktSelect1 && artefaktSelect1.value, artefaktSelect1 && artefaktSelect1.getAttribute('style'), artefaktSelect2 && artefaktSelect2.value, artefaktSelect2 && artefaktSelect2.getAttribute('style')]);
    // 'Icon-Test-Artefakt' hat ein gespeichertes Icon (s. o.), aber keinen
    // Buff-Wert - das Badge zeigt seit v0.22.2 dafür ein Icon ohne Text an.
    // Seit v0.24.0 sitzt das Icon direkt IM Select (gp-field-icon), nicht mehr
    // als separates Pill-Badge (dmgbuff-badge) daneben - hier entsprechend
    // aktualisiert geprüft (weiterhin: kein zusätzlicher %-Text am Icon selbst).
    const artefaktBadge1 = artefaktSelect1.parentElement.querySelector('.gp-field-icon');
    check('Icon im Select zeigt keinen zusätzlichen %-Text mehr an (reines <img>)', artefaktBadge1 && artefaktBadge1.tagName === 'IMG', artefaktBadge1 && artefaktBadge1.outerHTML);
    // Seit v0.24.0: das Select mit Icon bekommt die gp-has-icon-Klasse (mehr
    // Innenpolster links) und das Icon ist größer als das alte Pill-Badge
    // (26px statt 16px, s. CSS .gp-field-icon).
    check('Select mit Icon bekommt die gp-has-icon-Klasse', artefaktSelect1.classList.contains('gp-has-icon'), artefaktSelect1.className);
    win.gpUpdateRowField(0, 2, 'artefakt', ''); win.renderGpPlanBoard(); await wait(100);
    const gpRowsArtefaktNach = doc.querySelectorAll('#gpPlanBoard .card')[0].querySelectorAll('tbody tr');
    const artefaktSelect1Nach = gpRowsArtefaktNach[1].querySelectorAll('select')[1];
    check('Markierung verschwindet wieder, wenn nur noch ein Zeile das Artefakt trägt',
      artefaktSelect1Nach && !(artefaktSelect1Nach.getAttribute('style') || '').includes('var(--off)'),
      artefaktSelect1Nach && artefaktSelect1Nach.getAttribute('style'));

    // Admin-Statistik-Karte: braucht Rolle admin, der bisherige Test-User ist nur
    // coadmin - dafür kurz als der Bootstrap-Admin einloggen.
    win.logoutAccount(); await wait(300);
    win.openAccountPanel(); await wait(300);
    doc.getElementById('acc_username').value = ADMIN;
    doc.getElementById('acc_password').value = 'adminpw';
    win.loginAccount(); await wait(800);
    win.closeAccountModal();
    win.showApp('stats'); await wait(200);
    win.showPage('users'); await wait(600);
    const statsText = doc.getElementById('adminStats').textContent;
    check('Admin-Statistik zeigt Benutzeranzahl', statsText.includes('Benutzer') && /\d/.test(statsText), statsText.slice(0, 200));
    check('Admin-Statistik zeigt Aufstellungs-Pläne', statsText.includes('Aufstellungs-Pläne'), statsText.slice(0, 200));

    // Dungeon (5) <-> Trial (10): bei der Standardgröße wird automatisch verdoppelt/halbiert.
    win.gpAddGroup(); await wait(100);
    const gpCards = () => doc.querySelectorAll('#gpPlanBoard .card');
    const neueGruppeIdx = gpCards().length - 1;
    const zeilenImCard = idx => gpCards()[idx].querySelectorAll('tbody tr').length;
    check('Neue Gruppe startet im Dungeon-Modus mit 5 Zeilen',
      gpCards()[neueGruppeIdx].querySelector('input[value="dungeon"]').checked && zeilenImCard(neueGruppeIdx) === 5,
      zeilenImCard(neueGruppeIdx));
    win.gpSetGroupModus(neueGruppeIdx, 'trial'); await wait(100);
    check('Dungeon -> Trial verdoppelt auf 10 Zeilen', zeilenImCard(neueGruppeIdx) === 10, zeilenImCard(neueGruppeIdx));
    check('Trial-Modus zeigt die Party-Spalte für die neue Gruppe', gpCards()[neueGruppeIdx].textContent.includes('Party'));
    win.confirm = () => true; // Rückwechsel fragt nach, im Test immer bestätigen
    win.gpSetGroupModus(neueGruppeIdx, 'dungeon'); await wait(100);
    check('Trial -> Dungeon kürzt nach Bestätigung wieder auf 5 Zeilen', zeilenImCard(neueGruppeIdx) === 5, zeilenImCard(neueGruppeIdx));

    // Seit v0.21.0 (Nutzerwunsch "Gruppen-Optimierung mit Artefakte/Gefährten"):
    // "Bestes eigenes Setup"-Knopf pro Zeile wählt aus den ANGEKREUZTEN
    // Besitz-Einträgen des zugewiesenen Charakters jeweils den mit dem höchsten
    // Dmg-Buff. Getrennter Test-Charakter "OptiChar" statt TankMax wiederzuver-
    // wenden, damit die bestehenden "gefiltert auf Pegasus + Leer"-Assertions
    // von oben unangetastet bleiben. Zwei Mounts mit unterschiedlichem
    // dmgBonus (Defaults: Pegasus 7,89 < Zauberkessel der Vettel 9,41) und zwei
    // Gefährten, denen hier extra ein buff-Wert gesetzt wird (Defaults haben
    // noch keinen).
    // Seit v0.23.0 (Nutzervorgabe zur Rollen-Logik): zusätzlich ein "schaden"-
    // Wert je Gefährte (Skorpion 10 > Flapjack 3 - umgekehrt zum Buff-Wert, s.
    // u.) sowie buff-Werte für zwei Gefährten-Verstärkungen, um DPS- und
    // Support-Pfad des Optimierers getrennt zu testen.
    // Über die echte Referenzlisten-Seite speichern (nicht per Roh-API direkt
    // in shared.json) - sonst bliebe die im Frontend gehaltene gpGefaehrten-
    // Variable veraltet (sie wird nur beim Laden bzw. bei gpSaveReferenzlisten()
    // selbst aktualisiert, nicht durch fremde Server-Änderungen).
    win.showGpPage('referenz'); await wait(300);
    const refGefTableOpti = doc.getElementById('gpref-gpGefaehrten');
    const setFeldFuer = (table, name, feld, val) => {
      const row = Array.from(table.querySelectorAll('tbody tr')).find(tr => tr.querySelector('input[data-field="name"]').value === name);
      if(row) input(win, row.querySelector(`input[data-field="${feld}"]`), String(val));
      return !!row;
    };
    const skorpionGefunden = setFeldFuer(refGefTableOpti, 'Skorpion', 'buff', 2) && setFeldFuer(refGefTableOpti, 'Skorpion', 'schaden', 10);
    const flapjackGefunden = setFeldFuer(refGefTableOpti, 'Flapjack', 'buff', 5) && setFeldFuer(refGefTableOpti, 'Flapjack', 'schaden', 3);
    check('Optimierer-Test: Skorpion/Flapjack in der Referenzliste gefunden', skorpionGefunden && flapjackGefunden);
    const refGefVerstTableOpti = doc.getElementById('gpref-gpGefaehrtenVerstaerkung');
    const ruestungsbruchGefunden = setFeldFuer(refGefVerstTableOpti, 'Rüstungsbruch', 'buff', 3);
    const verwundbarkeitGefunden = setFeldFuer(refGefVerstTableOpti, 'Verwundbarkeit', 'buff', 7);
    check('Optimierer-Test: Rüstungsbruch/Verwundbarkeit in der Referenzliste gefunden', ruestungsbruchGefunden && verwundbarkeitGefunden);
    // Seit v0.23.0: "Bevorzugt für"-Rollenauswahl bei Artefakten (Select statt
    // Freitext) - Tentacle Rod hier als Tank-bevorzugt markieren, um die
    // Rollen-Präferenz im Optimierer separat zu testen.
    const refArtefakteTableOpti = doc.getElementById('gpref-gpArtefakte');
    const tentacleRodRolleSelect = Array.from(refArtefakteTableOpti.querySelectorAll('tbody tr')).find(tr => tr.querySelector('input[data-field="name"]').value === 'Tentacle Rod')?.querySelector('select[data-field="rolle"]');
    check('Referenzlisten: Artefakte haben eine "Bevorzugt für"-Rollenauswahl', !!tentacleRodRolleSelect);
    if(tentacleRodRolleSelect){ tentacleRodRolleSelect.value = 'Tank'; tentacleRodRolleSelect.dispatchEvent(new win.Event('change', { bubbles: true })); }
    await win.gpSaveReferenzlisten(); await wait(300);
    const sharedNachGefBuff = (await api('/api/shared')).data;
    const skorpionGespeichert = (sharedNachGefBuff.gpGefaehrten || []).find(e => e.name === 'Skorpion');
    const flapjackGespeichert = (sharedNachGefBuff.gpGefaehrten || []).find(e => e.name === 'Flapjack');
    check('Gefährten-Referenzliste: Buff- UND Schaden-Werte für den Optimierer-Test gespeichert',
      skorpionGespeichert && skorpionGespeichert.buff === 2 && skorpionGespeichert.schaden === 10 && flapjackGespeichert && flapjackGespeichert.buff === 5 && flapjackGespeichert.schaden === 3,
      { skorpionGespeichert, flapjackGespeichert });
    const tentacleRodGespeichert = (sharedNachGefBuff.gpArtefakte || []).find(e => e.name === 'Tentacle Rod');
    check('Artefakt-Referenzliste: "Bevorzugt für"-Rolle wird gespeichert', tentacleRodGespeichert && tentacleRodGespeichert.rolle === 'Tank', tentacleRodGespeichert);
    // showGpPage('planung') leert #gpPlanBoard (renderGpPlanList tut das immer,
    // unabhängig vom aktuellen Plan) - currentGpPlanData bleibt aber unverändert,
    // also das Board explizit neu zeichnen statt es implizit zu verlieren.
    win.showGpPage('planung'); await wait(200);
    win.renderGpPlanBoard(); await wait(200);
    r = await api('/api/gp/characters', { method: 'POST', body: JSON.stringify({ name: 'OptiChar' }) }, token);
    check('Optimierer-Test: eigener Charakter "OptiChar" angelegt', r.status === 201, r.status);
    r = await api('/api/gp/characters/OptiChar', { method: 'PUT', body: JSON.stringify({
      klasse: 'Waldläufer', rollen: { dps: true, heal: false, tank: false },
      besitz: {
        artefakte: ['Tentacle Rod'], mounts: ['Pegasus', 'Zauberkessel der Vettel'],
        mountBonus: ['Mystische Aura'], gefaehrten: ['Skorpion', 'Flapjack'],
        gefaehrtenVerstaerkung: ['Rüstungsbruch', 'Verwundbarkeit'],
      },
    }) }, token);
    check('Optimierer-Test: Besitz von OptiChar gespeichert', r.status === 200, r.status);

    await win.ensureGpCharactersLoaded(true); await wait(300);
    win.gpResolveRowSpieler(neueGruppeIdx, 0, `OptiChar (${user})`); await wait(150);
    // Zeile 0 einer frisch angelegten Dungeon-Gruppe (gpAddGroup()) ist per
    // Default Rolle DPS - genau der Fall aus der Nutzervorgabe (v0.23.0):
    // DPS haben ein reines Selbstbuff-Mount und geben Gefährten-Boni an die
    // Supports weiter, Mount/Gefährten-Bonus bleiben also unangetastet;
    // beim Gefährten selbst zählt für DPS der eigene Schaden statt des
    // Support-Buffs (Skorpion 10 > Flapjack 3, umgekehrt zum Buff-Wert).
    const optiZeile = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0];
    const optiBtn = Array.from(optiZeile.querySelectorAll('button')).find(b => (b.title||'').startsWith('Bestes eigenes Setup'));
    check('"Bestes eigenes Setup"-Knopf (🏆) ist pro Zeile vorhanden', !!optiBtn);
    const optiMountVorher = optiZeile.querySelectorAll('select')[2].value; // Rolle=0,Artefakt=1,Mount=2 - vor Klick erfassen
    if(optiBtn) optiBtn.click();
    await wait(150);
    const optiZeileNach = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0];
    const optiSelectsNach = optiZeileNach.querySelectorAll('select');
    const optiArtefaktSelect = Array.from(optiSelectsNach).find(sel => Array.from(sel.options).some(o => o.value === 'Tentacle Rod'));
    const optiMountSelect = Array.from(optiSelectsNach).find(sel => Array.from(sel.options).some(o => o.value === 'Zauberkessel der Vettel'));
    const optiGefaehrteSelect = Array.from(optiSelectsNach).find(sel => Array.from(sel.options).some(o => o.value === 'Flapjack'));
    check('DPS: Artefakt wird trotzdem optimiert (einziger Besitz-Eintrag)', optiArtefaktSelect && optiArtefaktSelect.value === 'Tentacle Rod', optiArtefaktSelect && optiArtefaktSelect.value);
    check('DPS: Mount bleibt unangetastet (Selbstbuff, laut Nutzervorgabe nicht vom Optimierer anfassen)', optiMountSelect && optiMountSelect.value === optiMountVorher, optiMountSelect && [optiMountVorher, optiMountSelect.value]);
    check('DPS: Gefährte wird nach eigenem SCHADEN gewählt (Skorpion statt Flapjack, obwohl Flapjack den höheren Support-Buff hat)', optiGefaehrteSelect && optiGefaehrteSelect.value === 'Skorpion', optiGefaehrteSelect && optiGefaehrteSelect.value);
    const optiGefBonusSelect = optiZeileNach.querySelectorAll('select')[5]; // Rolle,Artefakt,Mount,MountBonus,Gefährte,GefährtenBonus
    check('DPS: Gefährten-Bonus bleibt unangetastet (Support-Feld laut Nutzervorgabe)', optiGefBonusSelect && optiGefBonusSelect.value === '', optiGefBonusSelect && optiGefBonusSelect.value);
    const optiMountBonusSelect = optiZeileNach.querySelectorAll('select')[3];
    check('DPS: Mount-Bonus bleibt unangetastet (nur für Supports fix eingeplant)', optiMountBonusSelect && optiMountBonusSelect.value === '', optiMountBonusSelect && optiMountBonusSelect.value);

    // Dieselbe Zeile jetzt auf Tank umstellen und erneut optimieren: Mount/
    // Gefährten-Bonus/Mount-Bonus werden jetzt SEHR wohl gesetzt (Supports),
    // und der Gefährte wechselt zurück auf den höheren Support-BUFF
    // (Flapjack statt Skorpion) - exakt umgekehrt zum DPS-Fall oben.
    win.gpUpdateRowRolle(neueGruppeIdx, 0, 'Tank'); await wait(100);
    const optiBtnTank = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0].querySelectorAll('button')).find(b => (b.title||'').startsWith('Bestes eigenes Setup'));
    if(optiBtnTank) optiBtnTank.click();
    await wait(150);
    const optiZeileTank = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0];
    const optiSelectsTank = optiZeileTank.querySelectorAll('select');
    const optiMountSelectTank = Array.from(optiSelectsTank).find(sel => Array.from(sel.options).some(o => o.value === 'Zauberkessel der Vettel'));
    const optiGefaehrteSelectTank = Array.from(optiSelectsTank).find(sel => Array.from(sel.options).some(o => o.value === 'Flapjack'));
    check('Tank: Mount wird jetzt optimiert (höherer Dmg-Bonus, Zauberkessel der Vettel statt Pegasus)', optiMountSelectTank && optiMountSelectTank.value === 'Zauberkessel der Vettel', optiMountSelectTank && optiMountSelectTank.value);
    check('Tank: Gefährte wechselt zurück auf den höheren Support-Buff (Flapjack statt Skorpion)', optiGefaehrteSelectTank && optiGefaehrteSelectTank.value === 'Flapjack', optiGefaehrteSelectTank && optiGefaehrteSelectTank.value);
    check('Tank: Gefährten-Bonus wird jetzt gesetzt (höherer Buff, Verwundbarkeit statt Rüstungsbruch)', optiSelectsTank[5] && optiSelectsTank[5].value === 'Verwundbarkeit', optiSelectsTank[5] && optiSelectsTank[5].value);
    check('Tank: Mount-Bonus wird "fix" auf den einzigen eigenen Eintrag gesetzt (Mystische Aura, kein Rangwert vorhanden)', optiSelectsTank[3] && optiSelectsTank[3].value === 'Mystische Aura', optiSelectsTank[3] && optiSelectsTank[3].value);

    // "Alle Zeilen optimieren" auf Gruppenebene: wirkt auf JEDE besetzte Zeile
    // (Charakter ODER freier Name) - hier nur die eine OptiChar-Zeile in
    // dieser Gruppe, der Rest der 5 Zeilen bleibt leer (nichts eingetragen ->
    // übersprungen, kein Fehler). Rolle zurück auf DPS (OptiChar ist nur als
    // DPS markiert) - sonst würde die Neuzuweisung an der seit v0.24.0
    // geltenden Rollen-Passung scheitern (die Zeile stand hier noch auf Tank
    // vom Schritt oben).
    win.gpUpdateRowRolle(neueGruppeIdx, 0, 'DPS'); await wait(50);
    win.gpResolveRowSpieler(neueGruppeIdx, 0, ''); // Zeile zurücksetzen, um den Gruppen-Knopf isoliert zu testen
    await wait(100);
    win.gpResolveRowSpieler(neueGruppeIdx, 0, `OptiChar (${user})`); await wait(100);
    const gruppenOptiBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('.btnrow button')).find(b => b.textContent.includes('Alle Zeilen optimieren'));
    check('"Alle Zeilen optimieren"-Knopf auf Gruppenebene vorhanden', !!gruppenOptiBtn);
    if(gruppenOptiBtn) gruppenOptiBtn.click();
    await wait(150);
    const optiZeileGruppe = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0];
    const optiArtefaktSelectGruppe = Array.from(optiZeileGruppe.querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Tentacle Rod'));
    check('Gruppen-Optimierung wendet das beste Setup auch über den Gruppen-Knopf an', optiArtefaktSelectGruppe && optiArtefaktSelectGruppe.value === 'Tentacle Rod', optiArtefaktSelectGruppe && optiArtefaktSelectGruppe.value);

    // Seit v0.26.0 (Nutzerwunsch "auch freie Namen ohne zuweisbaren Charakter
    // sollen optimiert werden, dort wird angenommen, dass die Leute alles
    // haben"): OHNE Charakter-Profil (nur freier Name) optimiert der 🏆-Knopf
    // jetzt trotzdem, indem für JEDE Kategorie die komplette Referenzliste als
    // "Besitz" angenommen wird. DPS-Zeile: Artefakt ohne Rollen-Tag-Treffer
    // (nur "Tentacle Rod" ist als Tank markiert) fällt auf den global höchsten
    // Buff-Wert zurück ("Icon-Test-Artefakt", 10,56 % - trägt seit dem Icon-
    // Upload-Test weiter oben den ehemaligen Buff-Wert von "Demogorgon's
    // Reach", s. Kommentar unten); Gefährte nach Schaden
    // (Skorpion, 10 > Flapjack, 3); Mount/Gefährten-Bonus bleiben bei DPS wie
    // gehabt unangetastet.
    win.gpAddRow(neueGruppeIdx, 'DPS'); await wait(100);
    let freieZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const freieDpsIdx = freieZeilen.length - 1;
    const freieDpsSpielerFeld = freieZeilen[freieDpsIdx].querySelector('input[list="gpCharDatalist"]');
    freieDpsSpielerFeld.value = 'Gastspieler Talo';
    freieDpsSpielerFeld.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(100);
    const freieDpsOptiBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[freieDpsIdx].querySelectorAll('button')).find(b => (b.title||'').startsWith('Bestes eigenes Setup'));
    if(freieDpsOptiBtn) freieDpsOptiBtn.click();
    await wait(150);
    const freieDpsZeileNach = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[freieDpsIdx];
    const freieDpsSelects = freieDpsZeileNach.querySelectorAll('select');
    // Rollen-Präferenz gilt auch ohne Profil (Tentacle Rod statt höherem Rohwert)
    // - siehe unten. Ohne Rollen-Treffer gewinnt der global höchste Buff-Wert:
    // die Referenzliste enthält seit dem Icon-Upload-Test weiter oben (der
    // dabei den ERSTEN Tabelleneintrag umbenannt statt eine neue Zeile
    // hinzugefügt hat) "Icon-Test-Artefakt" mit dem ehemaligen Buff-Wert von
    // "Demogorgon's Reach" (10,56 %, weiterhin der höchste in der Liste).
    // Seit v0.28.0 ist die Duplikat-Vermeidung PLANWEIT (nicht mehr nur
    // innerhalb der Gruppe) - "Icon-Test-Artefakt" ist bereits in Gruppe 0
    // (Zeile 1, vom Artefakt-Duplikat-Test weiter oben) vergeben und wird
    // deshalb hier gemieden; nächstbester Wert ist "Xeleth's Blast Scepter /
    // Halaster's" (6 %).
    check('Freier Name (DPS) wird ebenfalls optimiert: Artefakt = höchster NICHT bereits im Plan vergebener Buff-Wert', freieDpsSelects[1] && freieDpsSelects[1].value === "Xeleth's Blast Scepter / Halaster's", freieDpsSelects[1] && freieDpsSelects[1].value);
    check('Freier Name (DPS): Mount bleibt unangetastet (Selbstbuff-Regel gilt auch ohne Profil)', freieDpsSelects[2] && freieDpsSelects[2].value === '', freieDpsSelects[2] && freieDpsSelects[2].value);
    // Seit v0.27.0 ("auch Sachen nicht doppelt zuweisen"): Zeile 0 (OptiChar)
    // trägt zu diesem Zeitpunkt bereits "Skorpion" als Gefährte (aus dem
    // "Alle Zeilen optimieren"-Test oben, DPS-Rolle -> Schaden-Kriterium) -
    // der Optimierer meidet diesen bereits vergebenen Wert und wählt den
    // nächstbesten (Flapjack, Schaden 3) statt ihn zu duplizieren.
    check('Freier Name (DPS): Gefährte meidet den in Zeile 0 bereits vergebenen Skorpion (Flapjack statt Duplikat)', freieDpsSelects[4] && freieDpsSelects[4].value === 'Flapjack', freieDpsSelects[4] && freieDpsSelects[4].value);
    win.gpRemoveRow(neueGruppeIdx, freieDpsIdx); await wait(100);

    // Tank-Zeile: Rollen-Präferenz UND "besitzt alles" zusammen getestet -
    // unter ALLEN Artefakten passt nur "Tentacle Rod" zur Rolle Tank (aus dem
    // v0.23.0-Test), wird also trotz niedrigerem Rohwert bevorzugt gewählt.
    // Mount/Gefährte/Gefährten-Bonus nach globalem Bestwert, Mount-Bonus "fix"
    // auf den ersten Referenzeintrag (kein Rangwert vorhanden).
    win.gpAddRow(neueGruppeIdx, 'Tank'); await wait(100);
    freieZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const freieTankIdx = freieZeilen.length - 1;
    const freieTankSpielerFeld = freieZeilen[freieTankIdx].querySelector('input[list="gpCharDatalist"]');
    freieTankSpielerFeld.value = 'Gastspieler Boris';
    freieTankSpielerFeld.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(100);
    const freieTankOptiBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[freieTankIdx].querySelectorAll('button')).find(b => (b.title||'').startsWith('Bestes eigenes Setup'));
    if(freieTankOptiBtn) freieTankOptiBtn.click();
    await wait(150);
    const freieTankZeileNach = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[freieTankIdx];
    const freieTankSelects = freieTankZeileNach.querySelectorAll('select');
    // Seit v0.29.0 hat der reine Dmg-Buff-Wert Vorrang vor dem Rollen-
    // Vorschlag (Nutzervorgabe "zuerst den besten dmg Buff, dann den
    // Vorschlag in der Referenzliste zur präferierten Klasse" - Rollen-
    // Präferenz ist jetzt nur noch der LETZTE Tiebreaker bei Gleichstand,
    // kein Filter mehr davor). "Icon-Test-Artefakt" (10,56 %) ist planweit
    // bereits in Gruppe 0 vergeben, der nächsthöhere freie Wert ist "Xeleth's
    // Blast Scepter / Halaster's" (6 %) - Tentacle Rod (4,23 %, Tank-Tag)
    // gewinnt hier NICHT mehr trotz Rollen-Treffer, da sein Rohwert niedriger ist.
    check('Freier Name (Tank): höchster Dmg-Buff-Wert gewinnt vor dem Rollen-Vorschlag', freieTankSelects[1] && freieTankSelects[1].value === "Xeleth's Blast Scepter / Halaster's", freieTankSelects[1] && freieTankSelects[1].value);
    // Seit v0.27.0: Zeile 0 trägt bereits "Zauberkessel der Vettel" als Mount
    // (aus dem "Tank"-Test weiter oben, dort unverändert seit dem DPS-
    // Zwischenschritt) - wird gemieden, nächstbester Mount ist Pegasus (7,89 %).
    check('Freier Name (Tank): Mount meidet den in Zeile 0 bereits vergebenen Zauberkessel der Vettel (Pegasus statt Duplikat)', freieTankSelects[2] && freieTankSelects[2].value === 'Pegasus', freieTankSelects[2] && freieTankSelects[2].value);
    // Seit v0.31.0 respektiert auch Mount-Ausrüstungsbonus die Duplikat-
    // Vermeidung (Nutzerwunsch "Mount-Bonus soll auch nicht zweimal das
    // Gleiche sein") - "Mystische Aura" ist an dieser Stelle bereits an
    // anderer Stelle im Plan vergeben, der "fixe" Fallback weicht deshalb
    // auf den nächsten freien eigenen Eintrag aus ("Runische Aura").
    check('Freier Name (Tank): Mount-Bonus weicht bei Duplikat auf den nächsten freien Eintrag aus (Runische Aura statt Mystische Aura)', freieTankSelects[3] && freieTankSelects[3].value === 'Runische Aura', freieTankSelects[3] && freieTankSelects[3].value);
    // Seit v0.27.0: Zeile 0 trägt bereits "Verwundbarkeit" als Gefährten-Bonus
    // - wird gemieden, nächstbester ist Rüstungsbruch (Buff 3 statt 7).
    check('Freier Name (Tank): Gefährten-Bonus meidet die in Zeile 0 bereits vergebene Verwundbarkeit (Rüstungsbruch statt Duplikat)', freieTankSelects[5] && freieTankSelects[5].value === 'Rüstungsbruch', freieTankSelects[5] && freieTankSelects[5].value);
    win.gpRemoveRow(neueGruppeIdx, freieTankIdx); await wait(100);

    // Seit v0.26.0 (Nutzerwunsch "Lieblingsartefakte auswählen können, max
    // dps geht aber in der Regel vor"): eigener Chip-Bereich im Charakter-
    // Editor, NUR aus den schon angekreuzten Besitz-Artefakten. Als Tiebreaker
    // im Optimierer: OptiChar bekommt zusätzlich "Tentacle Rod" als Besitz UND
    // als Lieblingsartefakt - da Tentacle Rod (Rolle Tank, Buff 4,23) und
    // OptiChars einziges anderes Artefakt ("Tentacle Rod" ist ohnehin schon
    // Tank-bevorzugt) - hier stattdessen zwei GLEICHWERTIGE Artefakte ohne
    // Rollen-Tag testen: "Crystal of Soul's Flight" und "Marco's Mystic
    // Marker" haben beide Buff 4,0 - als Favorit gesetzt gewinnt der Favorit
    // bei diesem Gleichstand, obwohl ohne Favoriten das zuerst gefundene
    // gewänne.
    r = await api('/api/gp/characters/OptiChar', { method: 'PUT', body: JSON.stringify({
      klasse: 'Waldläufer', rollen: { dps: true, heal: false, tank: false },
      besitz: { artefakte: ["Crystal of Soul's Flight", "Marco's Mystic Marker"], mounts: ['Pegasus', 'Zauberkessel der Vettel'], gefaehrten: ['Skorpion', 'Flapjack'] },
      lieblingsartefakte: ["Marco's Mystic Marker"],
    }) }, token);
    check('Lieblingsartefakte-Test: OptiChar mit zwei gleichwertigen Artefakten + einem Favoriten gespeichert', r.status === 200, r.status);
    await win.ensureGpCharactersLoaded(true); await wait(200);
    win.gpResolveRowSpieler(neueGruppeIdx, 0, ''); await wait(100);
    win.gpResolveRowSpieler(neueGruppeIdx, 0, `OptiChar (${user})`); await wait(100);
    const favBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0].querySelectorAll('button')).find(b => (b.title||'').startsWith('Bestes eigenes Setup'));
    if(favBtn) favBtn.click();
    await wait(150);
    const favZeile = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0];
    const favArtefaktSelect = Array.from(favZeile.querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === "Marco's Mystic Marker"));
    check('Lieblingsartefakt gewinnt den Tiebreaker bei gleichem Buff-Wert', favArtefaktSelect && favArtefaktSelect.value === "Marco's Mystic Marker", favArtefaktSelect && favArtefaktSelect.value);

    // Seit v0.27.0 (Nutzerwunsch "auch Sachen nicht doppelt zuweisen"): zwei
    // NEUE freie DPS-Zeilen ohne jede Vorbelegung, direkt hintereinander per
    // "Alle Zeilen optimieren" optimiert - sollen die zwei UNTERSCHIEDLICHEN
    // besten Artefakte bekommen (Icon-Test-Artefakt 10,56 % und Xeleth's Blast
    // Scepter / Halaster's 6 %, die beiden höchsten ohne Tank-Rollen-Tag),
    // nicht zweimal denselben Top-Wert.
    win.gpAddRow(neueGruppeIdx, 'DPS'); await wait(50);
    win.gpAddRow(neueGruppeIdx, 'DPS'); await wait(100);
    let dupZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const dupIdx1 = dupZeilen.length - 2, dupIdx2 = dupZeilen.length - 1;
    const dupFeld1 = dupZeilen[dupIdx1].querySelector('input[list="gpCharDatalist"]');
    const dupFeld2 = dupZeilen[dupIdx2].querySelector('input[list="gpCharDatalist"]');
    dupFeld1.value = 'Gastspieler Uno'; dupFeld1.dispatchEvent(new win.Event('change', { bubbles: true }));
    dupFeld2.value = 'Gastspieler Dos'; dupFeld2.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(100);
    const dupOptiBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('.btnrow button')).find(b => b.textContent.includes('Alle Zeilen optimieren'));
    if(dupOptiBtn) dupOptiBtn.click();
    await wait(200);
    dupZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const dupArtefakt1 = Array.from(dupZeilen[dupIdx1].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Icon-Test-Artefakt'));
    const dupArtefakt2 = Array.from(dupZeilen[dupIdx2].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Icon-Test-Artefakt'));
    const dupWerte = [dupArtefakt1 && dupArtefakt1.value, dupArtefakt2 && dupArtefakt2.value];
    check('Optimierer vergibt dasselbe Artefakt nicht doppelt, wenn eine Alternative existiert', dupWerte[0] && dupWerte[1] && dupWerte[0] !== dupWerte[1], dupWerte);
    // "Icon-Test-Artefakt" ist planweit bereits in Gruppe 0 vergeben (s. o.),
    // die beiden nächstbesten (noch freien) Werte sind "Xeleth's Blast
    // Scepter / Halaster's" und "Mythallar Fragment" (beide 6 %).
    check('Beide erhalten trotzdem jeweils einen der nächstbesten freien Top-Werte (Xeleths Blast Scepter + Mythallar Fragment)',
      dupWerte.includes("Xeleth's Blast Scepter / Halaster's") && dupWerte.includes('Mythallar Fragment'), dupWerte);
    win.gpRemoveRow(neueGruppeIdx, dupIdx2); await wait(50);
    win.gpRemoveRow(neueGruppeIdx, dupIdx1); await wait(50);

    // Fallback: existiert KEINE Alternative (beide besitzen nur genau dasselbe
    // eine Artefakt), wird trotzdem dupliziert statt eine Zeile leer zu lassen.
    r = await api('/api/gp/characters', { method: 'POST', body: JSON.stringify({ name: 'DupChar1' }) }, token);
    check('Duplikat-Fallback-Test: DupChar1 angelegt', r.status === 201, r.status);
    r = await api('/api/gp/characters/DupChar1', { method: 'PUT', body: JSON.stringify({
      klasse: 'Waldläufer', rollen: { dps: true, heal: false, tank: false }, besitz: { artefakte: ['Broken Halo'] },
    }) }, token);
    check('Duplikat-Fallback-Test: DupChar1 besitzt nur "Broken Halo"', r.status === 200, r.status);
    r = await api('/api/gp/characters', { method: 'POST', body: JSON.stringify({ name: 'DupChar2' }) }, token);
    check('Duplikat-Fallback-Test: DupChar2 angelegt', r.status === 201, r.status);
    r = await api('/api/gp/characters/DupChar2', { method: 'PUT', body: JSON.stringify({
      klasse: 'Waldläufer', rollen: { dps: true, heal: false, tank: false }, besitz: { artefakte: ['Broken Halo'] },
    }) }, token);
    check('Duplikat-Fallback-Test: DupChar2 besitzt ebenfalls nur "Broken Halo"', r.status === 200, r.status);
    await win.ensureGpCharactersLoaded(true); await wait(200);
    win.gpAddRow(neueGruppeIdx, 'DPS'); await wait(50);
    win.gpAddRow(neueGruppeIdx, 'DPS'); await wait(100);
    let fbZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const fbIdx1 = fbZeilen.length - 2, fbIdx2 = fbZeilen.length - 1;
    win.gpResolveRowSpieler(neueGruppeIdx, fbIdx1, `DupChar1 (${user})`); await wait(50);
    win.gpResolveRowSpieler(neueGruppeIdx, fbIdx2, `DupChar2 (${user})`); await wait(100);
    const fbOptiBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('.btnrow button')).find(b => b.textContent.includes('Alle Zeilen optimieren'));
    if(fbOptiBtn) fbOptiBtn.click();
    await wait(200);
    fbZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const fbArtefakt1 = Array.from(fbZeilen[fbIdx1].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Broken Halo'));
    const fbArtefakt2 = Array.from(fbZeilen[fbIdx2].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Broken Halo'));
    check('Ohne Alternative wird trotzdem dupliziert statt leer zu bleiben', fbArtefakt1 && fbArtefakt1.value === 'Broken Halo' && fbArtefakt2 && fbArtefakt2.value === 'Broken Halo', [fbArtefakt1 && fbArtefakt1.value, fbArtefakt2 && fbArtefakt2.value]);
    win.gpRemoveRow(neueGruppeIdx, fbIdx2); await wait(50);
    win.gpRemoveRow(neueGruppeIdx, fbIdx1); await wait(50);

    // Seit v0.28.0 (Nutzerwunsch "extra angehakt darf es doppelt sein"):
    // "Mehrfachvergabe erlaubt"-Checkbox in der Referenzliste - markierte
    // Einträge werden NIE als "bereits vergeben" gezählt, dürfen also
    // beliebig oft im Plan vorkommen (hier: zwei DPS-Zeilen, deren einziges
    // Artefakt "Broken Halo" ist, jetzt als mehrfach-erlaubt markiert -
    // beide sollen es unverändert bekommen, ohne auf eine Alternative
    // auszuweichen).
    win.showGpPage('referenz'); await wait(300);
    const refArtefakteTableMehrfach = doc.getElementById('gpref-gpArtefakte');
    const brokenHaloMehrfachCb = Array.from(refArtefakteTableMehrfach.querySelectorAll('tbody tr')).find(tr => tr.querySelector('input[data-field="name"]').value === 'Broken Halo')?.querySelector('input[data-field="mehrfachErlaubt"]');
    check('Referenzlisten: Artefakte haben eine "Mehrfachvergabe erlaubt"-Checkbox', !!brokenHaloMehrfachCb);
    if(brokenHaloMehrfachCb){ brokenHaloMehrfachCb.checked = true; brokenHaloMehrfachCb.dispatchEvent(new win.Event('change', { bubbles: true })); }
    // Seit v0.28.0: editierbare Optimierungsregeln (Rollen je Kategorie) am
    // Ende der Referenzlisten-Seite - hier unverändert mitgespeichert, nur
    // die Anwesenheit wird geprüft (Verhalten separat unten getestet).
    const regelCheckbox = doc.querySelector('input[data-gpregel="mounts"][data-gpregelrolle="tank"]');
    check('Referenzlisten: Optimierungsregeln-Bereich mit editierbaren Rollen-Checkboxen vorhanden', !!regelCheckbox && regelCheckbox.checked);
    await win.gpSaveReferenzlisten(); await wait(300);
    const sharedNachMehrfach = (await api('/api/shared')).data;
    const brokenHaloGespeichert = (sharedNachMehrfach.gpArtefakte || []).find(e => e.name === 'Broken Halo');
    check('"Mehrfachvergabe erlaubt" wird gespeichert', brokenHaloGespeichert && brokenHaloGespeichert.mehrfachErlaubt === true, brokenHaloGespeichert);
    check('Optimierungsregeln werden mitgespeichert', sharedNachMehrfach.gpOptimizerRegeln && sharedNachMehrfach.gpOptimizerRegeln.mounts && sharedNachMehrfach.gpOptimizerRegeln.mounts.tank === true, sharedNachMehrfach.gpOptimizerRegeln);

    win.showGpPage('planung'); await wait(200);
    win.renderGpPlanBoard(); await wait(200);
    r = await api('/api/gp/characters/DupChar1', { method: 'PUT', body: JSON.stringify({
      klasse: 'Waldläufer', rollen: { dps: true, heal: false, tank: false }, besitz: { artefakte: ['Broken Halo'] },
    }) }, token);
    r = await api('/api/gp/characters/DupChar2', { method: 'PUT', body: JSON.stringify({
      klasse: 'Waldläufer', rollen: { dps: true, heal: false, tank: false }, besitz: { artefakte: ['Broken Halo'] },
    }) }, token);
    await win.ensureGpCharactersLoaded(true); await wait(200);
    win.gpAddRow(neueGruppeIdx, 'DPS'); await wait(50);
    win.gpAddRow(neueGruppeIdx, 'DPS'); await wait(100);
    let mfZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const mfIdx1 = mfZeilen.length - 2, mfIdx2 = mfZeilen.length - 1;
    win.gpResolveRowSpieler(neueGruppeIdx, mfIdx1, `DupChar1 (${user})`); await wait(50);
    win.gpResolveRowSpieler(neueGruppeIdx, mfIdx2, `DupChar2 (${user})`); await wait(100);
    const mfOptiBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('.btnrow button')).find(b => b.textContent.includes('Alle Zeilen optimieren'));
    if(mfOptiBtn) mfOptiBtn.click();
    await wait(200);
    mfZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const mfArtefakt1 = Array.from(mfZeilen[mfIdx1].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Broken Halo'));
    const mfArtefakt2 = Array.from(mfZeilen[mfIdx2].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Broken Halo'));
    check('Als "Mehrfachvergabe erlaubt" markierte Werte werden problemlos dupliziert', mfArtefakt1 && mfArtefakt1.value === 'Broken Halo' && mfArtefakt2 && mfArtefakt2.value === 'Broken Halo', [mfArtefakt1 && mfArtefakt1.value, mfArtefakt2 && mfArtefakt2.value]);
    win.gpRemoveRow(neueGruppeIdx, mfIdx2); await wait(50);
    win.gpRemoveRow(neueGruppeIdx, mfIdx1); await wait(50);

    // Deaktiviert: Mount-Optimierung für Tank ausschalten -> ein Tank-Charakter
    // bekommt beim Optimieren keinen Mount mehr zugewiesen.
    win.showGpPage('referenz'); await wait(200);
    const regelTankMountCb = doc.querySelector('input[data-gpregel="mounts"][data-gpregelrolle="tank"]');
    regelTankMountCb.checked = false; regelTankMountCb.dispatchEvent(new win.Event('change', { bubbles: true }));
    await win.gpSaveReferenzlisten(); await wait(300);
    win.showGpPage('planung'); await wait(200);
    win.renderGpPlanBoard(); await wait(200);
    win.gpAddRow(neueGruppeIdx, 'Tank'); await wait(100);
    let regelZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const regelIdx = regelZeilen.length - 1;
    win.gpResolveRowSpieler(neueGruppeIdx, regelIdx, `DupChar1 (${user})`); // dps:true, aber Rolle jetzt Tank -> würde eigentlich abgelehnt
    await wait(100);
    // DupChar1 ist nur dps:true - für einen sauberen Test hier stattdessen
    // TankMax (nur tank:true) verwenden, das zur Zeilen-Rolle passt.
    win.gpResolveRowSpieler(neueGruppeIdx, regelIdx, `TankMax (${user})`); await wait(100);
    const regelOptiBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[regelIdx].querySelectorAll('button')).find(b => (b.title||'').startsWith('Bestes eigenes Setup'));
    if(regelOptiBtn) regelOptiBtn.click();
    await wait(150);
    const regelZeileNach = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[regelIdx];
    const regelMountSelect = Array.from(regelZeileNach.querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Pegasus'));
    check('Deaktivierte Optimierungsregel wird respektiert: Mount bleibt für Tank leer, wenn "Tank" abgehakt wurde', regelMountSelect && regelMountSelect.value === '', regelMountSelect && regelMountSelect.value);
    win.gpRemoveRow(neueGruppeIdx, regelIdx); await wait(50);
    // Regel wieder zurücksetzen, damit sie den Standardzustand für spätere/
    // weitere Nutzung des Systems nicht dauerhaft verändert.
    win.showGpPage('referenz'); await wait(200);
    const regelTankMountCbReset = doc.querySelector('input[data-gpregel="mounts"][data-gpregelrolle="tank"]');
    regelTankMountCbReset.checked = true; regelTankMountCbReset.dispatchEvent(new win.Event('change', { bubbles: true }));
    await win.gpSaveReferenzlisten(); await wait(300);
    win.showGpPage('planung'); await wait(200);
    win.renderGpPlanBoard(); await wait(200);

    // Seit v0.30.0 (Nutzervorgabe "max dmg, aber wenn's geht trotzdem die
    // Lieblingsartefakte höher setzen"): ein Favorit gewinnt jetzt auch gegen
    // einen leicht HÖHERWERTIGEN, nicht bevorzugten Kandidaten - solange der
    // Abstand innerhalb der (editierbaren, Default 1 Prozentpunkt) Toleranz
    // liegt. Zwei neue Test-Artefakte: "HighButNotFav" (4,5 %, 0,5 Punkte über
    // dem Favoriten -> innerhalb der Toleranz, Favorit gewinnt trotzdem) und
    // "TooHighNotFav" (6 %, 2 Punkte über dem Favoriten -> außerhalb der
    // Toleranz, der objektiv höhere Wert gewinnt wieder).
    win.showGpPage('referenz'); await wait(200);
    const refArtefakteTableTol = doc.getElementById('gpref-gpArtefakte');
    const artFieldsTol = [{key:'name',label:'Name'},{key:'buff',label:'Buff %',numeric:true},{key:'rolle',label:'Bevorzugt für',select:['','DPS','Heiler','Tank']},{key:'mehrfachErlaubt',label:'Mehrfachvergabe erlaubt',checkbox:true},{key:'pflichtProGruppe',label:'Pflicht: 1x pro 5er-Gruppe',checkbox:true}];
    win.gpAddRefRow('gpref-gpArtefakte', artFieldsTol);
    win.gpAddRefRow('gpref-gpArtefakte', artFieldsTol);
    const neueArtZeilen = Array.from(refArtefakteTableTol.querySelectorAll('tbody tr')).slice(-2);
    input(win, neueArtZeilen[0].querySelector('input[data-field="name"]'), 'HighButNotFav');
    input(win, neueArtZeilen[0].querySelector('input[data-field="buff"]'), '4,5');
    input(win, neueArtZeilen[1].querySelector('input[data-field="name"]'), 'TooHighNotFav');
    input(win, neueArtZeilen[1].querySelector('input[data-field="buff"]'), '6');
    await win.gpSaveReferenzlisten(); await wait(300);
    const sharedNachTol = (await api('/api/shared')).data;
    check('Test-Artefakte für die Toleranz-Prüfung angelegt', (sharedNachTol.gpArtefakte||[]).some(e=>e.name==='HighButNotFav'&&e.buff===4.5) && (sharedNachTol.gpArtefakte||[]).some(e=>e.name==='TooHighNotFav'&&e.buff===6), (sharedNachTol.gpArtefakte||[]).map(e=>[e.name,e.buff]));
    check('Toleranz-Feld in den Optimierungsregeln vorhanden (Default 1)', doc.getElementById('gpRegelToleranz') && doc.getElementById('gpRegelToleranz').value === '1', doc.getElementById('gpRegelToleranz') && doc.getElementById('gpRegelToleranz').value);

    win.showGpPage('planung'); await wait(200);
    win.renderGpPlanBoard(); await wait(200);
    r = await api('/api/gp/characters/OptiChar', { method: 'PUT', body: JSON.stringify({
      klasse: 'Waldläufer', rollen: { dps: true, heal: false, tank: false },
      besitz: { artefakte: ["Marco's Mystic Marker", 'HighButNotFav'], mounts: [], gefaehrten: [] },
      lieblingsartefakte: ["Marco's Mystic Marker"],
    }) }, token);
    await win.ensureGpCharactersLoaded(true); await wait(200);
    win.gpResolveRowSpieler(neueGruppeIdx, 0, ''); await wait(100);
    win.gpResolveRowSpieler(neueGruppeIdx, 0, `OptiChar (${user})`); await wait(100);
    let tolBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0].querySelectorAll('button')).find(b => (b.title||'').startsWith('Bestes eigenes Setup'));
    if(tolBtn) tolBtn.click();
    await wait(150);
    let tolZeile = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0];
    let tolSelect = Array.from(tolZeile.querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'HighButNotFav'));
    check('Favorit gewinnt INNERHALB der Toleranz gegen einen leicht höherwertigen Nicht-Favoriten (0,5 Punkte Abstand)', tolSelect && tolSelect.value === "Marco's Mystic Marker", tolSelect && tolSelect.value);

    r = await api('/api/gp/characters/OptiChar', { method: 'PUT', body: JSON.stringify({
      klasse: 'Waldläufer', rollen: { dps: true, heal: false, tank: false },
      besitz: { artefakte: ["Marco's Mystic Marker", 'TooHighNotFav'], mounts: [], gefaehrten: [] },
      lieblingsartefakte: ["Marco's Mystic Marker"],
    }) }, token);
    await win.ensureGpCharactersLoaded(true); await wait(200);
    win.gpResolveRowSpieler(neueGruppeIdx, 0, ''); await wait(100);
    win.gpResolveRowSpieler(neueGruppeIdx, 0, `OptiChar (${user})`); await wait(100);
    tolBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0].querySelectorAll('button')).find(b => (b.title||'').startsWith('Bestes eigenes Setup'));
    if(tolBtn) tolBtn.click();
    await wait(150);
    tolZeile = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0];
    tolSelect = Array.from(tolZeile.querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'TooHighNotFav'));
    check('Max Dmg gewinnt wieder AUSSERHALB der Toleranz (2 Punkte Abstand, über der Toleranz von 1)', tolSelect && tolSelect.value === 'TooHighNotFav', tolSelect && tolSelect.value);

    // Seit v0.31.0 (Nutzerbeispiel "Xselli hat Nightflame als Favorit, wird
    // aber Serafin - der gar keinen Favoriten eingestellt hat, weil kein
    // erstellter Charakter - zugeteilt"): der Favorit eines Charakters darf
    // nicht von einer ANDEREN Zeile (v. a. freien Namen) weggeschnappt
    // werden, selbst wenn der eigene Charakter ihn wegen der Toleranz gar
    // nicht selbst wählt. "ProtArt1" (5 %, Favorit von FavProtA) liegt 1,5
    // Punkte unter "ProtArt2" (6,5 %) - außerhalb der Default-Toleranz (1) -
    // FavProtA wählt also selbst ProtArt2, NICHT den eigenen Favoriten. Ein
    // freier Name im selben Plan darf ProtArt1 trotzdem nicht bekommen.
    win.showGpPage('referenz'); await wait(200);
    const refArtefakteTableProt = doc.getElementById('gpref-gpArtefakte');
    win.gpAddRefRow('gpref-gpArtefakte', artFieldsTol);
    win.gpAddRefRow('gpref-gpArtefakte', artFieldsTol);
    const neueArtZeilenProt = Array.from(refArtefakteTableProt.querySelectorAll('tbody tr')).slice(-2);
    input(win, neueArtZeilenProt[0].querySelector('input[data-field="name"]'), 'ProtArt1');
    input(win, neueArtZeilenProt[0].querySelector('input[data-field="buff"]'), '5');
    input(win, neueArtZeilenProt[1].querySelector('input[data-field="name"]'), 'ProtArt2');
    input(win, neueArtZeilenProt[1].querySelector('input[data-field="buff"]'), '6,5');
    await win.gpSaveReferenzlisten(); await wait(300);
    win.showGpPage('planung'); await wait(200);
    win.renderGpPlanBoard(); await wait(200);
    r = await api('/api/gp/characters', { method: 'POST', body: JSON.stringify({ name: 'FavProtA' }) }, token);
    r = await api('/api/gp/characters/FavProtA', { method: 'PUT', body: JSON.stringify({
      klasse: 'Waldläufer', rollen: { dps: true, heal: false, tank: false },
      besitz: { artefakte: ['ProtArt1', 'ProtArt2'] }, lieblingsartefakte: ['ProtArt1'],
    }) }, token);
    check('Favoriten-Schutz-Test: FavProtA angelegt (Favorit ProtArt1, eigener Bestwert wäre aber ProtArt2)', r.status === 200, r.status);
    await win.ensureGpCharactersLoaded(true); await wait(200);
    win.gpAddRow(neueGruppeIdx, 'DPS'); await wait(50);
    win.gpAddRow(neueGruppeIdx, 'DPS'); await wait(100);
    let protZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const protIdxA = protZeilen.length - 2, protIdxFree = protZeilen.length - 1;
    win.gpResolveRowSpieler(neueGruppeIdx, protIdxA, `FavProtA (${user})`); await wait(50);
    const protFreeFeld = protZeilen[protIdxFree].querySelector('input[list="gpCharDatalist"]');
    protFreeFeld.value = 'Gastspieler Protschutz';
    protFreeFeld.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(100);
    const protOptiBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('.btnrow button')).find(b => b.textContent.includes('Alle Zeilen optimieren'));
    if(protOptiBtn) protOptiBtn.click();
    await wait(200);
    protZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const protArtefaktA = Array.from(protZeilen[protIdxA].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'ProtArt1'));
    const protArtefaktFree = Array.from(protZeilen[protIdxFree].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'ProtArt1'));
    check('FavProtA wählt wegen der Toleranz-Grenze selbst den objektiv besseren ProtArt2 (nicht den eigenen Favoriten)', protArtefaktA && protArtefaktA.value === 'ProtArt2', protArtefaktA && protArtefaktA.value);
    check('Freier Name bekommt NICHT den Favoriten eines anderen Charakters, obwohl der ihn selbst gar nicht gewählt hat', protArtefaktFree && protArtefaktFree.value !== 'ProtArt1', protArtefaktFree && protArtefaktFree.value);
    win.gpRemoveRow(neueGruppeIdx, protIdxFree); await wait(50);
    win.gpRemoveRow(neueGruppeIdx, protIdxA); await wait(50);

    // Seit v0.28.0: "Alle Gruppen optimieren"-Knopf nur ab 2 Gruppen im Plan
    // sichtbar (Trial mit 2 Untergruppen oder mehrere Dungeon-Gruppen) - der
    // aktuell offene Plan hat an dieser Stelle bereits 2 Gruppen ("Gruppe 1"
    // + die weiter oben angelegte "Neue Gruppe"), der Knopf muss also da sein.
    check('"Alle Gruppen optimieren"-Knopf ab 2 Gruppen im Plan vorhanden', gpCards().length > 1 && Array.from(doc.querySelectorAll('#gpPlanBoard .btnrow button')).some(b => b.textContent.includes('Alle Gruppen optimieren')), gpCards().length);

    // Seit v0.29.0 (Nutzerwunsch "in der geöffneten Gruppe einen Button um
    // Ausrüstung zurückzusetzen"): setzt Artefakt/Mount/Mount-Bonus/Gefährte/
    // Gefährten-Bonus aller Zeilen der Gruppe auf "-" zurück, Rolle und
    // Spieler-Zuweisung bleiben unangetastet.
    win.gpUpdateRowField(neueGruppeIdx, 0, 'artefakt', 'Tentacle Rod'); win.renderGpPlanBoard(); await wait(100);
    const spielerVorReset = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0].querySelector('input[list="gpCharDatalist"]').value;
    const resetBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('.entry-head button')).find(b => b.textContent.includes('Ausrüstung zurücksetzen'));
    check('"Ausrüstung zurücksetzen"-Knopf im Gruppen-Header vorhanden', !!resetBtn);
    win.confirm = () => true;
    if(resetBtn) resetBtn.click();
    await wait(150);
    const zeileNachReset = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr')[0];
    const spielerNachReset = zeileNachReset.querySelector('input[list="gpCharDatalist"]').value;
    const artefaktNachReset = Array.from(zeileNachReset.querySelectorAll('select')).find(sel => (sel.getAttribute('onchange')||'').includes("'artefakt'"));
    check('"Ausrüstung zurücksetzen" leert Artefakt/Mount/etc. aller Zeilen', artefaktNachReset && artefaktNachReset.value === '', artefaktNachReset && artefaktNachReset.value);
    check('"Ausrüstung zurücksetzen" lässt die Spieler-Zuweisung unangetastet', spielerNachReset === spielerVorReset, [spielerVorReset, spielerNachReset]);

    // Seit v0.29.0 (Nutzerbeispiel "der Skorpion soll immer einmal
    // ausgerüstet sein pro Gruppe (5er)"): "Pflicht: 1x pro 5er-Gruppe" hat
    // Vorrang vor der sonstigen Bestwert-Optimierung. Isolierter Test: zwei
    // frische Charaktere, die JEWEILS einen eigenen, klar höherwertigen
    // Gefährten besitzen (TestGefA/TestGefB, Buff weit über allem sonst) -
    // OHNE Pflicht-Regel würde Skorpion nie natürlich gewählt (jeder hat
    // seinen eigenen klar besseren Favoriten, kein Anti-Duplikat-Konflikt
    // zwingt zum Ausweichen). Mit Pflicht muss trotzdem GENAU eine der
    // beiden Zeilen Skorpion bekommen.
    let sharedVorPflicht = (await api('/api/shared')).data;
    win.showGpPage('referenz'); await wait(300);
    const refGefTablePflicht = doc.getElementById('gpref-gpGefaehrten');
    const gefFieldsPflicht = [{key:'name',label:'Name'},{key:'beschreibung',label:'Beschreibung'},{key:'buff',label:'Dmg Buff % (Support)',numeric:true},{key:'schaden',label:'Schaden (DPS)',numeric:true},{key:'mehrfachErlaubt',label:'Mehrfachvergabe erlaubt',checkbox:true},{key:'pflichtProGruppe',label:'Pflicht: 1x pro 5er-Gruppe',checkbox:true}];
    win.gpAddRefRow('gpref-gpGefaehrten', gefFieldsPflicht);
    win.gpAddRefRow('gpref-gpGefaehrten', gefFieldsPflicht);
    const neueGefZeilen = Array.from(refGefTablePflicht.querySelectorAll('tbody tr')).slice(-2);
    input(win, neueGefZeilen[0].querySelector('input[data-field="name"]'), 'TestGefA');
    input(win, neueGefZeilen[0].querySelector('input[data-field="buff"]'), '99');
    input(win, neueGefZeilen[1].querySelector('input[data-field="name"]'), 'TestGefB');
    input(win, neueGefZeilen[1].querySelector('input[data-field="buff"]'), '98');
    const skorpionPflichtCb = Array.from(refGefTablePflicht.querySelectorAll('tbody tr')).find(tr => tr.querySelector('input[data-field="name"]').value === 'Skorpion')?.querySelector('input[data-field="pflichtProGruppe"]');
    check('Referenzlisten: Gefährten haben eine "Pflicht: 1x pro 5er-Gruppe"-Checkbox', !!skorpionPflichtCb);
    if(skorpionPflichtCb){ skorpionPflichtCb.checked = true; skorpionPflichtCb.dispatchEvent(new win.Event('change', { bubbles: true })); }
    await win.gpSaveReferenzlisten(); await wait(300);
    const sharedNachPflicht = (await api('/api/shared')).data;
    const skorpionGespeichertPflicht = (sharedNachPflicht.gpGefaehrten || []).find(e => e.name === 'Skorpion');
    check('"Pflicht: 1x pro 5er-Gruppe" wird gespeichert', skorpionGespeichertPflicht && skorpionGespeichertPflicht.pflichtProGruppe === true, skorpionGespeichertPflicht);
    check('TestGefA/TestGefB wurden über die Referenzliste angelegt', (sharedNachPflicht.gpGefaehrten||[]).some(e=>e.name==='TestGefA'&&e.buff===99) && (sharedNachPflicht.gpGefaehrten||[]).some(e=>e.name==='TestGefB'&&e.buff===98), (sharedNachPflicht.gpGefaehrten||[]).map(e=>[e.name,e.buff]));
    win.showGpPage('planung'); await wait(200);
    win.renderGpPlanBoard(); await wait(200);
    r = await api('/api/gp/characters', { method: 'POST', body: JSON.stringify({ name: 'PflichtCharA' }) }, token);
    r = await api('/api/gp/characters/PflichtCharA', { method: 'PUT', body: JSON.stringify({ klasse:'Kleriker', rollen:{dps:false,heal:true,tank:false}, besitz:{ gefaehrten:['Skorpion','TestGefA'] } }) }, token);
    r = await api('/api/gp/characters', { method: 'POST', body: JSON.stringify({ name: 'PflichtCharB' }) }, token);
    r = await api('/api/gp/characters/PflichtCharB', { method: 'PUT', body: JSON.stringify({ klasse:'Kleriker', rollen:{dps:false,heal:true,tank:false}, besitz:{ gefaehrten:['Skorpion','TestGefB'] } }) }, token);
    check('Pflicht-Test: PflichtCharA/PflichtCharB angelegt', r.status === 200, r.status);
    await win.ensureGpCharactersLoaded(true); await wait(300);
    win.showGpPage('planung'); await wait(200);
    win.renderGpPlanBoard(); await wait(200);
    // Zeile 0 (OptiChar) ist ebenfalls Teil desselben 5er-Segments (Dungeon-
    // Gruppe) und besitzt zufällig auch Skorpion mit leerem Gefährten-Feld
    // (vom "Ausrüstung zurücksetzen"-Test kurz zuvor) - würde die Pflicht-
    // Zuteilung sonst an sich ziehen, bevor die eigentlichen Test-Zeilen
    // überhaupt geprüft werden. Hier bewusst mit einem eigenen Wert befüllt,
    // damit der Test sauber auf PflichtCharA/PflichtCharB fokussiert bleibt.
    win.gpUpdateRowField(neueGruppeIdx, 0, 'gefaehrte', 'Flapjack');
    win.gpAddRow(neueGruppeIdx, 'Heiler'); await wait(50);
    win.gpAddRow(neueGruppeIdx, 'Heiler'); await wait(100);
    let pflichtZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const pflichtIdxA = pflichtZeilen.length - 2, pflichtIdxB = pflichtZeilen.length - 1;
    win.gpResolveRowSpieler(neueGruppeIdx, pflichtIdxA, `PflichtCharA (${user})`); await wait(50);
    win.gpResolveRowSpieler(neueGruppeIdx, pflichtIdxB, `PflichtCharB (${user})`); await wait(100);
    const pflichtOptiBtn = Array.from(gpCards()[neueGruppeIdx].querySelectorAll('.btnrow button')).find(b => b.textContent.includes('Alle Zeilen optimieren'));
    if(pflichtOptiBtn) pflichtOptiBtn.click();
    await wait(200);
    pflichtZeilen = gpCards()[neueGruppeIdx].querySelectorAll('tbody tr');
    const pflichtGefA = Array.from(pflichtZeilen[pflichtIdxA].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Skorpion'));
    const pflichtGefB = Array.from(pflichtZeilen[pflichtIdxB].querySelectorAll('select')).find(sel => Array.from(sel.options).some(o => o.value === 'Skorpion'));
    const pflichtWerte = [pflichtGefA && pflichtGefA.value, pflichtGefB && pflichtGefB.value];
    check('Pflicht-Regel: genau eine der beiden Zeilen bekommt Skorpion, obwohl beide eigentlich ihren eigenen höherwertigen Gefährten bevorzugen würden', pflichtWerte.includes('Skorpion') && pflichtWerte.filter(v=>v==='Skorpion').length === 1, pflichtWerte);
    check('Pflicht-Regel: die ANDERE Zeile behält trotzdem ihren eigenen (höherwertigen) Gefährten', (pflichtWerte[0]==='Skorpion'?pflichtWerte[1]==='TestGefB':pflichtWerte[0]==='TestGefA'), pflichtWerte);
    win.gpRemoveRow(neueGruppeIdx, pflichtIdxB); await wait(50);
    win.gpRemoveRow(neueGruppeIdx, pflichtIdxA); await wait(50);
    // Mit nur einer verbleibenden Gruppe muss der Knopf wieder verschwinden.
    while(gpCards().length > 1){ win.gpRemoveGroup(gpCards().length - 1); await wait(50); }
    check('"Alle Gruppen optimieren"-Knopf verschwindet wieder bei nur einer Gruppe', !Array.from(doc.querySelectorAll('#gpPlanBoard .btnrow button')).some(b => b.textContent.includes('Alle Gruppen optimieren')), gpCards().length);

    win.showApp('insignien'); await wait(300);
    const insStart = doc.getElementById('insStart'), insZiel = doc.getElementById('insZiel'), insMenge = doc.getElementById('insMenge'), insPulver = doc.getElementById('insPulver');
    check('Insignienrechner: eigener Titel/Untertitel', doc.getElementById('mainTitle').textContent === 'Insignienrechner' && !doc.getElementById('mainSubtitle').textContent.includes('grün markierten Feldern'));

    // Kernbug aus der Meldung: Eingabefelder durften beim Tippen NICHT neu erzeugt
    // werden (sonst geht der Fokus nach jeder Ziffer verloren). Marker am Element
    // setzen, mehrere Ziffern eintippen, danach prüfen ob dasselbe DOM-Element
    // (mit Marker) noch da ist statt eines frisch gebauten.
    insMenge._focusTestMarker = 'unveraendert';
    ['1','12','123'].forEach(v=>{ insMenge.value = v; insMenge.dispatchEvent(new win.Event('input', { bubbles: true })); });
    await wait(50);
    check('Insignienrechner: Eingabefeld bleibt beim Tippen dasselbe Element (kein Fokus-Verlust)', doc.getElementById('insMenge')._focusTestMarker === 'unveraendert' && doc.getElementById('insMenge').value === '123');
    insMenge.value = '1'; insMenge.dispatchEvent(new win.Event('input', { bubbles: true })); await wait(50);

    // Nutzer-Referenzbeispiel: mystisch -> celestisch (1 Stufe, kostet 2500 Pulver),
    // 1 Stück, ohne vorhandenes Pulver: 1250 grüne Insignien nötig (2500 / 2 Pulver-
    // Ertrag pro grün) - exakt der vom Nutzer bestätigte Wert.
    insStart.value = 'mystisch'; insStart.dispatchEvent(new win.Event('change', { bubbles: true }));
    insZiel.value = 'celestisch'; insZiel.dispatchEvent(new win.Event('change', { bubbles: true }));
    insMenge.value = '1'; insMenge.dispatchEvent(new win.Event('input', { bubbles: true }));
    insPulver.value = '0'; insPulver.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(150);
    let insText = doc.getElementById('insignienContent').textContent;
    check('Insignienrechner: Pulver-Bedarf mystisch->celestisch = 2.500', insText.includes('2.500'), insText.slice(0, 300));
    check('Insignienrechner: Referenzbeispiel 1.250 grün (Nutzer-bestätigt)', insText.includes('1.250'), insText.slice(0, 600));

    // Kosten der Start-Insignie(n) sind standardmäßig NICHT in "Gesamt" eingerechnet
    // (Nutzerwunsch) - erst nach Ankreuzen der Checkbox ändern sich die Zahlen.
    const mitStartkostenCb = doc.getElementById('insMitStartkosten');
    check('Insignienrechner: Startkosten-Checkbox ist standardmäßig AUS', mitStartkostenCb && mitStartkostenCb.checked === false);
    let ohneStartkostenText = doc.getElementById('insignienContent').textContent;
    check('Insignienrechner: ohne Startkosten zeigt grün-Gesamt 2.375.000', ohneStartkostenText.includes('2.375.000'), ohneStartkostenText.slice(0, 500));
    mitStartkostenCb.checked = true; mitStartkostenCb.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(150);
    const mitStartkostenText = doc.getElementById('insignienContent').textContent;
    check('Insignienrechner: mit Startkosten zeigt grün-Gesamt 3.525.000 (2.375.000 + 1.150.000)', mitStartkostenText.includes('3.525.000'), mitStartkostenText.slice(0, 500));
    mitStartkostenCb.checked = false; mitStartkostenCb.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(150);

    // Mehrstufige Kette (grün -> legendär, 3 Zwischenstufen: 10+50+250=310 Pulver/Stück)
    // muss additiv sein, NICHT multiplikativ (das war der gemeldete Fehler) - ein
    // realistischer dreistelliger Pulver-Wert statt Millionen/Milliarden.
    insStart.value = 'grün'; insStart.dispatchEvent(new win.Event('change', { bubbles: true }));
    insZiel.value = 'legendär'; insZiel.dispatchEvent(new win.Event('change', { bubbles: true }));
    insMenge.value = '1'; insMenge.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(150);
    insText = doc.getElementById('insignienContent').textContent;
    check('Insignienrechner: mehrstufige Kette addiert (310), nicht multipliziert', insText.includes('310'), insText.slice(0, 300));
    check('Insignienrechner: mehrstufige Kette bleibt realistisch klein (keine Millionen)', !insText.slice(0, 300).match(/\d{1,3}\.\d{3}\.\d{3}/));

    // Vorhandenes Pulver reduziert den Bedarf: bei mystisch->celestisch (2500 nötig)
    // mit 2000 vorhanden bleiben 500 fehlend.
    insStart.value = 'mystisch'; insStart.dispatchEvent(new win.Event('change', { bubbles: true }));
    insZiel.value = 'celestisch'; insZiel.dispatchEvent(new win.Event('change', { bubbles: true }));
    insMenge.value = '1'; insMenge.dispatchEvent(new win.Event('input', { bubbles: true }));
    insPulver.value = '2000'; insPulver.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(150);
    check('Insignienrechner: vorhandenes Pulver reduziert den Fehlbetrag (500)', doc.getElementById('insignienContent').textContent.includes('500'));
    insPulver.value = '999999'; insPulver.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(150);
    check('Insignienrechner: mehr als genug Pulver -> Hinweis statt negativer Zahl', doc.getElementById('insignienContent').textContent.includes('genug vorhanden'));

    // Getrennte AH-/Direktkaufpreise bleiben unabhängig editierbar (v0.15.1-Fix).
    const ahInput = doc.querySelector('input[data-insprice="celestisch"][data-field="ah"]');
    const direktInput = doc.querySelector('input[data-insprice="celestisch"][data-field="direkt"]');
    check('Insignienrechner: AH-Preis und Direktkaufpreis sind unabhängige Felder', ahInput && direktInput && ahInput.value !== direktInput.value, ahInput && direktInput && [ahInput.value, direktInput.value]);
    // Direktkauf-Feld sitzt in der Fazit-Zeile - darf beim Tippen ebenfalls nicht neu erzeugt werden.
    direktInput._focusTestMarker = 'unveraendert';
    ['1','12','123'].forEach(v=>{ direktInput.value = v; direktInput.dispatchEvent(new win.Event('input', { bubbles: true })); });
    await wait(50);
    const direktInputWieder = doc.querySelector('input[data-insprice="celestisch"][data-field="direkt"]');
    check('Insignienrechner: Direktkauf-Feld in der Fazit-Zeile bleibt beim Tippen dasselbe Element', direktInputWieder._focusTestMarker === 'unveraendert' && direktInputWieder.value === '123');

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
