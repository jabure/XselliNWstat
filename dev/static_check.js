// Statische Prüfungen ohne Browser/Server - fängt Fehlerklassen ab, die früher unbemerkt live gingen:
//  1) doppelt deklarierte Funktionen/Variablen (die zweite überschreibt die erste stillschweigend,
//     so geschehen bei gpDisplayName in v0.39.0)
//  2) t('...')- und data-i18n-Schlüssel, die im Wörterbuch fehlen (Tippfehler -> Rohschlüssel im UI)
//  3) onclick-Attribute, in die Namen per JSON.stringify eingebettet werden (kaputtes HTML, v0.16.0)
const fs = require('fs');
const path = require('path');
let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log('  OK  ' + name);
  else { console.log('  FEHLER  ' + name + (detail ? '  -> ' + detail : '')); fails++; }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = scripts[scripts.length - 1];
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function dups(src, re) {
  const seen = {}, out = [];
  for (const m of src.matchAll(re)) { seen[m[1]] = (seen[m[1]] || 0) + 1; }
  for (const k in seen) if (seen[k] > 1) out.push(k);
  return out;
}
console.log('\n[S1] Doppelte Deklarationen');
for (const [label, src] of [['index.html', js], ['server.js', server]]) {
  const f = dups(src, /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm);
  check(label + ': keine doppelt deklarierte Funktion', f.length === 0, f.join(', '));
  const v = dups(src, /^(?:const|let)\s+([A-Za-z0-9_$]+)\b/gm);
  check(label + ': keine doppelt deklarierte Top-Level-Variable', v.length === 0, v.join(', '));
}

console.log('\n[S2] Übersetzungsschlüssel');
// TRANSLATIONS-Block per String-bewusstem Klammer-Scanner herausschneiden und auswerten
function extractObject(src, marker) {
  let i = src.indexOf(marker);
  if (i < 0) return null;
  i = src.indexOf('{', i);
  let depth = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return null;
}
const block = extractObject(js, 'const TRANSLATIONS');
let TR = null;
try { TR = new Function('return ' + block)(); } catch (e) { check('TRANSLATIONS lässt sich einlesen', false, e.message); }
if (TR) {
  const de = new Set(Object.keys(TR.de));
  const used = new Set();
  for (const m of js.matchAll(/\bt\(\s*'([a-zA-Z0-9_.\-]+)'\s*\)/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) used.add(m[1]);
  const missing = [...used].filter(k => !de.has(k));
  check('alle verwendeten Schlüssel (' + used.size + ') stehen im deutschen Wörterbuch', missing.length === 0, missing.join(', '));
}

console.log('\n[S3] Unsichere onclick-Einbettung');
const bad = [];
js.split('\n').forEach((line, i) => {
  if (/onclick="[^"]*\$\{\s*JSON\.stringify\(/.test(line) && !/replace\(\/"\/g/.test(line)) bad.push(i + 1);
});
check('kein JSON.stringify direkt in onclick="..." (ohne Quote-Escaping)', bad.length === 0, 'Zeilen im Skript: ' + bad.join(', '));

console.log('\n' + (fails ? `${fails} Fehler` : 'Alles OK'));
process.exit(fails ? 1 : 0);
