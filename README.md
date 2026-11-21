# AKM Tube

Eine Video-App in der Art von SmartTube, für **Browser, Handy, Fire TV und Android TV**, mit **einer** gemeinsamen Codebasis.

- Steuerung per Fernbedienung: Steuerkreuz, OK, Zurück und Medientasten (Play/Pause, Vor-/Zurückspulen)
- Bereiche für die AKM-Projekte: **Andy Kay, Comrade East, AK UNIT, PHASE//FORGE**, plus eigene Bereiche
- Videos und Playlists per Link hinzufügen (auch über „Teilen“ aus der YouTube-App am Handy)
- „Weiterschauen“ mit gespeicherter Position, Favoriten, Autoplay, Abspielgeschwindigkeit
- Ohne Shorts, ohne Empfehlungs-Feed und ohne Kommentare, also keine Ablenkung
- Optional mit eigenem YouTube-API-Key: Suche und Kanal-Feeds (neueste Uploads)
- **Eigene Dateien abspielen:** WAV, FLAC, AIFF, MP3, M4A, MP4 … per Link (eigener Webspace, Dropbox) oder direkt vom Gerät
- **AKM-Katalog** (`web/catalog.json`): Releases einmal eintragen, dann erscheinen sie auf allen Geräten
- **Sync zwischen Handy, Browser und TV** über einen Kopplungscode (eigener kleiner Server, kostenlos bei Cloudflare)
- Datenschutz-Modus (youtube-nocookie.com), zusätzlich Backup per Export/Import

> Abgespielt wird über den **offiziellen YouTube-Player**. Werbung wird von YouTube gesteuert und
> nicht entfernt. Damit bleibt die App rechtlich sauber und kann auch als AKM-Produkt genutzt werden.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `web/` | Die eigentliche App (HTML/CSS/JS, PWA, ohne Build-Schritt) |
| `android/` | Kleine Android-Hülle (WebView) für Fire TV, Android TV und Android-Handys |
| `server/` | Sync-Server: Cloudflare Worker (`worker.js`) oder Node.js zum Selbst-Hosten (`node-server.js`) |
| `.github/workflows/android.yml` | Baut die APK automatisch bei jedem Push |

## Browser und Handy

Den Ordner `web/` auf einen beliebigen HTTPS-Webspace hochladen, z. B. GitHub Pages, Netlify oder den eigenen Hoster.
Am Handy die Seite öffnen und **„Zum Startbildschirm hinzufügen“** wählen. Dann läuft sie wie eine App.

Lokal testen: `cd web && python3 -m http.server 8080`, dann http://localhost:8080 öffnen.

## Fire TV und Android TV

1. Auf GitHub unter **Actions → „Android / Fire TV APK“** den letzten Lauf öffnen und das Artefakt **AKMTube-apk** herunterladen (ZIP mit der `.apk`).
2. **Fire TV:** Einstellungen → Mein Fire TV → Entwickleroptionen → „Apps unbekannter Herkunft“ aktivieren.
   Dann die App **Downloader** installieren und die APK per Link laden, z. B. über Dropbox oder Google Drive.
3. **Android TV / Google TV:** genauso über Downloader, alternativ per `adb install AKMTube.apk`.
4. Die App erscheint danach mit eigenem Banner im TV-Launcher.

Die APK kann auch ganz normal auf Android-Handys installiert werden.

## AKM-Katalog (deine Releases)

In `web/catalog.json` trägst du deine Releases ein. Beim nächsten Start erscheinen sie auf jedem Gerät:

```json
{ "id": "phaseforge", "name": "PHASE//FORGE", "items": [
    { "url": "https://youtu.be/VIDEO-ID" },
    { "url": "https://www.youtube.com/playlist?list=PL…", "title": "PHASE//FORGE – Alle Releases" },
    { "url": "https://deinserver.de/previews/track-01.mp3", "title": "Track 01 (Club Master Preview)" }
] }
```

Unter `"channels"` kannst du Kanäle eintragen, z. B. `"@deinkanal"`. Die erscheinen unter „Kanäle“, sobald ein API-Key hinterlegt ist.
Was du in der App löschst, kommt durch den Katalog nicht wieder zurück.

## Eigene Audio- und Videodateien

- **Per Link (auf allen Geräten):** Datei auf den eigenen Webspace (HTTPS) oder in Dropbox legen und den Link unter „Hinzufügen“ einfügen.
  Dropbox-Freigabelinks werden automatisch in Direktlinks umgewandelt.
- **Vom Gerät:** „Hinzufügen → Dateien auswählen…“. Die Datei bleibt auf diesem Gerät und wird nicht synchronisiert.
- Formate: MP3, M4A/AAC, WAV und MP4 laufen überall. FLAC, OGG und WebM laufen auf Android und Fire TV ab etwa Fire OS 6 sowie in Chrome und Firefox.
  AIFF spielt nur Safari ab. Für Pre-Vinyl- und Club-Master also am besten WAV oder FLAC.

## Sync zwischen Geräten einrichten (einmalig, ca. 10 Minuten)

**Variante A: Cloudflare (kostenlos, empfohlen)**
1. Ein kostenloses Konto auf cloudflare.com anlegen. Node.js muss auf dem PC installiert sein.
2. Im Ordner `server/` ausführen:
   ```bash
   npx wrangler login
   npx wrangler kv namespace create SYNC      # ausgegebene id in wrangler.toml eintragen
   npx wrangler deploy                         # zeigt die Adresse, z. B. https://akmtube-sync.<name>.workers.dev
   ```
3. Die Adresse in `web/config.js` bei `syncUrl` eintragen. Dann muss sie auf keinem Gerät mehr eingetippt werden.

**Variante B: eigener Server:** `node server/node-server.js` (Node 18+), betrieben hinter HTTPS.

**Geräte koppeln:** Am TV unter Einstellungen → Sync „Neuen Code erzeugen“ wählen. Den Code (z. B. `ABCD-EFGH-JKLM`) am Handy eingeben und „Verbinden“ drücken.
Danach gleichen sich Bibliothek, Favoriten, Weiterschauen und der API-Key automatisch ab. So musst du den langen API-Key nie am TV eintippen.
Der Code ist der Schlüssel zu deinen Daten, also nicht öffentlich teilen.

## YouTube-API-Key (optional, kostenlos)

1. https://console.cloud.google.com → neues Projekt anlegen
2. „YouTube Data API v3“ aktivieren → Anmeldedaten → API-Schlüssel erstellen
3. In AKM Tube unter **Einstellungen** eintragen

Das kostenlose Kontingent reicht für den privaten Gebrauch locker aus (etwa 100 Suchen pro Tag).

## Bedienung am TV

| Taste | Übersicht | Player |
|---|---|---|
| Steuerkreuz | Navigieren | Leiste sichtbar: Buttons wählen. Leiste ausgeblendet: ◀ ▶ spult 10 s |
| OK | Öffnen | Play/Pause |
| Zurück | Zur Startseite / ins Menü | Player schließen |
| ⏯ ⏪ ⏩ | – | Play/Pause, ±30 s |
