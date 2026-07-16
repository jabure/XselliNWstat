// Xselli's Stats-Rechner – einfacher Server
// -------------------------------------------------
// Bewusst simpel gehalten: keine Datenbank, kein Build-Schritt, keine
// nativen Abhängigkeiten. Speichert alles als JSON-Dateien unter DATA_DIR.
// Das reicht für eine Gilde/Gruppe locker aus und braucht kaum RAM/CPU.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bitte-in-der-.env-aendern';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CHAR_DIR = path.join(DATA_DIR, 'chars');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SHARED_FILE = path.join(DATA_DIR, 'shared.json');

if(JWT_SECRET === 'bitte-in-der-.env-aendern'){
  console.warn('WARNUNG: JWT_SECRET wurde nicht gesetzt - bitte in der .env auf einen langen, zufälligen Wert ändern!');
}

fs.mkdirSync(CHAR_DIR, { recursive: true });
if(!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
if(!fs.existsSync(SHARED_FILE)) fs.writeFileSync(SHARED_FILE, '{}');

function readJson(file, fallback){
  try{ return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch(e){ return fallback; }
}
function writeJson(file, data){
  // Erst in eine Temp-Datei schreiben, dann umbenennen - vermeidet kaputte
  // Dateien, falls der Server genau während des Schreibens neu startet.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
function safeName(s){
  return String(s).replace(/[^a-zA-Z0-9_\-äöüÄÖÜß]/g, '_').slice(0, 80);
}
function charFile(username, charname){
  return path.join(CHAR_DIR, `${safeName(username)}__${safeName(charname)}.json`);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

const PKG_VERSION = require('./package.json').version;
app.get('/api/version', (req, res) => {
  res.json({ version: PKG_VERSION });
});

function authMiddleware(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if(!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    req.username = payload.username;
    next();
  }catch(e){
    return res.status(401).json({ error: 'Login abgelaufen, bitte neu anmelden' });
  }
}

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Xselli';

// Rollen-Hierarchie: höhere Rolle hat automatisch auch die Rechte der niedrigeren.
// moderator: Gefährten/Reittiere/Buff Food | coadmin: zusätzlich Formeln | admin: zusätzlich Benutzerübersicht
const ROLE_RANK = { user: 0, moderator: 1, coadmin: 2, admin: 3 };
const VALID_ROLES = Object.keys(ROLE_RANK);

function getUserRole(username){
  if(username === ADMIN_USERNAME) return 'admin'; // Bootstrap-Admin, auch für Bestandskonten ohne gespeicherte Rolle
  const users = readJson(USERS_FILE, {});
  const user = users[username];
  if(!user) return 'user';
  if(VALID_ROLES.includes(user.role)) return user.role;
  if(user.isAdmin === true) return 'admin'; // Migration: Konten aus der Vorgänger-Version (nur isAdmin-Flag)
  return 'user';
}
function hasRole(username, minRole){
  return ROLE_RANK[getUserRole(username)] >= ROLE_RANK[minRole];
}
function requireRole(minRole){
  return (req, res, next) => {
    if(!hasRole(req.username, minRole)){
      return res.status(403).json({ error: `Dafür brauchst du mindestens die Rolle "${minRole}"` });
    }
    next();
  };
}

/* ---------- Auth ---------- */
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if(!username || !password || username.length < 2 || password.length < 4){
    return res.status(400).json({ error: 'Benutzername (min. 2 Zeichen) und Passwort (min. 4 Zeichen) erforderlich' });
  }
  const users = readJson(USERS_FILE, {});
  if(users[username]) return res.status(409).json({ error: 'Benutzername bereits vergeben' });
  const passwordHash = await bcrypt.hash(password, 10);
  // Wer sich mit exakt dem Namen aus ADMIN_USERNAME registriert, wird automatisch
  // zum ersten Admin. Weitere Rollen kann dieser danach über die Benutzerübersicht vergeben.
  const role = username === ADMIN_USERNAME ? 'admin' : 'user';
  users[username] = { passwordHash, characters: [], role };
  writeJson(USERS_FILE, users);
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '90d' });
  res.status(201).json({ token, username, role });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const users = readJson(USERS_FILE, {});
  const user = users[username];
  if(!user) return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if(!ok) return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '90d' });
  res.json({ token, username, role: getUserRole(username) });
});

/* ---------- Charaktere (pro Benutzer, benötigt Login) ---------- */
app.get('/api/me', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  res.json({ username: req.username, role: getUserRole(req.username), characters: (user && user.characters) || [] });
});

// Liefert zu einem Charakter die Kurzinfos (Klasse/Vorbildpfad) aus seinen Daten,
// damit die Auswahlliste im Frontend mehr als nur den Namen zeigen kann.
function charSummary(username, name){
  const data = readJson(charFile(username, name), {});
  const g = data.grunddaten || {};
  return { name, klasse: g.klasse || '', vorbildpfad: g.vorbildpfad || '', klassentyp: g.klassentyp || '' };
}

app.get('/api/characters', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  const names = (user && user.characters) || [];
  res.json(names.map(n => charSummary(req.username, n)));
});

// Prüft, ob der Charaktername schon von IRGENDEINEM Benutzer verwendet wird
// (nicht nur vom aktuellen) - so kann derselbe Charaktername nie zwei
// verschiedenen Leuten gehören. Groß-/Kleinschreibung wird dabei ignoriert.
function isCharNameTakenByOther(name, ownUsername){
  const users = readJson(USERS_FILE, {});
  const lower = name.trim().toLowerCase();
  return Object.keys(users).some(u =>
    u !== ownUsername && (users[u].characters || []).some(c => c.toLowerCase() === lower)
  );
}

app.post('/api/characters', authMiddleware, (req, res) => {
  const { name, copyFrom } = req.body || {};
  if(!name || !name.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  if(user.characters.includes(name)) return res.status(409).json({ error: 'Diesen Charakter gibt es schon' });
  if(isCharNameTakenByOther(name, req.username)){
    return res.status(409).json({ error: 'Dieser Charaktername ist bereits von einem anderen Benutzer vergeben' });
  }
  // Optional: Daten eines eigenen vorhandenen Charakters übernehmen (Kopie).
  let initialData = {};
  if(copyFrom){
    if(!user.characters.includes(copyFrom)) return res.status(404).json({ error: 'Vorlage-Charakter nicht gefunden' });
    initialData = readJson(charFile(req.username, copyFrom), {});
  }
  user.characters.push(name);
  writeJson(USERS_FILE, users);
  writeJson(charFile(req.username, name), initialData);
  res.status(201).json({ name });
});

app.get('/api/characters/:name', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user || !user.characters.includes(req.params.name)){
    return res.status(404).json({ error: 'Charakter nicht gefunden' });
  }
  const data = readJson(charFile(req.username, req.params.name), {});
  res.json({ name: req.params.name, data });
});

app.put('/api/characters/:name', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user || !user.characters.includes(req.params.name)){
    return res.status(404).json({ error: 'Charakter nicht gefunden' });
  }
  writeJson(charFile(req.username, req.params.name), req.body || {});
  res.json({ ok: true });
});

app.delete('/api/characters/:name', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  user.characters = user.characters.filter(c => c !== req.params.name);
  writeJson(USERS_FILE, users);
  try{ fs.unlinkSync(charFile(req.username, req.params.name)); }catch(e){ /* gab's evtl. nicht */ }
  res.json({ ok: true });
});

/* ---------- Geteilte Daten: Formeln, Presets/Datenbanken ----------
   Lesen bleibt für alle offen (jeder Charakter-Rechner braucht die
   Gefährten-/Reittier-/Buff-Food-Datenbank und die Formeln, um zu rechnen).
   Schreiben ist rollenabhängig: Presets ab Moderator, Formeln ab Coadmin. */
app.get('/api/shared', (req, res) => {
  res.json(readJson(SHARED_FILE, {}));
});
app.put('/api/shared/presets', authMiddleware, requireRole('moderator'), (req, res) => {
  const current = readJson(SHARED_FILE, {});
  const allowed = ['companionDb', 'mountDb', 'foodDb', 'foodSlots', 'gefaehrtenPresets', 'reittierPresets'];
  const patch = {};
  allowed.forEach(key => { if(req.body && key in req.body) patch[key] = req.body[key]; });
  writeJson(SHARED_FILE, Object.assign({}, current, patch));
  res.json({ ok: true });
});
app.put('/api/shared/formulas', authMiddleware, requireRole('coadmin'), (req, res) => {
  const current = readJson(SHARED_FILE, {});
  const allowed = ['formulas', 'maxPrOverrides', 'wehrVerteilung'];
  const patch = {};
  allowed.forEach(key => { if(req.body && key in req.body) patch[key] = req.body[key]; });
  writeJson(SHARED_FILE, Object.assign({}, current, patch));
  res.json({ ok: true });
});

/* ---------- Admin: Benutzerübersicht & Rollen vergeben ---------- */
app.get('/api/admin/users', authMiddleware, requireRole('admin'), (req, res) => {
  const users = readJson(USERS_FILE, {});
  const list = Object.keys(users).map(username => ({
    username,
    role: getUserRole(username),
    characters: (users[username].characters || []).map(n => charSummary(username, n)),
  }));
  res.json(list);
});
app.put('/api/admin/users/:username', authMiddleware, requireRole('admin'), (req, res) => {
  const users = readJson(USERS_FILE, {});
  const target = users[req.params.username];
  if(!target) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  const role = req.body && req.body.role;
  if(!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Ungültige Rolle' });
  target.role = role;
  writeJson(USERS_FILE, users);
  res.json({ ok: true, username: req.params.username, role });
});

// Passwort auf den Standardwert zurücksetzen (die Person sollte es danach selbst ändern).
const DEFAULT_RESET_PASSWORD = process.env.DEFAULT_RESET_PASSWORD || '123456789';
app.post('/api/admin/users/:username/reset-password', authMiddleware, requireRole('admin'), async (req, res) => {
  const users = readJson(USERS_FILE, {});
  const target = users[req.params.username];
  if(!target) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  target.passwordHash = await bcrypt.hash(DEFAULT_RESET_PASSWORD, 10);
  writeJson(USERS_FILE, users);
  res.json({ ok: true, username: req.params.username, password: DEFAULT_RESET_PASSWORD });
});

// Kompletten Account inkl. aller Charakterdaten löschen.
app.delete('/api/admin/users/:username', authMiddleware, requireRole('admin'), (req, res) => {
  const target = req.params.username;
  if(target === req.username) return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen' });
  if(target === ADMIN_USERNAME) return res.status(400).json({ error: 'Das Haupt-Admin-Konto kann nicht gelöscht werden' });
  const users = readJson(USERS_FILE, {});
  if(!users[target]) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  (users[target].characters || []).forEach(c => {
    try{ fs.unlinkSync(charFile(target, c)); }catch(e){ /* Datei gab es evtl. nicht */ }
  });
  delete users[target];
  writeJson(USERS_FILE, users);
  res.json({ ok: true });
});

// Charakter eines anderen Benutzers in den eigenen Account kopieren (zum Ansehen).
// Das Original bleibt unangetastet.
app.post('/api/admin/users/:username/characters/:charname/copy', authMiddleware, requireRole('admin'), (req, res) => {
  const source = req.params.username;
  const sourceChar = req.params.charname;
  const users = readJson(USERS_FILE, {});
  if(!users[source] || !(users[source].characters || []).includes(sourceChar)){
    return res.status(404).json({ error: 'Charakter nicht gefunden' });
  }
  const me = users[req.username];
  if(!me) return res.status(404).json({ error: 'Eigener Benutzer nicht gefunden' });

  // Eindeutigen Zielnamen finden, damit weder eigene noch fremde Namen kollidieren.
  const base = `${sourceChar} (Kopie von ${source})`;
  let target = base, i = 2;
  while(me.characters.includes(target) || isCharNameTakenByOther(target, req.username)){
    target = `${base} ${i++}`;
  }
  const data = readJson(charFile(source, sourceChar), {});
  me.characters.push(target);
  writeJson(USERS_FILE, users);
  writeJson(charFile(req.username, target), data);
  res.status(201).json({ name: target });
});

// Frontend (die eine HTML-Datei) direkt mit ausliefern - ein Container, ein Port.
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Xselli's Stats-Rechner läuft auf Port ${PORT}`);
});
