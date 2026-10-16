// XSS-Regressionstest (seit v0.56.0)
// ------------------------------------------------------------------
// Schreibt bösartige Altdaten direkt in die Datendateien (der Server nimmt manche davon
// inzwischen gar nicht mehr an, aber Bestandsdaten oder Moderator-Eingaben könnten sie
// enthalten) und prüft im Frontend (jsdom), dass alles nur als TEXT dargestellt wird.
// Voraussetzung wie beim Smoke-Test: einmalig "npm install jsdom".
// Ausführen (aus dem Repo-Hauptverzeichnis): node dev/xss_test.js
//
// Ursprünglicher Kommentar: bösartige Altdaten direkt in die Datendateien schreiben
// (der Server nimmt manche davon inzwischen gar nicht mehr an) und prüfen, dass das
// Frontend sie nur als Text darstellt.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { JSDOM } = require('jsdom');
const REPO = path.join(__dirname, '..');
const PORT = 4100 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const safeName = s => String(s).replace(/[^a-zA-Z0-9_\-äöüÄÖÜß]/g, '_').slice(0, 80);
let fail = 0;
const check = (n, c, d) => { if (c) console.log('  OK  ' + n); else { fail++; console.error('  FEHLER  ' + n + (d !== undefined ? ' -> ' + d : '')); } };
async function api(p, opts, token) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {});
  const res = await fetch(BASE + p, Object.assign({ headers }, opts || {}));
  return { status: res.status, data: await res.json().catch(() => null) };
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xss-'));
  const server = spawn('node', ['server.js'], { cwd: REPO, env: Object.assign({}, process.env, { DATA_DIR: dataDir, JWT_SECRET: 'xss-test-secret-with-enough-length-1234567890', PORT: String(PORT), ADMIN_USERNAME: 'XAdmin' }), stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { await wait(250); try { if ((await fetch(BASE + '/api/version')).ok) break; } catch (e) {} }
  try {
    const adm = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'XAdmin', password: 'adminpw' }) });
    const evilReg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'evil', password: 'evilpw' }) });
    check('Setup: Admin + evil registriert', adm.status === 201 && evilReg.status === 201);

    // Bösartige Altdaten direkt schreiben
    const PAY_IMG = '<img src=x onerror="window.__pwned=1">';
    const PAY_ATTR = 'x" onmouseover="window.__pwned=2" b="';
    const PAY_JS = "x');window.__pwned=5;//";
    const usersFile = path.join(dataDir, 'users.json');
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    users['XAdmin'].characters = [PAY_IMG, 'Normal'];
    users['evil'].characters = [PAY_IMG];
    users['<b>evilname</b>'] = { passwordHash: users['evil'].passwordHash, characters: [PAY_ATTR], role: 'user' };
    fs.writeFileSync(usersFile, JSON.stringify(users));
    const charDir = path.join(dataDir, 'chars');
    const klasseEvil = '<img src=x onerror="window.__pwned=3">';
    const cd = { grunddaten: { klasse: klasseEvil, vorbildpfad: '<svg onload="window.__pwned=7">' } };
    for (const [u, c] of [['XAdmin', PAY_IMG], ['XAdmin', 'Normal'], ['evil', PAY_IMG], ['<b>evilname</b>', PAY_ATTR]]) {
      fs.writeFileSync(path.join(charDir, `${safeName(u)}__${safeName(c)}.json`), JSON.stringify(cd));
    }
    fs.writeFileSync(path.join(dataDir, 'transfers.json'), JSON.stringify({ [PAY_ATTR]: { from: PAY_IMG, to: 'XAdmin' }, [PAY_IMG]: { from: 'evil', to: 'XAdmin' } }));
    const shared = { rev: 1, gefaehrtenPresets: { [PAY_JS]: [], [PAY_IMG]: [] }, reittierPresets: { [PAY_JS]: [] }, gegnerProfile: { [PAY_ATTR]: {}, [PAY_IMG]: {} }, companionDb: { [PAY_IMG]: {} } };
    fs.writeFileSync(path.join(dataDir, 'shared.json'), JSON.stringify(shared));

    const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'XAdmin', password: 'adminpw' }) });
    let html = fs.readFileSync(path.join(REPO, 'public/index.html'), 'utf8');
    const mathSrc = fs.readFileSync(path.join(REPO, 'public/vendor/mathjs-11.8.0.min.js'), 'utf8');
    html = html.replace(/<script src="[^"]*mathjs[^"]*"><\/script>/, () => '<script>' + mathSrc + '</script>');
    const dom = new JSDOM(html, {
      url: BASE + '/', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(w) {
        w.localStorage.setItem('xselli_token', login.data.token);
        w.localStorage.setItem('xselli_username', 'XAdmin');
        w.fetch = (u, o) => fetch(typeof u === 'string' && u.startsWith('/') ? BASE + u : u, o);
        w.confirm = () => true; w.prompt = () => null;
      },
    });
    const win = dom.window, doc = win.document;
    await wait(2500);
    const dangerous = (root, label) => {
      const bad = root.querySelectorAll('img[src="x"], svg[onload], [onerror], [onload], [onmouseover]');
      check(label + ': keine eingeschleusten Elemente/Handler', bad.length === 0, Array.from(bad).map(b => b.outerHTML.slice(0, 80)).join(' | '));
    };

    // 1) Konto-Fenster inkl. Übergabe-Angebote
    win.openAccountPanel();
    await wait(1200);
    const body = doc.getElementById('accountModalBody');
    dangerous(body, 'Konto-Fenster');
    check('Konto-Fenster zeigt den Namen als sichtbaren Text', body.textContent.includes(PAY_IMG), body.textContent.slice(0, 120));
    check('Konto-Fenster: Klasse/Vorbildpfad als Text', body.textContent.includes(klasseEvil));
    check('Übergabe-Angebot: Absender als Text', body.textContent.includes(PAY_IMG) && body.textContent.includes(PAY_ATTR));
    const acceptBtn = Array.from(body.querySelectorAll('button')).find(b => /accept|annehmen/i.test(b.textContent) || (b.getAttribute('onclick') || '').includes('acceptTransferByIndex'));
    check('Annehmen-Knopf nutzt Index statt Namen im onclick', !!acceptBtn && /^acceptTransferByIndex\(\d+\)$/.test(acceptBtn.getAttribute('onclick')), acceptBtn && acceptBtn.getAttribute('onclick'));
    const rename = body.querySelector('[onclick^="toggleRenameByIndex"]');
    if (rename) { rename.click(); await wait(100); dangerous(body, 'Umbenennen-Panel'); }

    // 2) Benutzerübersicht (Admin)
    const ov = doc.getElementById('userOverview');
    check('Benutzerübersicht-Container vorhanden', !!ov);
    await win.renderUserOverview();
    await wait(1200);
    dangerous(ov, 'Benutzerübersicht');
    check('Benutzerübersicht: HTML-Benutzername erscheint als Text', ov.textContent.includes('<b>evilname</b>'), ov.textContent.slice(0, 160));
    check('Benutzerübersicht: Charaktername erscheint als Text', ov.textContent.includes(PAY_IMG));

    // 3) Presets/Datenbank-Editoren + Preset-Knöpfe
    dangerous(doc.body, 'Gesamte Seite');
    const presetBtns = Array.from(doc.querySelectorAll('button[data-preset]'));
    check('Preset-Knöpfe tragen den Namen im data-Attribut', presetBtns.length > 0 && presetBtns.some(b => b.dataset.preset === PAY_JS), presetBtns.length);
    presetBtns.forEach(b => { try { b.click(); } catch (e) {} });
    await wait(300);
    check('Klick auf Preset-Knöpfe führt keinen eingeschleusten Code aus', win.__pwned === undefined, win.__pwned);
    check('Kein JS-Ausführungs-Marker gesetzt', win.__pwned === undefined, win.__pwned);
  } finally {
    server.kill('SIGKILL');
  }
  console.log(fail ? `\n${fail} FEHLER` : '\nAlles OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TESTFEHLER', e); process.exit(2); });
