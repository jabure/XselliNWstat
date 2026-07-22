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
// Gruppenplaner: komplett eigener Datentopf, absichtlich getrennt von den
// Stats-Charakteren (chars/) - andere Inhalte (Klasse/Rollen/Besitz-Checklisten),
// andere Lebensdauer, andere Zugriffsregeln.
const GP_CHAR_DIR = path.join(DATA_DIR, 'gpchars');
const GP_PLAN_DIR = path.join(DATA_DIR, 'gpplans');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SHARED_FILE = path.join(DATA_DIR, 'shared.json');
const TRANSFERS_FILE = path.join(DATA_DIR, 'transfers.json');

if(JWT_SECRET === 'bitte-in-der-.env-aendern'){
  console.warn('WARNUNG: JWT_SECRET wurde nicht gesetzt - bitte in der .env auf einen langen, zufälligen Wert ändern!');
}

fs.mkdirSync(CHAR_DIR, { recursive: true });
fs.mkdirSync(GP_CHAR_DIR, { recursive: true });
fs.mkdirSync(GP_PLAN_DIR, { recursive: true });
if(!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
if(!fs.existsSync(SHARED_FILE)) fs.writeFileSync(SHARED_FILE, '{}');
if(!fs.existsSync(TRANSFERS_FILE)) fs.writeFileSync(TRANSFERS_FILE, '{}');

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
function gpCharFile(username, charname){
  return path.join(GP_CHAR_DIR, `${safeName(username)}__${safeName(charname)}.json`);
}
function gpPlanFile(planname){
  return path.join(GP_PLAN_DIR, `${safeName(planname)}.json`);
}

/* ---------- Charakter-Übergabe (Senden/Annehmen/Ablehnen) ----------
   Ein Charakter gehört immer genau EINEM Benutzer. Statt einer dauerhaften Freigabe
   (keine Live-Ansicht möglich, daher wenig sinnvoll) kann der Besitzer den Charakter
   an einen anderen Benutzer SENDEN - die Übergabe ist eine Anfrage, die der Empfänger
   annehmen oder ablehnen muss. Erst nach Annahme wechselt der Besitzer wirklich.
   Pro Charakter kann es höchstens eine offene Übergabe geben (Schlüssel = Charaktername,
   da Namen global eindeutig sind). */
function getTransfer(charname){
  const transfers = readJson(TRANSFERS_FILE, {});
  return transfers[charname] || null;
}
function setTransfer(charname, transfer){
  const transfers = readJson(TRANSFERS_FILE, {});
  if(transfer) transfers[charname] = transfer;
  else delete transfers[charname];
  writeJson(TRANSFERS_FILE, transfers);
}
function removeTransfersInvolving(username){
  const transfers = readJson(TRANSFERS_FILE, {});
  let changed = false;
  Object.keys(transfers).forEach(charname=>{
    const t = transfers[charname];
    if(t.from === username || t.to === username){ delete transfers[charname]; changed = true; }
  });
  if(changed) writeJson(TRANSFERS_FILE, transfers);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

const PKG_VERSION = require('./package.json').version;
app.get('/api/version', (req, res) => {
  res.json({ version: PKG_VERSION });
});

function pwFingerprint(passwordHash){
  return String(passwordHash || '').slice(-10);
}
function signToken(username, passwordHash){
  return jwt.sign({ username, pw: pwFingerprint(passwordHash) }, JWT_SECRET, { expiresIn: '90d' });
}
function authMiddleware(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if(!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    // Prüfwert des Passwort-Hashes vergleichen: nach einem Passwortwechsel (selbst
    // oder per Admin-Reset) werden damit ALLE vorher ausgestellten Tokens ungültig.
    // Tokens ohne Prüfwert stammen aus der Zeit vor diesem Mechanismus und bleiben
    // gültig, bis sie regulär ablaufen.
    if(payload.pw !== undefined){
      const users = readJson(USERS_FILE, {});
      const user = users[payload.username];
      if(!user || payload.pw !== pwFingerprint(user.passwordHash)){
        return res.status(401).json({ error: 'Login abgelaufen (Passwort wurde geändert), bitte neu anmelden' });
      }
    }
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
  const token = signToken(username, passwordHash);
  res.status(201).json({ token, username, role });
});

// Einfache Bremse gegen Passwort-Durchprobieren: pro Benutzername werden Fehlversuche
// gezählt (im Speicher, überlebt keinen Neustart - reicht für diesen Zweck). Nach
// MAX_ATTEMPTS Fehlversuchen ist der Login für LOCK_MINUTES gesperrt; ein
// erfolgreicher Login setzt den Zähler zurück.
const loginAttempts = {}; // username -> { count, firstAt }
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_LOCK_MINUTES = 15;
function loginLockedFor(username){
  const a = loginAttempts[username];
  if(!a) return 0;
  const elapsed = Date.now() - a.firstAt;
  if(elapsed > LOGIN_LOCK_MINUTES*60*1000){ delete loginAttempts[username]; return 0; }
  if(a.count < LOGIN_MAX_ATTEMPTS) return 0;
  return Math.ceil((LOGIN_LOCK_MINUTES*60*1000 - elapsed) / 60000);
}
function noteLoginFailure(username){
  const a = loginAttempts[username];
  if(!a || Date.now() - a.firstAt > LOGIN_LOCK_MINUTES*60*1000){
    loginAttempts[username] = { count: 1, firstAt: Date.now() };
  } else {
    a.count++;
  }
}

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const lockedMin = loginLockedFor(username);
  if(lockedMin > 0){
    return res.status(429).json({ error: `Zu viele Fehlversuche - bitte in ${lockedMin} Minute${lockedMin===1?'':'n'} erneut versuchen` });
  }
  const users = readJson(USERS_FILE, {});
  const user = users[username];
  if(!user){ noteLoginFailure(username); return res.status(401).json({ error: 'Benutzername oder Passwort falsch' }); }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if(!ok){ noteLoginFailure(username); return res.status(401).json({ error: 'Benutzername oder Passwort falsch' }); }
  delete loginAttempts[username];
  const token = signToken(username, user.passwordHash);
  res.json({ token, username, role: getUserRole(username), mustChangePassword: user.mustChangePassword === true });
});

// Eigenes Passwort ändern (altes Passwort muss stimmen). Wichtig z. B. nachdem ein
// Admin das Passwort auf den Standardwert zurückgesetzt hat.
app.post('/api/me/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if(!newPassword || newPassword.length < 4){
    return res.status(400).json({ error: 'Neues Passwort muss mindestens 4 Zeichen haben' });
  }
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  const ok = await bcrypt.compare(String(oldPassword||''), user.passwordHash);
  if(!ok) return res.status(401).json({ error: 'Das aktuelle Passwort ist falsch' });
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  delete user.mustChangePassword; // Pflicht nach Admin-Reset ist hiermit erfüllt
  writeJson(USERS_FILE, users);
  // Der Passwortwechsel macht alle alten Tokens ungültig - auch das gerade benutzte.
  // Deshalb bekommt der Aufrufer sofort ein frisches Token zurück und bleibt angemeldet.
  res.json({ ok: true, token: signToken(req.username, user.passwordHash) });
});

/* ---------- Charaktere (pro Benutzer, benötigt Login) ---------- */
app.get('/api/me', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  res.json({ username: req.username, role: getUserRole(req.username), characters: (user && user.characters) || [], mustChangePassword: !!(user && user.mustChangePassword) });
});

// Liefert zu einem Charakter die Kurzinfos (Klasse/Vorbildpfad) aus seinen Daten,
// damit die Auswahlliste im Frontend mehr als nur den Namen zeigen kann. "updatedAt"
// kommt aus dem Änderungsdatum der Datei (kein separates Feld nötig).
function charSummary(username, name){
  const file = charFile(username, name);
  const data = readJson(file, {});
  const g = data.grunddaten || {};
  let updatedAt = null;
  try{ updatedAt = fs.statSync(file).mtime.toISOString(); }catch(e){ /* Datei evtl. noch nicht geschrieben */ }
  return { name, klasse: g.klasse || '', vorbildpfad: g.vorbildpfad || '', klassentyp: g.klassentyp || '', updatedAt };
}

app.get('/api/characters', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  const transfers = readJson(TRANSFERS_FILE, {});
  const own = ((user && user.characters) || []).map(n => Object.assign(
    charSummary(req.username, n),
    { owner: req.username, isOwner: true, pendingTransferTo: (transfers[n] && transfers[n].from === req.username) ? transfers[n].to : null }
  ));
  res.json(own);
});

// Reihenfolge der eigenen Charaktere ändern (z. B. per Hoch/Runter-Pfeil im Frontend).
// "order" muss exakt dieselben Charakternamen enthalten wie aktuell vorhanden (nur die
// Reihenfolge darf sich unterscheiden) - so kann darüber nichts hinzugefügt/entfernt werden.
app.put('/api/characters/reorder', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  const order = req.body && req.body.order;
  if(!Array.isArray(order)) return res.status(400).json({ error: 'Ungültige Reihenfolge' });
  const current = user.characters || [];
  const sameSet = order.length === current.length &&
    [...order].sort().join('\u0000') === [...current].sort().join('\u0000');
  if(!sameSet) return res.status(400).json({ error: 'Die Reihenfolge muss genau dieselben Charaktere enthalten' });
  user.characters = order;
  writeJson(USERS_FILE, users);
  res.json({ ok: true });
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

// Nur diese Schlüssel dürfen in einer Charakter-Datei landen - alles andere
// (unbekannte/versehentliche Felder, z. B. aus einem manipulierten Import) wird
// beim Speichern kommentarlos verworfen.
const CHAR_ALLOWED_KEYS = ['grunddaten','baseInputs','sourceInputs','slotSelections','raptorCount',
  'gefaehrtenMode','reittierMode','gefaehrtenActivePreset','reittierActivePreset','uebersichtParams','calcActive'];
const CHAR_MAX_BYTES = 300000; // ein echter Charakter liegt bei wenigen KB - großzügige Obergrenze
function sanitizeCharData(body){
  const clean = {};
  CHAR_ALLOWED_KEYS.forEach(k => { if(body && k in body) clean[k] = body[k]; });
  return clean;
}

app.put('/api/characters/:name', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user || !user.characters.includes(req.params.name)){
    return res.status(404).json({ error: 'Charakter nicht gefunden' });
  }
  const clean = sanitizeCharData(req.body);
  if(JSON.stringify(clean).length > CHAR_MAX_BYTES){
    return res.status(413).json({ error: 'Charakterdaten sind unerwartet groß - nicht gespeichert' });
  }
  writeJson(charFile(req.username, req.params.name), clean);
  res.json({ ok: true });
});

app.delete('/api/characters/:name', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  user.characters = user.characters.filter(c => c !== req.params.name);
  writeJson(USERS_FILE, users);
  try{ fs.unlinkSync(charFile(req.username, req.params.name)); }catch(e){ /* gab's evtl. nicht */ }
  setTransfer(req.params.name, null);
  res.json({ ok: true });
});

// Charakter umbenennen - nur der Besitzer darf das.
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

  // Eine offene Übergabe (falls vorhanden) unter dem neuen Namen weiterführen.
  const pendingTransfer = getTransfer(req.params.name);
  if(pendingTransfer){
    setTransfer(req.params.name, null);
    setTransfer(newName, pendingTransfer);
  }

  res.json({ ok: true, name: newName });
});

/* ---------- Charakter-Übergabe: Senden/Annehmen/Ablehnen/Abbrechen ----------
   Nur der Besitzer darf einen Charakter senden oder eine offene Übergabe abbrechen.
   Nur der Empfänger darf eine an ihn gerichtete Übergabe annehmen oder ablehnen.
   Es wird dabei immer eine KOPIE übergeben - der Absender behält sein Original,
   der Empfänger bekommt bei "Annehmen" einen neuen, eigenen Charakter mit denselben
   Daten (unter einem automatisch angepassten, eindeutigen Namen). */
app.get('/api/transfers', authMiddleware, (req, res) => {
  const transfers = readJson(TRANSFERS_FILE, {});
  const incoming = [];
  const outgoing = [];
  Object.keys(transfers).forEach(charname => {
    const t = transfers[charname];
    if(t.to === req.username) incoming.push({ charName: charname, from: t.from });
    if(t.from === req.username) outgoing.push({ charName: charname, to: t.to });
  });
  res.json({ incoming, outgoing });
});
app.post('/api/characters/:name/send', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user || !user.characters.includes(req.params.name)){
    return res.status(403).json({ error: 'Nur der Besitzer kann den Charakter senden' });
  }
  const targetUsername = req.body && req.body.username;
  if(!targetUsername || !users[targetUsername]){
    return res.status(404).json({ error: 'Diesen Benutzer gibt es nicht' });
  }
  if(targetUsername === req.username){
    return res.status(400).json({ error: 'Du bist bereits Besitzer dieses Charakters' });
  }
  setTransfer(req.params.name, { from: req.username, to: targetUsername, createdAt: Date.now() });
  res.json({ ok: true, to: targetUsername });
});
app.post('/api/characters/:name/cancel-send', authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user || !user.characters.includes(req.params.name)){
    return res.status(403).json({ error: 'Nur der Besitzer kann eine Übergabe abbrechen' });
  }
  const t = getTransfer(req.params.name);
  if(!t || t.from !== req.username){
    return res.status(404).json({ error: 'Keine offene Übergabe für diesen Charakter' });
  }
  setTransfer(req.params.name, null);
  res.json({ ok: true });
});
app.post('/api/transfers/:name/accept', authMiddleware, (req, res) => {
  const t = getTransfer(req.params.name);
  if(!t || t.to !== req.username){
    return res.status(404).json({ error: 'Kein an dich gerichtetes Angebot für diesen Charakter' });
  }
  const users = readJson(USERS_FILE, {});
  const fromUser = users[t.from];
  const toUser = users[req.username];
  if(!fromUser || !toUser){
    setTransfer(req.params.name, null);
    return res.status(404).json({ error: 'Absender oder Empfänger existiert nicht mehr' });
  }
  // Es wird eine KOPIE angelegt - der Absender behält sein Original unverändert.
  // Da Charakternamen global eindeutig sein müssen, bekommt die Kopie automatisch
  // einen neuen, freien Namen.
  if(!toUser.characters) toUser.characters = [];
  const base = `${req.params.name} (von ${t.from})`;
  let target = base, i = 2;
  while(toUser.characters.includes(target) || isCharNameTakenByOther(target, req.username)){
    target = `${base} ${i++}`;
  }
  const data = readJson(charFile(t.from, req.params.name), {});
  toUser.characters.push(target);
  writeJson(USERS_FILE, users);
  writeJson(charFile(req.username, target), data);
  setTransfer(req.params.name, null);
  res.json({ ok: true, name: target });
});
app.post('/api/transfers/:name/decline', authMiddleware, (req, res) => {
  const t = getTransfer(req.params.name);
  if(!t || t.to !== req.username){
    return res.status(404).json({ error: 'Kein an dich gerichtetes Angebot für diesen Charakter' });
  }
  setTransfer(req.params.name, null);
  res.json({ ok: true });
});


/* ---------- Geteilte Daten: Formeln, Presets/Datenbanken ----------
   Lesen bleibt für alle offen (jeder Charakter-Rechner braucht die
   Gefährten-/Reittier-/Buff-Food-Datenbank und die Formeln, um zu rechnen).
   Schreiben ist rollenabhängig: Presets ab Moderator, Formeln ab Coadmin. */
/* ---------- Gruppenplaner ----------
   Bewusst komplett getrennt von den Stats-Charakteren: eigener Ordner, eigene
   Whitelist, eigene Endpunkte unter /api/gp/*. Solange sich das Feature noch
   in der Planungsphase befindet, ist es (wie der Insignienrechner) für alle
   Endpunkte auf Rolle 'moderator' beschränkt - GP_MIN_ROLE ist bewusst eine
   einzelne Konstante, damit das Freischalten für alle später ein Ein-Zeiler ist. */
const GP_MIN_ROLE = 'moderator';
const gpRoleGate = requireRole(GP_MIN_ROLE);

// Eigene Gruppenplaner-Charaktere (Klasse/Rollen/Besitz-Checklisten) - EIN Konto
// kann mehrere davon haben, genau wie bei den Stats-Charakteren, aber komplett
// getrennt gespeichert. Für die Aufstellung braucht man die Charaktere ALLER
// Benutzer (um sie in Slots zu ziehen), daher gibt es nur ein "alle anzeigen".
app.get('/api/gp/characters', authMiddleware, gpRoleGate, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const result = [];
  Object.keys(users).forEach(owner => {
    (users[owner].gpCharacters || []).forEach(name => {
      const data = readJson(gpCharFile(owner, name), {});
      result.push({ owner, name, isOwner: owner === req.username, data });
    });
  });
  res.json(result);
});

app.post('/api/gp/characters', authMiddleware, gpRoleGate, (req, res) => {
  const name = req.body && req.body.name && String(req.body.name).trim();
  if(!name) return res.status(400).json({ error: 'Name erforderlich' });
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  if(!user.gpCharacters) user.gpCharacters = [];
  if(user.gpCharacters.includes(name)) return res.status(409).json({ error: 'Diesen Charakter hast du schon angelegt' });
  user.gpCharacters.push(name);
  writeJson(USERS_FILE, users);
  writeJson(gpCharFile(req.username, name), { klasse: '', rollen: { dps: false, heal: false, tank: false }, besitz: {} });
  res.status(201).json({ name });
});

const GP_CHAR_ALLOWED_KEYS = ['klasse', 'rollen', 'besitz'];
const GP_CHAR_MAX_BYTES = 50000; // reine Checklisten - deutlich kleiner als Stats-Charaktere
app.put('/api/gp/characters/:name', authMiddleware, gpRoleGate, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user || !(user.gpCharacters || []).includes(req.params.name)){
    return res.status(404).json({ error: 'Charakter nicht gefunden (oder gehört dir nicht)' });
  }
  const clean = {};
  GP_CHAR_ALLOWED_KEYS.forEach(k => { if(req.body && k in req.body) clean[k] = req.body[k]; });
  if(JSON.stringify(clean).length > GP_CHAR_MAX_BYTES){
    return res.status(413).json({ error: 'Daten sind unerwartet groß - nicht gespeichert' });
  }
  writeJson(gpCharFile(req.username, req.params.name), clean);
  res.json({ ok: true });
});

app.delete('/api/gp/characters/:name', authMiddleware, gpRoleGate, (req, res) => {
  const users = readJson(USERS_FILE, {});
  const user = users[req.username];
  if(!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  user.gpCharacters = (user.gpCharacters || []).filter(c => c !== req.params.name);
  writeJson(USERS_FILE, users);
  try{ fs.unlinkSync(gpCharFile(req.username, req.params.name)); }catch(e){ /* gab's evtl. nicht */ }
  res.json({ ok: true });
});

// Geteilte, benannte Aufstellungs-Pläne (z. B. "Trial Sonntag 20 Uhr"). Mehrere
// Pläne gleichzeitig möglich; jeder Plan enthält beliebig viele Gruppen mit
// DPS/Heiler/Tank-Slots. Bearbeiten ist Moderator-Sache (wie Presets).
function readGpPlanList(){
  let files;
  try{ files = fs.readdirSync(GP_PLAN_DIR).filter(f => f.endsWith('.json')); }
  catch(e){ return []; }
  // Anzeigename kommt aus dem gespeicherten "name"-Feld (siehe unten), NICHT aus dem
  // (sanitisierten) Dateinamen - sonst gingen Leerzeichen/Sonderzeichen beim Auflisten verloren.
  return files.map(f => {
    const data = readJson(path.join(GP_PLAN_DIR, f), {});
    return data.name || f.slice(0, -5);
  });
}
app.get('/api/gp/plans', authMiddleware, gpRoleGate, (req, res) => {
  const list = readGpPlanList().map(name => {
    let updatedAt = null;
    try{ updatedAt = fs.statSync(gpPlanFile(name)).mtime.toISOString(); }catch(e){ /* egal */ }
    return { name, updatedAt };
  });
  res.json(list);
});
app.post('/api/gp/plans', authMiddleware, gpRoleGate, (req, res) => {
  const name = req.body && req.body.name && String(req.body.name).trim();
  if(!name) return res.status(400).json({ error: 'Name erforderlich' });
  if(fs.existsSync(gpPlanFile(name))) return res.status(409).json({ error: 'Diesen Plan gibt es schon' });
  writeJson(gpPlanFile(name), { name, groups: [] });
  res.status(201).json({ name });
});
app.get('/api/gp/plans/:name', authMiddleware, gpRoleGate, (req, res) => {
  if(!fs.existsSync(gpPlanFile(req.params.name))) return res.status(404).json({ error: 'Plan nicht gefunden' });
  res.json({ name: req.params.name, data: readJson(gpPlanFile(req.params.name), { name: req.params.name, groups: [] }) });
});
const GP_PLAN_MAX_BYTES = 2000000; // ein Plan mit vielen Gruppen/Slots kann größer werden als ein Charakter
app.put('/api/gp/plans/:name', authMiddleware, gpRoleGate, (req, res) => {
  if(!fs.existsSync(gpPlanFile(req.params.name))) return res.status(404).json({ error: 'Plan nicht gefunden' });
  const clean = { name: req.params.name, groups: (req.body && Array.isArray(req.body.groups)) ? req.body.groups : [] };
  if(JSON.stringify(clean).length > GP_PLAN_MAX_BYTES){
    return res.status(413).json({ error: 'Plan ist unerwartet groß - nicht gespeichert' });
  }
  writeJson(gpPlanFile(req.params.name), clean);
  res.json({ ok: true });
});
app.delete('/api/gp/plans/:name', authMiddleware, gpRoleGate, (req, res) => {
  try{ fs.unlinkSync(gpPlanFile(req.params.name)); }catch(e){ /* gab's evtl. nicht */ }
  res.json({ ok: true });
});
app.post('/api/gp/plans/:name/rename', authMiddleware, gpRoleGate, (req, res) => {
  const newName = req.body && req.body.newName && String(req.body.newName).trim();
  if(!newName) return res.status(400).json({ error: 'Neuer Name erforderlich' });
  if(!fs.existsSync(gpPlanFile(req.params.name))) return res.status(404).json({ error: 'Plan nicht gefunden' });
  if(fs.existsSync(gpPlanFile(newName))) return res.status(409).json({ error: 'Diesen Namen gibt es schon' });
  const data = readJson(gpPlanFile(req.params.name), { groups: [] });
  data.name = newName;
  writeJson(gpPlanFile(req.params.name), data);
  fs.renameSync(gpPlanFile(req.params.name), gpPlanFile(newName));
  res.json({ ok: true, name: newName });
});

app.get('/api/shared', (req, res) => {
  res.json(readJson(SHARED_FILE, {}));
});

// Gemeinsames Speichern für Presets/Formeln mit zwei Sicherheitsnetzen:
// 1) Versionszähler (rev): Schickt der Client die rev mit, die er beim Laden bekommen
//    hat, und hat inzwischen jemand anderes gespeichert, gibt es einen 409 statt
//    kommentarlosem Überschreiben ("letzter gewinnt").
// 2) Historie: Vor jedem Überschreiben wird der alte Stand datiert unter
//    data/backups/shared/ abgelegt (die letzten 10 bleiben erhalten).
const SHARED_HISTORY_DIR = path.join(DATA_DIR, 'backups', 'shared');
function saveShared(req, res, allowedKeys){
  const current = readJson(SHARED_FILE, {});
  const clientRev = req.body ? req.body.rev : undefined;
  const currentRev = current.rev || 0;
  if(clientRev !== undefined && clientRev !== null && Number(clientRev) !== currentRev){
    return res.status(409).json({ error: 'Jemand anderes hat inzwischen gespeichert - bitte Seite neu laden und Änderung erneut machen', rev: currentRev });
  }
  const patch = {};
  allowedKeys.forEach(key => { if(req.body && key in req.body) patch[key] = req.body[key]; });
  try{
    fs.mkdirSync(SHARED_HISTORY_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g,'-'); // inkl. Millisekunden - zwei Speicherungen in derselben Sekunde überschreiben sich sonst
    fs.copyFileSync(SHARED_FILE, path.join(SHARED_HISTORY_DIR, `shared-${stamp}.json`));
    const old = fs.readdirSync(SHARED_HISTORY_DIR).filter(f=>f.startsWith('shared-')).sort();
    while(old.length > 10) fs.unlinkSync(path.join(SHARED_HISTORY_DIR, old.shift()));
  }catch(e){ console.warn('Shared-Historie konnte nicht geschrieben werden:', e.message); }
  const next = Object.assign({}, current, patch, { rev: currentRev + 1 });
  writeJson(SHARED_FILE, next);
  res.json({ ok: true, rev: next.rev });
}
app.put('/api/shared/presets', authMiddleware, requireRole('moderator'), (req, res) => {
  saveShared(req, res, ['companionDb', 'mountDb', 'foodDb', 'foodSlots', 'gefaehrtenPresets', 'reittierPresets', 'gegnerProfile',
    // Gruppenplaner-Referenzlisten und Insignien-Marktpreise - bewusst über denselben
    // Presets-Endpunkt (Moderator, gleicher rev-Schutz/Historie), aber eigene Schlüssel,
    // komplett getrennt von den Stats-Datenbanken oben.
    'gpArtefakte', 'gpMounts', 'gpMountBonus', 'gpGefaehrten', 'gpGefaehrtenVerstaerkung', 'insigniePreise']);
});
app.put('/api/shared/formulas', authMiddleware, requireRole('coadmin'), (req, res) => {
  saveShared(req, res, ['formulas', 'maxPrOverrides', 'wehrVerteilung']);
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
  // Beim nächsten Login wird die Person aufgefordert, das Standardpasswort sofort
  // zu ändern (Frontend öffnet das Passwort-Formular automatisch).
  target.mustChangePassword = true;
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
  removeTransfersInvolving(target);
  res.json({ ok: true });
});

/* ---------- Admin: Sicherungen einsehen, herunterladen, wiederherstellen ---------- */
// Listet die automatischen Backups auf: Shared-Historie (einzelne shared.json-Stände
// vor jedem Presets-/Formeln-Speichern) und die täglichen Voll-Backups.
app.get('/api/admin/backups', authMiddleware, requireRole('admin'), (req, res) => {
  const shared = [];
  try{
    fs.readdirSync(SHARED_HISTORY_DIR).filter(f=>/^shared-[0-9TZ\-]+\.json$/.test(f)).sort().reverse().forEach(f=>{
      const st = fs.statSync(path.join(SHARED_HISTORY_DIR, f));
      shared.push({ file: f, mtime: st.mtime.toISOString(), size: st.size });
    });
  }catch(e){ /* Ordner existiert evtl. noch nicht */ }
  const daily = [];
  try{
    fs.readdirSync(DAILY_BACKUP_DIR).filter(f=>/^\d{4}-\d{2}-\d{2}$/.test(f)).sort().reverse().forEach(day=>{
      let files = 0;
      try{ files = fs.readdirSync(path.join(DAILY_BACKUP_DIR, day, 'chars')).length + 2; }catch(e){ files = 2; }
      daily.push({ day, files });
    });
  }catch(e){ /* Ordner existiert evtl. noch nicht */ }
  res.json({ shared, daily });
});

// Einen Stand der Shared-Historie herunterladen. Der Dateiname wird streng geprüft
// (nur das bekannte Muster), damit hier niemand beliebige Pfade lesen kann.
app.get('/api/admin/backups/shared/:file', authMiddleware, requireRole('admin'), (req, res) => {
  const f = req.params.file;
  if(!/^shared-[0-9TZ\-]+\.json$/.test(f)) return res.status(400).json({ error: 'Ungültiger Dateiname' });
  const full = path.join(SHARED_HISTORY_DIR, f);
  if(!fs.existsSync(full)) return res.status(404).json({ error: 'Sicherung nicht gefunden' });
  res.setHeader('Content-Disposition', `attachment; filename="${f}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(fs.readFileSync(full));
});

// Einen Stand der Shared-Historie wiederherstellen: der AKTUELLE Stand wandert dabei
// selbst in die Historie (nichts geht verloren), und die rev zählt weiter hoch, damit
// offene Bearbeitungen anderer sauber den 409-Konflikt bekommen statt zu überschreiben.
app.post('/api/admin/backups/shared/:file/restore', authMiddleware, requireRole('admin'), (req, res) => {
  const f = req.params.file;
  if(!/^shared-[0-9TZ\-]+\.json$/.test(f)) return res.status(400).json({ error: 'Ungültiger Dateiname' });
  const full = path.join(SHARED_HISTORY_DIR, f);
  if(!fs.existsSync(full)) return res.status(404).json({ error: 'Sicherung nicht gefunden' });
  const backup = readJson(full, null);
  if(!backup || typeof backup !== 'object') return res.status(400).json({ error: 'Sicherung ist nicht lesbar' });
  const current = readJson(SHARED_FILE, {});
  const currentRev = current.rev || 0;
  try{
    fs.mkdirSync(SHARED_HISTORY_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    fs.copyFileSync(SHARED_FILE, path.join(SHARED_HISTORY_DIR, `shared-${stamp}.json`));
    const old = fs.readdirSync(SHARED_HISTORY_DIR).filter(x=>x.startsWith('shared-')).sort();
    while(old.length > 10) fs.unlinkSync(path.join(SHARED_HISTORY_DIR, old.shift()));
  }catch(e){ console.warn('Shared-Historie konnte nicht geschrieben werden:', e.message); }
  writeJson(SHARED_FILE, Object.assign({}, backup, { rev: currentRev + 1 }));
  res.json({ ok: true, rev: currentRev + 1 });
});

// Ein tägliches Voll-Backup als .tar.gz herunterladen (gestreamt, kein Zwischenspeichern).
app.get('/api/admin/backups/daily/:day', authMiddleware, requireRole('admin'), (req, res) => {
  const day = req.params.day;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'Ungültiges Datum' });
  if(!fs.existsSync(path.join(DAILY_BACKUP_DIR, day))) return res.status(404).json({ error: 'Sicherung nicht gefunden' });
  res.setHeader('Content-Disposition', `attachment; filename="xselli-backup-${day}.tar.gz"`);
  res.setHeader('Content-Type', 'application/gzip');
  const tar = require('child_process').spawn('tar', ['-czf', '-', '-C', DAILY_BACKUP_DIR, day]);
  tar.stdout.pipe(res);
  tar.on('error', ()=>{ if(!res.headersSent) res.status(500).json({ error: 'tar nicht verfügbar' }); });
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

// Frontend direkt mit ausliefern - ein Container, ein Port. HTML wird bei jedem
// Aufruf gegen den Server geprüft (ETag), damit nach Updates niemand tagelang eine
// alte Version aus dem Browser-Cache sieht; die versionierte vendor-Datei (mathjs)
// darf der Browser dagegen lange behalten.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if(filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    else if(filePath.includes(path.sep + 'vendor' + path.sep)) res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Tägliches automatisches Backup des kompletten data/-Ordners nach data/backups/daily/
// (users.json, shared.json, alle Charaktere). Die letzten 7 Tage bleiben erhalten.
// Läuft beim Start und danach stündlich als Prüfung, ob für heute schon eins existiert.
const DAILY_BACKUP_DIR = path.join(DATA_DIR, 'backups', 'daily');
function dailyBackup(){
  try{
    const today = new Date().toISOString().slice(0,10);
    const target = path.join(DAILY_BACKUP_DIR, today);
    if(fs.existsSync(target)) return;
    fs.mkdirSync(target, { recursive: true });
    if(fs.existsSync(USERS_FILE)) fs.copyFileSync(USERS_FILE, path.join(target, 'users.json'));
    if(fs.existsSync(SHARED_FILE)) fs.copyFileSync(SHARED_FILE, path.join(target, 'shared.json'));
    fs.cpSync(CHAR_DIR, path.join(target, 'chars'), { recursive: true });
    fs.cpSync(GP_CHAR_DIR, path.join(target, 'gpchars'), { recursive: true });
    fs.cpSync(GP_PLAN_DIR, path.join(target, 'gpplans'), { recursive: true });
    const old = fs.readdirSync(DAILY_BACKUP_DIR).sort();
    while(old.length > 7){
      fs.rmSync(path.join(DAILY_BACKUP_DIR, old.shift()), { recursive: true, force: true });
    }
    console.log(`Tägliches Backup angelegt: ${target}`);
  }catch(e){ console.warn('Tägliches Backup fehlgeschlagen:', e.message); }
}
dailyBackup();
setInterval(dailyBackup, 60*60*1000);

app.listen(PORT, () => {
  console.log(`Xselli's Stats-Rechner läuft auf Port ${PORT}`);
});
