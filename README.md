# AKM Tube

Eine Video-App in der Art von SmartTube, für **Browser, Handy, Fire TV und Android TV**, mit **einer** gemeinsamen Codebasis.

- Steuerung per Fernbedienung: Steuerkreuz, OK, Zurück und Medientasten (Play/Pause, Vor-/Zurückspulen)
- Bereiche für die AKM-Projekte: **Andy Kay, Comrade East, AK UNIT, PHASE//FORGE**, plus eigene Bereiche
- Videos und Playlists per Link hinzufügen (auch über „Teilen“ aus der YouTube-App am Handy)
- „Weiterschauen“ mit gespeicherter Position, Favoriten, Autoplay, Abspielgeschwindigkeit
- Ohne Shorts, ohne Empfehlungs-Feed und ohne Kommentare, also keine Ablenkung
- Optional mit eigenem YouTube-API-Key: Suche und Kanal-Feeds (neueste Uploads)
- Datenschutz-Modus (youtube-nocookie.com), Backup per Export/Import zum Übertragen zwischen Geräten

> Abgespielt wird über den **offiziellen YouTube-Player**. Werbung wird von YouTube gesteuert und
> nicht entfernt. Damit bleibt die App rechtlich sauber und kann auch als AKM-Produkt genutzt werden.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `web/` | Die eigentliche App (HTML/CSS/JS, PWA, ohne Build-Schritt) |
| `android/` | Kleine Android-Hülle (WebView) für Fire TV, Android TV und Android-Handys |
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
