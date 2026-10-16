'use strict';
// Impressum und Datenschutzerklärung als vom Server erzeugte Seiten.
// Die persönlichen Angaben (Name, Anschrift, E-Mail) stehen NICHT im öffentlichen Repo,
// sondern kommen aus der .env: LEGAL_NAME, LEGAL_ADDRESS (Zeilen mit "|" trennen),
// LEGAL_EMAIL, optional LEGAL_PHONE. Fehlt etwas, zeigt die Seite einen deutlichen Hinweis,
// damit man es nicht unbemerkt vergisst.

function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function readLegal(env){
  const e = env || process.env;
  const name = (e.LEGAL_NAME || '').trim();
  const address = (e.LEGAL_ADDRESS || '').split('|').map(s => s.trim()).filter(Boolean);
  const email = (e.LEGAL_EMAIL || '').trim();
  const phone = (e.LEGAL_PHONE || '').trim();
  return { name, address, email, phone, complete: !!(name && address.length && email) };
}

const T = {
  de: {
    back: '← Zurück zum Rechner',
    imprintTitle: 'Impressum',
    privacyTitle: 'Datenschutzerklärung',
    missing: 'Die Anbieterangaben sind auf diesem Server noch nicht hinterlegt (LEGAL_NAME, LEGAL_ADDRESS, LEGAL_EMAIL in der .env).',
    provider: 'Anbieter und für den Inhalt verantwortlich',
    contact: 'Kontakt',
    mail: 'E-Mail',
    phone: 'Telefon',
    purpose: 'Unternehmensgegenstand bzw. Zweck',
    purposeText: 'Nicht kommerzielles Hobbyprojekt: Rechner für Charakterwerte im Online-Spiel Neverwinter sowie Hilfen zur Gruppenplanung für eine Spielergilde. Es werden keine Einnahmen erzielt.',
    disclaimerH: 'Hinweis zu Marken',
    disclaimer: 'Neverwinter ist eine Marke der jeweiligen Rechteinhaber. Diese Seite ist ein Fan-Projekt und steht in keiner Verbindung zu den Spielebetreibern.',
    source: 'Quelltext',
    sourceText: 'Der Quelltext dieser Seite ist öffentlich einsehbar:',
  },
  en: {
    back: '← Back to the calculator',
    imprintTitle: 'Legal notice',
    privacyTitle: 'Privacy policy',
    missing: 'The provider details have not been set on this server yet (LEGAL_NAME, LEGAL_ADDRESS, LEGAL_EMAIL in the .env file).',
    provider: 'Provider and responsible for the content',
    contact: 'Contact',
    mail: 'Email',
    phone: 'Phone',
    purpose: 'Purpose',
    purposeText: 'Non-commercial hobby project: a calculator for character stats in the online game Neverwinter, plus tools for group planning for a player guild. No income is generated.',
    disclaimerH: 'Trademarks',
    disclaimer: 'Neverwinter is a trademark of its respective owners. This site is a fan project and is not affiliated with the game publishers.',
    source: 'Source code',
    sourceText: 'The source code of this site is publicly available:',
  },
};

function page(lang, title, body){
  const l = lang === 'en' ? 'en' : 'de';
  return `<!DOCTYPE html>
<html lang="${l}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} – Xselli's Stats-Rechner</title>
<style>
  :root{color-scheme:dark;--bg:#14161c;--card:#1c1f27;--text:#e8e6df;--dim:#a7a49b;--gold:#d9b45a;--border:#2c303b;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px 16px}
  main{max-width:760px;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px 28px}
  h1{margin:0 0 .6em;font-size:1.6rem;text-wrap:balance}
  h2{margin:1.6em 0 .4em;font-size:1.1rem;color:var(--gold)}
  p,li{color:var(--text)} li{margin:.2em 0}
  a{color:var(--gold)}
  .back{display:inline-block;margin-bottom:16px}
  .warn{border:1px solid #c0562f;background:#2a1b16;border-radius:8px;padding:10px 14px;margin:0 0 1em}
  .dim{color:var(--dim);font-size:.9rem}
  :focus-visible{outline:2px solid var(--gold);outline-offset:2px}
</style>
</head>
<body>
<main>
<a class="back" href="/">${esc(T[l].back)}</a>
<h1>${esc(title)}</h1>
${body}
</main>
</body>
</html>`;
}

function providerBlock(lang, L){
  const t = T[lang];
  let h = '';
  if(!L.complete) h += `<p class="warn">${esc(t.missing)}</p>`;
  h += `<h2>${esc(t.provider)}</h2><p>`;
  h += L.name ? esc(L.name) : '–';
  h += L.address.length ? '<br>' + L.address.map(esc).join('<br>') : '';
  h += '</p>';
  h += `<h2>${esc(t.contact)}</h2><p>${esc(t.mail)}: `;
  h += L.email ? `<a href="mailto:${esc(L.email)}">${esc(L.email)}</a>` : '–';
  if(L.phone) h += `<br>${esc(t.phone)}: ${esc(L.phone)}`;
  h += '</p>';
  return h;
}

function imprintHtml(lang, L){
  const t = T[lang];
  const body = providerBlock(lang, L)
    + `<h2>${esc(t.purpose)}</h2><p>${esc(t.purposeText)}</p>`
    + `<h2>${esc(t.disclaimerH)}</h2><p>${esc(t.disclaimer)}</p>`
    + `<h2>${esc(t.source)}</h2><p>${esc(t.sourceText)} <a href="https://github.com/jabure/XselliNWstat" rel="noopener">github.com/jabure/XselliNWstat</a></p>`;
  return page(lang, t.imprintTitle, body);
}

function privacyHtml(lang, L){
  const t = T[lang];
  let body = providerBlock(lang, L).replace(/<h2>[^<]*<\/h2>/, `<h2>${lang === 'en' ? 'Controller' : 'Verantwortlicher'}</h2>`);
  if(lang === 'en'){
    body += `
<h2>What this site does</h2>
<p>You can use the calculator without an account (as a guest). Creating an account is optional and only needed to save characters on the server and to use the group planner and the insignia calculator.</p>
<h2>Data we process</h2>
<ul>
<li><strong>Account:</strong> username, your password (stored only as a salted bcrypt hash, never in plain text), your role (user, moderator, admin), the language you chose.</li>
<li><strong>Your content:</strong> the characters you create (stats, equipment, notes), group-planner characters (name, optional in-game handle, roles, owned items) and group plans.</li>
<li><strong>Transfers:</strong> if you send a character copy to another user, that user sees the character name and your username until the offer is accepted or withdrawn.</li>
<li><strong>IP address:</strong> to limit login and registration attempts the server briefly keeps IP addresses in memory (up to 15 minutes to one hour). They are not written to the data files. The web server or reverse proxy in front of this application may additionally keep ordinary access logs that contain IP addresses.</li>
</ul>
<h2>Visibility to other users</h2>
<p>Group-planner characters (name, in-game handle, roles, owned items) and plan contents can be seen by other logged-in users, because that is the purpose of the planner. Guild administrators can see the list of usernames and roles and can reset or delete accounts. Do not enter anything in these fields that you do not want other members to see.</p>
<h2>Browser storage, no cookies</h2>
<p>This site sets no cookies and uses no tracking, analytics, advertising or external fonts or scripts. It stores the following in your browser's local storage: your login token and username (after login), the last selected character, your language choice, and, as a guest, a temporary copy of your inputs so they survive a reload. You can delete these at any time in your browser settings or by logging out.</p>
<h2>Legal basis</h2>
<p>Providing the account and its functions (Art. 6(1)(b) GDPR) and the security of the service, in particular protection against misuse and brute-force attempts (Art. 6(1)(f) GDPR).</p>
<h2>Storage period and backups</h2>
<p>Account data and characters are kept until the account is deleted. The server creates automatic backups of its data; daily backups are kept for 7 days, so deleted data may remain in a backup for up to that long. Guest inputs never leave your browser.</p>
<h2>Recipients</h2>
<p>Data is stored on a server operated by the controller and is not passed on to third parties or transferred to third countries by this application.</p>
<h2>Your rights</h2>
<p>You have the right of access, rectification, erasure, restriction of processing, data portability and objection (Art. 15–21 GDPR). To delete your account or receive a copy of your data, write to the email address above. You also have the right to lodge a complaint with a supervisory authority; in Austria this is the Datenschutzbehörde (<a href="https://www.dsb.gv.at" rel="noopener">www.dsb.gv.at</a>).</p>
<p class="dim">Do not use your usual passwords from other services here.</p>`;
  } else {
    body += `
<h2>Worum es geht</h2>
<p>Den Rechner kannst du ohne Konto (als Gast) nutzen. Ein Konto ist freiwillig und nur nötig, um Charaktere auf dem Server zu speichern sowie den Gruppenplaner und den Insignienrechner zu nutzen.</p>
<h2>Welche Daten verarbeitet werden</h2>
<ul>
<li><strong>Konto:</strong> Benutzername, dein Passwort (nur als gesalzener bcrypt-Hash gespeichert, nie im Klartext), deine Rolle (Benutzer, Moderator, Admin), die gewählte Sprache.</li>
<li><strong>Deine Inhalte:</strong> die von dir angelegten Charaktere (Werte, Ausrüstung, Notizen), Gruppenplaner-Charaktere (Name, optionaler Ingame-Handle, Rollen, Besitz) und Gruppenpläne.</li>
<li><strong>Übergaben:</strong> Wenn du eine Charakterkopie an eine andere Person sendest, sieht sie bis zur Annahme oder zum Zurückziehen den Charakternamen und deinen Benutzernamen.</li>
<li><strong>IP-Adresse:</strong> Um Anmelde- und Registrierungsversuche zu begrenzen, hält der Server IP-Adressen kurzzeitig im Arbeitsspeicher (zwischen 15 Minuten und einer Stunde). Sie werden nicht in die Datendateien geschrieben. Der Webserver bzw. Reverse Proxy vor dieser Anwendung kann zusätzlich übliche Zugriffsprotokolle mit IP-Adressen führen.</li>
</ul>
<h2>Sichtbarkeit für andere Nutzer</h2>
<p>Gruppenplaner-Charaktere (Name, Ingame-Handle, Rollen, Besitz) und die Inhalte der Pläne sind für andere angemeldete Nutzer sichtbar, das ist der Zweck des Planers. Administratoren sehen die Liste der Benutzernamen und Rollen und können Konten zurücksetzen oder löschen. Trage in diese Felder nichts ein, was andere Mitglieder nicht sehen sollen.</p>
<h2>Speicher im Browser, keine Cookies</h2>
<p>Diese Seite setzt keine Cookies und verwendet weder Tracking, Statistik, Werbung noch externe Schriften oder Skripte. Im lokalen Speicher deines Browsers liegen: dein Anmelde-Token und Benutzername (nach dem Login), der zuletzt gewählte Charakter, deine Sprachwahl und als Gast eine Zwischenkopie deiner Eingaben, damit sie ein Neuladen überstehen. Du kannst das jederzeit in den Browser-Einstellungen oder durch Abmelden löschen.</p>
<h2>Rechtsgrundlage</h2>
<p>Bereitstellung des Kontos und seiner Funktionen (Art. 6 Abs. 1 lit. b DSGVO) sowie die Sicherheit des Dienstes, insbesondere der Schutz vor Missbrauch und Massenanmeldeversuchen (Art. 6 Abs. 1 lit. f DSGVO).</p>
<h2>Speicherdauer und Sicherungen</h2>
<p>Kontodaten und Charaktere bleiben bis zur Löschung des Kontos gespeichert. Der Server legt automatische Sicherungen seiner Daten an; Tagessicherungen werden 7 Tage aufbewahrt, gelöschte Daten können also bis zu dieser Zeit noch in einer Sicherung liegen. Eingaben als Gast verlassen deinen Browser nie.</p>
<h2>Empfänger</h2>
<p>Die Daten liegen auf einem Server, den der Verantwortliche selbst betreibt. Diese Anwendung gibt sie nicht an Dritte weiter und übermittelt sie nicht in Drittländer.</p>
<h2>Deine Rechte</h2>
<p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO). Für die Löschung deines Kontos oder eine Kopie deiner Daten schreib an die oben genannte E-Mail-Adresse. Außerdem kannst du dich bei einer Aufsichtsbehörde beschweren, in Österreich ist das die Datenschutzbehörde (<a href="https://www.dsb.gv.at" rel="noopener">www.dsb.gv.at</a>).</p>
<p class="dim">Verwende hier bitte nicht deine üblichen Passwörter von anderen Diensten.</p>`;
  }
  return page(lang, t.privacyTitle, body);
}

function pickLang(req){
  const q = req.query && req.query.lang;
  if(q === 'en' || q === 'de') return q;
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  return al.startsWith('en') ? 'en' : 'de';
}

function mount(app){
  const send = (render) => (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(render(pickLang(req), readLegal()));
  };
  app.get('/impressum', send(imprintHtml));
  app.get('/datenschutz', send(privacyHtml));
}

module.exports = { mount, readLegal, imprintHtml, privacyHtml };
