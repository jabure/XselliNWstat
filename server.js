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
const SHARES_FILE = path.join(DATA_DIR, 'shares.json');

if(JWT_SECRET === 'bitte-in-der-.env-aendern'){
  console.warn('WARNUNG: JWT_SECRET wurde nicht gesetzt - bitte in der .env auf einen langen, zufälligen Wert ändern!');
}

fs.mkdirSync(CHAR_DIR, { recursive: true });
if(!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
if(!fs.existsSync(SHARED_FILE)) fs.writeFileSync(SHARED_FILE, '{}');
if(!fs.existsSync(SHARES_FILE)) fs.writeFileSync(SHARES_FILE, '{}');

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

/* ---------- Charakter-Freigaben (Mitbearbeiter) ----------
   Ein Charakter gehört weiterhin genau EINEM Benutzer (Datei liegt unter dessen Namen),
   kann aber für andere Benutzer als Mitbearbeiter freigegeben werden - die sehen und
   bearbeiten dann denselben Charakter (kein Konflikt-Handling, letzter Speichervorgang
   gewinnt - reicht für eine Gilde, bei der nicht mehrere gleichzeitig dieselbe Sekunde tippen). */
function shareKey(owner, charname){ return `${owner}::${charname}`; }
function getCollaborators(owner, charname){
  const shares = readJson(SHARES_FILE, {});
  return shares[shareKey(owner, charname)] || [];
}
function setCollaborators(owner, charname, list){
  const shares = readJson(SHARES_FILE, {});
  const key = shareKey(owner, charname);
  if(list.length) shares[key] = list;
  else delete shares[key];
  writeJson(SHARES_FILE, shares);
}
function removeAllSharesFor(owner, charname){
  setCollaborators(owner, charname, []);
}
function removeUserFromAllShares(username){
  const shares = readJson(SHARES_FILE, {});
  let changed = false;
  Object.keys(shares).forEach(key=>{
    if(shares[key].includes(username)){
      shares[key] = shares[key].filter(u => u !== username);
      changed = true;
    }
  });
  if(changed) writeJson(SHARES_FILE, shares);
}
// Findet, welchem Benutzer ein Charaktername gehört (Namen sind global eindeutig).
function findCharOwner(charname){
  const users = readJson(USERS_FILE, {});
  for(const uname of Object.keys(users)){
    if((users[uname].characters || []).includes(charname)) return uname;
  }
  return null;
}
function canAccessChar(username, owner, charname){
  if(username === owner) return true;
  return getCollaborators(owner, charname).includes(username);
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
  const shares = readJson(SHARES_FILE, {});
  const own = ((user && user.characters) || []).map(n => Object.assign(
    charSummary(req.username, n),
    { owner: req.username, isOwner: true, collaborators: shares[shareKey(req.username, n)] || [] }
  ));

  // Von anderen Benutzern freigegebene Charaktere dazu mischen.
  const shared = [];
  Object.keys(shares).forEach(key => {
    if(!shares[key].includes(req.username)) return;
    const sepIdx = key.indexOf('::');
    const ownerName = key.slice(0, sepIdx);
    const charName = key.slice(sepIdx + 2);
    shared.push(Object.assign(charSummary(ownerName, charName), { owner: ownerName, isOwner: false }));
  });

  res.json([...own, ...shared]);
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
  const owner = findCharOwner(req.params.name);
  if(!owner || !canAccessChar(req.username, owner, req.params.name)){
    return res.status(404).json({ error: 'Charakter nicht gefunden' });
  }
  const data = readJson(charFile(owner, req.params.name), {});
  res.json({ name: req.params.name, data, owner, isOwner: owner === req.username });
});

app.put('/api/characters/:name', authMiddleware, (req, res) => {
  const owner = findCharOwner(req.params.name);
  if(!owner || !canAccessChar(req.username, owner, req.params.name)){
    return res.status(404).json({ error: 'Charakter nicht gefunden' });
  }
  writeJson(charFile(owner, req.params.name), req.body || {});
  res.json({ ok: true });
});

app.delete('/api/characters/:name', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  user.characters = user.characters.filter(c => c !== req.params.name);
  writeJson(USERS_FILE, users);
  try{ fs.unlinkSync(charFile(req.username, req.params.name)); }catch(e){ /* gab's evtl. nicht */ }
  removeAllSharesFor(req.username, req.params.name);
  res.json({ ok: true });
});

// Charakter umbenennen - nur der Besitzer darf das (Mitbearbeiter nicht).
app.post('/api/characters/:name/rename', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user || !user.characters.includes(req.params.name)){
    return res.status(403).json({ error: 'Nur der Besitzer kann den Charakter umbenennen' });
  }
  const newName = req.body && req.body.newName && String(req.body.newName).trim();
  if(!newName) return res.status(400).json({ error: 'Neuer Name erforderlich' });
  if(newName === req.params.name) return res.json({ ok: true, name: newName });
  if(user.characters.includes(newName)){
    return res.status(409).json({ error: 'Diesen Charakternamen hast du bereits vergeben' });
  }
  if(isCharNameTakenByOther(newName, req.username)){
    return res.status(409).json({ error: 'Dieser Charaktername ist bereits von einem anderen Benutzer vergeben' });
  }

  const oldFile = charFile(req.username, req.params.name);
  const newFile = charFile(req.username, newName);
  try{ fs.renameSync(oldFile, newFile); }
  catch(e){ writeJson(newFile, readJson(oldFile, {})); }

  user.characters = user.characters.map(c => c === req.params.name ? newName : c);
  writeJson(USERS_FILE, users);

  // Freigaben (Mitbearbeiter-Liste) unter dem neuen Namen weiterführen.
  const shares = readJson(SHARES_FILE, {});
  const oldKey = shareKey(req.username, req.params.name);
  if(shares[oldKey]){
    shares[shareKey(req.username, newName)] = shares[oldKey];
    delete shares[oldKey];
    writeJson(SHARES_FILE, shares);
  }

  res.json({ ok: true, name: newName });
});

/* ---------- Charakter-Freigaben: Mitbearbeiter einladen/entfernen/anzeigen ----------
   Nur der Besitzer darf einladen/entfernen. Ein Mitbearbeiter kann denselben Charakter
   danach ganz normal über /api/characters/:name laden und speichern. */
app.get('/api/characters/:name/collaborators', authMiddleware, (req, res) => {
  const owner = findCharOwner(req.params.name);
  if(!owner || !canAccessChar(req.username, owner, req.params.name)){
    return res.status(404).json({ error: 'Charakter nicht gefunden' });
  }
  res.json({ owner, isOwner: owner === req.username, collaborators: getCollaborators(owner, req.params.name) });
});
app.post('/api/characters/:name/invite', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user || !user.characters.includes(req.params.name)){
    return res.status(403).json({ error: 'Nur der Besitzer kann Mitbearbeiter einladen' });
  }
  const targetUsername = req.body && req.body.username;
  if(!targetUsername || !users[targetUsername]){
    return res.status(404).json({ error: 'Diesen Benutzer gibt es nicht' });
  }
  if(targetUsername === req.username){
    return res.status(400).json({ error: 'Du bist bereits Besitzer dieses Charakters' });
  }
  const list = getCollaborators(req.username, req.params.name);
  if(!list.includes(targetUsername)) list.push(targetUsername);
  setCollaborators(req.username, req.params.name, list);
  res.json({ ok: true, collaborators: list });
});
app.delete('/api/characters/:name/invite/:username', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  const isOwner = !!(user && user.characters.includes(req.params.name));
  const isSelfLeave = req.username === req.params.username;
  if(!isOwner && !isSelfLeave){
    return res.status(403).json({ error: 'Nur der Besitzer kann Mitbearbeiter entfernen' });
  }
  const owner = isOwner ? req.username : findCharOwner(req.params.name);
  if(!owner) return res.status(404).json({ error: 'Charakter nicht gefunden' });
  const list = getCollaborators(owner, req.params.name).filter(u => u !== req.params.username);
  setCollaborators(owner, req.params.name, list);
  res.json({ ok: true, collaborators: list });
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
    removeAllSharesFor(target, c);
  });
  delete users[target];
  writeJson(USERS_FILE, users);
  removeUserFromAllShares(target);
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
