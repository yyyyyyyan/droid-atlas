# Taxonomy

Droid Atlas files every app in one category of its own, inside one of thirteen
regions. The sources' categories are what the sources say; they stay on each
listing and are shown in the app sheet as the source's wording. This page is
generated from the build by `pipeline/scripts/taxonomy-doc.ts`; the table
itself is `pipeline/taxonomy.ts` and the placements are
`pipeline/placements.json`. Build of 2026-11-25: 1,293 entries,
116 categories, 139 upstream categories, 245 placements.

## How an app is filed

1. **A placement wins.** `pipeline/placements.json` places single apps by id,
   each with a one-line reason read from what the sources say about it.
2. **Otherwise its first listing decides**, by source priority (Android FOSS,
   then awesome-shizuku) and position in the list, skipping a listing whose
   upstream category is a catch-all.
3. **An app whose every listing is in a catch-all** waits in the remainder of
   that catch-all's region and is listed in the build report as awaiting
   placement. Today none waits: every such app is placed.

Each app is in exactly one category and one region, so region and category
counts add up to the catalog. An upstream category missing from the table goes
to its source's fallback region's remainder, and the build report lists it. A placement whose app has left the catalog is
reported as stale. The build never fails on the taxonomy.

## Naming

Title case, US English. A category is named for the kind of app, in the
plural (Launchers, Firewalls), or for the subject when the apps are tools for
it (Finance, Weather, Backup). "&" joins at most two such names. Device
categories are named for the maker or the device. A remainder is "Other …".
No category repeats its region's name. The rule is in `docs/COPY.md`.

## Catch-alls

These upstream categories say too little about their apps to map them as a
whole. An app also listed in a category that maps is filed by that listing;
every other app in them was placed by hand.

| Upstream category | Apps | Waits in | Why |
|---|---|---|---|
| Android FOSS: Miscellaneous | 19 | Other Web & World Apps | Android FOSS's own “Miscellaneous”: remote desktop, recorders, timers, wearables and more. |
| Android FOSS: Productivity | 5 | Other Productivity Tools | Named for the whole region: planners, a reading list and a focus app. |
| Android FOSS: System | 30 | Other System Tools | Anything that touches the system: app managers, network monitors, terminals, theming, device info. |
| Android FOSS: Utilities | 38 | Other System Tools | Android FOSS's own catch-all: a link organizer beside a VNC client, an OCR app and a counter. |
| Android FOSS: Games › Miscellaneous | 16 | Other Games | Games of every genre that fit no other heading. |
| Android FOSS: Tools | 9 | Developer Tools | Desktop tools for taking APKs apart, a debloater, a site checker and Shizuku itself. |
| awesome-shizuku: Communication | 13 | Other Communication Apps | Link redirectors, call recorders, Discord mod managers, clipboard and file sharing. |
| awesome-shizuku: Entertainment | 6 | Other Media Apps | A manga reader, a Spotify ad skipper, a link opener and two Bilibili exporters. |
| awesome-shizuku: Miscellaneous | 26 | Other System Tools | awesome-shizuku's own catch-all: recorders, monitors, exploits, Linux and alarms. |
| awesome-shizuku: Productivity | 9 | Other Productivity Tools | Named for the whole region: clipboard tools, focus apps, PC links and a to-do app. |
| awesome-shizuku: Vendor-specific › Other | 9 | Other Devices | Apps for one device each: e-ink tablets, gaming handhelds, a car head unit, a headset. |
| awesome-shizuku: Closed-source apps › Productivity | 1 | Other Productivity Tools | The closed-source page's “Productivity”, as on the open list. |
| awesome-shizuku: Archived apps | 12 | Other System Tools | A status, not a kind of app: anything the list no longer recommends. |

Judged and not catch-alls: awesome-shizuku's **Customization** (64 apps) is
broad but coherent, apps that change how the system looks and behaves; it maps
to System UI & Gestures, and only its launchers, its desktop modes, a
wallpaper, a Pixel toolkit and an Android Auto installer are placed
elsewhere. Android FOSS's **System** (30)
and both lists' **Productivity** are catch-alls: one spans app managers,
network monitors, terminals and theming, the other is named for a whole
region. awesome-shizuku's **Archived apps** is a status, not a kind of app.

## Where some things are, and why

- **awesome-shizuku's Task manager is Monitors & Task Managers**, under
  System & Tweaks. Most of its apps are system monitors and the rest stop
  running processes.
- **Android TV and Android Auto are under Device-specific**, beside the
  makers and the handhelds, because a person with a TV box or a car looks
  there.
- **One kind of app, one category.** Apps that stop or freeze background
  apps are App Freezers, under Apps & Installers, wherever their sources
  file them; desktop modes are Desktop Modes, under Personalization; and
  frame-rate overlays are with Monitors & Task Managers.
- **Smart Home & Wearables is under Automation & Dev Tools.** Its apps
  control a home or a device from the phone: Home Assistant kiosks and wall
  panels, IP camera viewers, a Wear OS remote and Gadgetbridge. That is the
  automation region's business; Web & World holds apps about the world
  outside, such as maps, weather and transit.
- **Each app is in one category.** An app that both sources list appears
  once, so every count adds up to the catalog.
- **The smallest categories hold 2 apps**: Movie & TV Trackers, Office Suites.
  A category is kept, however small, when it is a thing a person looks for by
  name.

## Categories by region

### System & Tweaks: 106 apps

| Category | Apps | Takes in |
|---|---|---|
| Battery & Power | 24 | Android FOSS: Battery; awesome-shizuku: Power management; awesome-shizuku: Closed-source apps › Power management; 1 placed |
| Display Tools | 18 | awesome-shizuku: Display management; awesome-shizuku: Closed-source apps › Display management; 4 placed |
| Quick Settings Tiles | 13 | awesome-shizuku: Quick settings; awesome-shizuku: Closed-source apps › Quick settings |
| Monitors & Task Managers | 23 | awesome-shizuku: Task manager; 12 placed |
| Shizuku & Alternatives | 9 | awesome-shizuku: Shizuku implementations; 1 placed |
| Rooting & Recovery | 10 | Android FOSS: Rooting and Recovery; 3 placed |
| Flashlights | 3 | Android FOSS: Flashlight |
| Other System Tools (remainder) | 6 | 6 placed |

### Apps & Installers: 86 apps

| Category | Apps | Takes in |
|---|---|---|
| App Stores & Updaters | 29 | Android FOSS: App Store; awesome-shizuku: Installer & app stores; 1 placed |
| Installers | 9 | 9 placed |
| App Managers | 23 | awesome-shizuku: Software management; awesome-shizuku: Closed-source apps › Software management; 4 placed |
| App Freezers | 12 | 12 placed |
| Patchers & Mods | 8 | awesome-shizuku: Patching; 4 placed |
| Backup | 5 | Android FOSS: Backup; 2 placed |

### Files & Sync: 84 apps

| Category | Apps | Takes in |
|---|---|---|
| File Managers | 36 | Android FOSS: File Manager; awesome-shizuku: File management; awesome-shizuku: Closed-source apps › File management |
| File Tools | 7 | 7 placed |
| Sharing & PC Link | 18 | Android FOSS: File Sharing; 5 placed |
| Cloud & Sync | 10 | Android FOSS: Synchronisation |
| Downloaders | 13 | Android FOSS: Downloader & Manager; 2 placed |

### Automation & Dev Tools: 102 apps

| Category | Apps | Takes in |
|---|---|---|
| Automation Tools | 22 | Android FOSS: Automation; awesome-shizuku: Automation; awesome-shizuku: Closed-source apps › Automation; 3 placed |
| AI Agents | 21 | awesome-shizuku: AI agents; awesome-shizuku: Closed-source apps › AI agents |
| Developer Tools (remainder) | 30 | Android FOSS: Development; awesome-shizuku: Development utilities; awesome-shizuku: Closed-source apps › Development utilities; 4 placed |
| APK Tools | 7 | 7 placed |
| Terminals & Linux | 10 | Android FOSS: Terminals; awesome-shizuku: Terminals; awesome-shizuku: Closed-source apps › Terminals; 4 placed |
| Remote Access | 5 | 5 placed |
| Smart Home & Wearables | 7 | 7 placed |

### Device-specific: 68 apps

| Category | Apps | Takes in |
|---|---|---|
| Samsung | 15 | awesome-shizuku: Vendor-specific › Samsung OneUI; awesome-shizuku: Closed-source apps › Vendor-specific › Samsung OneUI; 1 placed |
| Google Pixel | 12 | awesome-shizuku: Vendor-specific › Google Pixel; 1 placed |
| Xiaomi | 13 | awesome-shizuku: Vendor-specific › MIUI; awesome-shizuku: Closed-source apps › Vendor-specific › MIUI; 1 placed |
| Nothing Phone | 3 | awesome-shizuku: Vendor-specific › Nothing Phone |
| Gaming Handhelds | 8 | awesome-shizuku: Vendor-specific › AYN; 2 placed |
| E-ink Tablets | 3 | 3 placed |
| Android TV | 4 | awesome-shizuku: Android TV |
| Android Auto | 7 | awesome-shizuku: Android Auto; awesome-shizuku: Closed-source apps › Android Auto; 2 placed |
| Other Devices (remainder) | 3 | 3 placed |

### Privacy, Security & Network: 138 apps

| Category | Apps | Takes in |
|---|---|---|
| Network Tools | 34 | awesome-shizuku: Network; awesome-shizuku: Closed-source apps › Network; 10 placed |
| Privacy Tools | 20 | Android FOSS: Privacy & Security; awesome-shizuku: Privacy; 3 placed |
| Passwords & 2FA | 17 | Android FOSS: Password & Authentication; 1 placed |
| VPNs & Proxies | 17 | Android FOSS: VPN; 3 placed |
| Firewalls | 9 | Android FOSS: Firewall; 3 placed |
| Ad Blockers | 8 | Android FOSS: Ad Blocker; 2 placed |
| Link Tools | 10 | Android FOSS: URL Manipulation; 4 placed |
| Profiles & Device Owner | 15 | Android FOSS: Sandboxing; awesome-shizuku: Device owner (DPM); 8 placed |
| Encryption | 4 | Android FOSS: File Encryption |
| Safety & Anti-Theft | 4 | 4 placed |

### Personalization: 141 apps

| Category | Apps | Takes in |
|---|---|---|
| System UI & Gestures | 53 | awesome-shizuku: Customization; awesome-shizuku: Closed-source apps › Customization; 5 placed |
| Desktop Modes | 8 | 8 placed |
| Launchers | 24 | Android FOSS: Launcher & Desktop; 3 placed |
| Keyboards | 22 | Android FOSS: Keyboard; 2 placed |
| Buttons & Controllers | 17 | awesome-shizuku: Input methods; awesome-shizuku: Closed-source apps › Input methods; 1 placed |
| Wallpapers | 14 | Android FOSS: Wallpapers; 1 placed |
| Icon Packs | 3 | Android FOSS: Icon Packs |

### Communication: 72 apps

| Category | Apps | Takes in |
|---|---|---|
| Messengers | 27 | Android FOSS: Messaging |
| Social & Forums | 17 | Android FOSS: Community Clients; 2 placed |
| Calls & Contacts | 14 | Android FOSS: Call Blocker & Spam Filter; Android FOSS: Contacts; Android FOSS: Dialer; 4 placed |
| Email | 9 | Android FOSS: Email Aliases; Android FOSS: Email Clients |
| SMS Apps | 5 | Android FOSS: SMS |

### Media: 148 apps

| Category | Apps | Takes in |
|---|---|---|
| Music Streaming & Radio | 20 | Android FOSS: Music & Radio Streaming Player |
| Video Streaming Clients | 18 | Android FOSS: Media Frontends; 2 placed |
| Music Making | 16 | Android FOSS: Music |
| Sound & Volume | 16 | awesome-shizuku: Audio; awesome-shizuku: Closed-source apps › Audio; 2 placed |
| Music Players | 12 | Android FOSS: Music & Audio Player |
| Podcasts & Audiobooks | 10 | Android FOSS: Podcast & Audio Book Player |
| Video Players | 9 | Android FOSS: Video Player |
| Image Tools | 9 | Android FOSS: Image Manipulation |
| Cameras | 8 | Android FOSS: Camera |
| Anime & Manga | 7 | Android FOSS: Anime & Manga; 1 placed |
| Galleries | 6 | Android FOSS: Image Viewer & Gallery |
| Drawing & Painting | 6 | Android FOSS: Graphics |
| Screen & Audio Recorders | 6 | 6 placed |
| Video Editors | 3 | Android FOSS: Video Editor |
| Movie & TV Trackers | 2 | Android FOSS: Movie & Cinema |

### Productivity: 150 apps

| Category | Apps | Takes in |
|---|---|---|
| Notes & Journals | 27 | Android FOSS: Diary; Android FOSS: Notes; 1 placed |
| E-book & Document Readers | 14 | Android FOSS: Document & PDF Viewer; 1 placed |
| Calculators & Converters | 10 | Android FOSS: Calculator; 1 placed |
| Habits & Time Tracking | 10 | Android FOSS: Habit Tracker; 3 placed |
| To-Do & Planners | 10 | Android FOSS: ToDo Lists; 5 placed |
| Finance | 9 | Android FOSS: Finance |
| Dictionaries | 8 | Android FOSS: Dictionaries |
| Scanners & PDF Tools | 8 | Android FOSS: Document Scanner & Editor; 1 placed |
| Clocks & Timers | 9 | Android FOSS: Clock & Time; 2 placed |
| Translators | 6 | Android FOSS: Translation; 1 placed |
| Focus & Screen Time | 7 | 7 placed |
| Speech & Voice | 6 | Android FOSS: Text-to-Speech; 3 placed |
| Text Editors | 5 | Android FOSS: Text Editors |
| Barcode & QR Scanners | 4 | Android FOSS: Barcode & QR Code Scanner |
| Calendars | 5 | Android FOSS: Calendar |
| Bookmarks & Read Later | 3 | 3 placed |
| Clipboard Tools | 3 | 3 placed |
| Flashcards | 3 | Android FOSS: Flashcard |
| Office Suites | 2 | Android FOSS: Office |
| Other Productivity Tools (remainder) | 1 | 1 placed |

### Web & World: 84 apps

| Category | Apps | Takes in |
|---|---|---|
| Browsers | 17 | Android FOSS: Browser; 1 placed |
| Maps & Navigation | 15 | Android FOSS: Maps & Navigation; 1 placed |
| Health & Sports | 12 | Android FOSS: Sports & Health; 1 placed |
| Weather | 11 | Android FOSS: Weather |
| Science & Education | 10 | Android FOSS: Science & Education |
| RSS Readers | 10 | Android FOSS: RSS Readers; 1 placed |
| Religion | 4 | Android FOSS: Religion |
| Public Transit | 3 | Android FOSS: Public Transport |
| Other Web & World Apps (remainder) | 2 | 2 placed |

### Games: 101 apps

| Category | Apps | Takes in |
|---|---|---|
| Game Tools | 22 | awesome-shizuku: Games; awesome-shizuku: Closed-source apps › Games |
| Puzzle Games | 14 | Android FOSS: Games › Puzzle; 2 placed |
| Board & Card Games | 14 | Android FOSS: Games › Board; Android FOSS: Games › Card; 1 placed |
| Educational Games | 11 | Android FOSS: Games › Educational; 1 placed |
| Arcade Games | 7 | Android FOSS: Games › Retro; 6 placed |
| Strategy Games | 8 | Android FOSS: Games › Strategy |
| Emulators | 8 | Android FOSS: Games › Emulator |
| Word Games | 6 | Android FOSS: Games › Word; 1 placed |
| Racing & Sports Games | 4 | Android FOSS: Games › Racing; 1 placed |
| Music Games | 3 | Android FOSS: Games › Music |
| Other Games (remainder) | 4 | 4 placed |

### Guides & Further Reading: 13 links

| Category | Links | Takes in |
|---|---|---|
| App Lists & Repositories | 9 | Android FOSS: Getting more … |
| Tutorials & References | 4 | Android FOSS: Tutorials and Guides |

## Placements

Grouped by the category they place into. A reason that names an upstream
category marks an app moved out of a category that maps elsewhere, because
nobody would look for it there; the rest come from catch-alls.

### Battery & Power

- **Reboot** (`com.aistudio.reboot.vtwpkc`): Reboots into recovery, fastboot and other modes, as RebootNya here does.

### Display Tools

- **Coffee** (`com.github.muellerma.coffee`): Keeps the display awake.
- **Coffee** (`com.openappslabs.coffee`): Keeps the screen from dimming or locking.
- **Middor** (`org.nktnet.middor`): Mirrors apps for a head-up display.
- **Red Moon** (`com.jmstudios.redmoon`): A screen filter for night-time use; Android FOSS files it under Sports & Health.

### Monitors & Task Managers

- **CPU Info** (`com.kgurgul.cpuinfo`): Shows information about the device's hardware and software.
- **Treble Info** (`tk.hack5.treblecheck`): Shows the device's Treble, A/B and architecture details.
- **USB Descriptor Explorer** (`org.kaijinlab.usbdevinfo`): Inspects connected USB devices.
- **abCheck** (`github-abanana84-abcheck`): Device and system diagnostics with live monitors.
- **PhoneDiagnosticTool** (`github-scoobydouche-phonediagnostictool`): Diagnostics for CPU, GPU, battery, RAM, storage and sensors.
- **Fern** (`github-wized2-fern`): A live monitor for CPU, RAM, storage, battery and network.
- **Device Watch** (`org.jarsi.devicewatch`): A device monitor with per-app usage insights.
- **FPS-Meter-Android** (`com.rdevzph.fpsmeter`): An FPS overlay and game performance monitor.
- **FPSViewer** (`github-binhmod-fpsviewer`): An FPS overlay with a graph.
- **DroidPerf** (`github-fortifying-droidperf`): An FPS and hardware telemetry overlay.
- **FrameX-Android** (`github-maheshsharan-framex-android`): A real-time performance overlay.
- **TakoStats** (`rikka.fpsmonitor`): An FPS and performance overlay.

### Shizuku & Alternatives

- **Shizuku** (`moe.shizuku.privileged.api`): Shizuku itself.

### Rooting & Recovery

- **PoC-Deployer-System** (`github-wqry085-poc-deployer-system`): Deploys a privilege-escalation exploit.
- **ghostlock-app** (`github-yukonga-ghostlock-app`): A privilege-escalation app that grants temporary root.
- **MMRL** (`com.dergoogler.mmrl`): Manages Magisk module repositories; awesome-shizuku files it under Software management.

### Other System Tools

- **Omni** (`uk.akane.omni`): A toolbox of a compass, a spirit level, a ruler and a flashlight; no one category holds all four.
- **HiddenAlarmRevealer** (`github-ahmetcanarslan-hiddenalarmrevealer`): Explains the status bar's alarm icon; no category names this.
- **NotiFixer** (`github-dkajan19-notifixer`): Makes notifications persistent; no category names this.
- **VineOS** (`github-hexadecinull-vineos`): An Android virtual-machine engine; no category names this.
- **KeiOS** (`github-hosizoraru-keios`): A system console with several unrelated tools.
- **TinyKit** (`github-order52-tinykit`): One-tap tweaks that span several categories.

### App Stores & Updaters

- **UpgradeAll** (`net.xzos.upgradeall`): Checks for updates of Android apps; awesome-shizuku files it under Software management.

### Installers

- **Universal Installer** (`app.pwhs.universalinstaller`): Installs APK packages, split APKs included.
- **SAI** (`com.aefyr.sai.fdroid`): An installer for split APKs.
- **PI** (`dev.sanmer.pi`): A package installer.
- **InstallWithOptions** (`dev.zwander.installwithoptions`): Installs APKs with advanced options.
- **KingInstaller** (`github-fcaronte-kinginstaller`): An APK installer.
- **Shizuku Package Installer** (`github-vvb2060-packageinstaller`): A replacement app installer.
- **InstallerX-Revived** (`github-wxxsfxyzm-installerx-revived`): A replacement app installer.
- **OpenLoader** (`github-thebytearray-openloader`): An APK installer.
- **APKMirror Installer** (`com.apkmirror.helper.prod`): Installs app bundles and APK files; awesome-shizuku files it under Software management.

### App Managers

- **De-Bloater** (`com.sunilpaulmathew.debloater`): Removes bloat from system apps.
- **AppManager** (`io.github.muntashirakon.AppManager`): A full-featured package manager.
- **Universal Android Debloater GUI** (`github-universal-debloater-alliance-universal-android-debloater-next-generation`): Debloats devices over ADB.
- **AppBooster** (`github-androidexpert35-appbooster`): Re-optimizes the code of installed apps.

### App Freezers

- **NoMoreBackground** (`com.adilhanney.no_more_background`): Stops apps from running in the background.
- **Battery Tool** (`io.github.domi04151309.batterytool`): Stops apps running in the background automatically.
- **Stop** (`github-burakgon-stop`): Force-stops chosen apps after you leave them.
- **OnStop2FinishAndRemoveTask** (`io.github.takusan23.onstop2finishandremovetask`): Closes chosen apps when you leave them, to save power and memory.
- **volt** (`github-lebiggg-volt`): Hibernates apps, as Greenify did.
- **KillMyApps** (`github-dedeadend-killmyapps`): Kills background processes.
- **shappky** (`github-yassernull-shappky`): Stops background apps.
- **ReAppzuku** (`github-gree1d-reappzuku`): Controls background apps; a fork of shappky.
- **SuperFreezZ** (`superfreeze.tool.android`): Freezes apps' background activity.
- **FreezeYou** (`cf.playhi.freezeyou`): An app freezer.
- **Hail** (`com.aistra.hail`): Freezes, hides or disables apps.
- **Ice Box** (`com.catchingnow.icebox`): Freezes or hides apps.

### Patchers & Mods

- **ReVanced Manager** (`github-revanced-revanced-manager`): Applies ReVanced patches.
- **Aliucord-Manager** (`github-aliucord-manager`): A Discord modding tool.
- **KettuManager** (`github-c0c0b01-kettumanager`): A Discord modding tool.
- **revenge-manager** (`github-revenge-mod-revenge-manager`): A Discord modding tool.

### Backup

- **SMS Import / Export** (`com.github.tmo1.sms_ie`): Imports and exports SMS, MMS and other data.
- **SwiftBackup** (`org.swiftapps.swiftbackup`): Backs up apps and their files; awesome-shizuku files it under File management.

### File Tools

- **Amaze File Utilities** (`com.amaze.fileutilities`): Analyzes, transfers and opens files.
- **DeadHash** (`com.codedead.deadhash`): Calculates file hashes.
- **EtchDroid** (`eu.depau.etchdroid`): Writes OS images to USB drives.
- **HexViewer** (`fr.ralala.hexviewer`): A hexadecimal file viewer.
- **CSV Editor** (`tech.brianrayburn.csv_editor`): Views and edits CSV files.
- **SD Maid 2/SE** (`eu.darken.sdmse`): A cleaning tool; awesome-shizuku files it under File management.
- **XClean** (`github-utopiafar-xclean`): A cleaner for app junk; awesome-shizuku files it under File management.

### Sharing & PC Link

- **Sefirah** (`com.castle.sefirah`): Links a Windows PC and the phone for clipboard, notifications and files.
- **input-leaf** (`github-anasvhora284-input-leaf`): Controls the phone with a PC's mouse and keyboard.
- **KDE Connect (Shizuku)** (`github-batestinha-kdeconnect-android-shizuku`): A KDE Connect fork; KDE Connect sits here.
- **CatShare** (`moe.reimu.catshare`): Sends and receives files over Bluetooth.
- **plain-app** (`com.ismartcoding.plain`): Manages the phone's files, media and messages from a computer's browser.

### Downloaders

- **BiliDownOut** (`cn.a10miaomiao.bilidown`): Exports videos the Bilibili app downloaded.
- **hlbmerge_flutter** (`github-molihuan-hlbmerge-flutter`): Turns Bilibili's downloaded cache files into MP4.

### Automation Tools

- **NoPopping** (`awesome-shizuku-nopopping`): Turns Do Not Disturb on automatically.
- **AutoDND** (`moe.dic1911.autodnd`): Turns Do Not Disturb on automatically while chosen apps are in use; awesome-shizuku files it under Customization.
- **Geto** (`com.android.geto`): Applies device settings per app; its fork IMD is listed under Automation.

### Developer Tools

- **Json List** (`com.sjapps.jsonlist`): Previews JSON from a file or URL.
- **shizuku_apk_installer** (`github-re7gog-shizuku-apk-installer`): A Flutter plugin for developers.
- **ServiceManagerCompat** (`github-sanmerapps-servicemanagercompat`): ServiceManager bindings for developers.
- **Anywhere** (`github-zhaobozhen-anywhere`): Shortcuts to app activities and shell commands.

### APK Tools

- **APKToolGUI** (`github-andnixsh-apktoolgui`): A GUI for apktool and APK signing tools.
- **APKLab** (`github-apklab-apklab`): A reverse-engineering workbench for APKs.
- **Apktool** (`github-ibotpeaches-apktool`): Reverse-engineers APK files.
- **APK Editor Studio** (`github-kefir500-apk-editor-studio`): An APK editor.
- **APK2Url** (`github-n0mi1k-apk2url`): Extracts endpoints from APKs.
- **ACVTool** (`github-pilgun-acvtool`): Measures code coverage of Android apps.
- **KeyStoreViewer** (`com.seiko.keystoreviewer`): Inspects app and APK signing certificates.

### Terminals & Linux

- **ConnectBot** (`org.connectbot`): An SSH client.
- **AutoPie** (`com.autopi`): Turns Linux commands into Android apps.
- **Nix-on-Droid** (`com.termux.nix`): The Nix package manager for Android.
- **FluxLinux** (`com.ivarna.fluxlinux`): Runs Linux desktops on Android.

### Remote Access

- **AVNC** (`com.gaurav.avnc`): A VNC client.
- **droidVNC-NG** (`net.christianbeier.droidvnc_ng`): A VNC server.
- **RustDesk** (`com.carriez.flutter_hbb`): A remote desktop app.
- **Moonlight** (`com.limelight`): Plays games streamed from a PC.
- **telegram-rc** (`github-telegram-sms-telegram-rc`): Controls the device remotely through Telegram messages.

### Smart Home & Wearables

- **Cams** (`com.vladpen.cams`): Views IP cameras.
- **Motion Eye** (`com.jairaj.janglegmail.motioneye`): Streams surveillance network cameras.
- **Gadgetbridge** (`nodomain.freeyourgadget.gadgetbridge`): Works with smart watches and other Bluetooth devices.
- **SimpleWear** (`com.thewizrd.simplewear`): Controls the phone from a Wear OS watch.
- **kiosk-satellite** (`github-jxlarrea-kiosk-satellite`): A Home Assistant kiosk.
- **panel-assistant** (`github-panel-assistant-android`): A Home Assistant wall-panel dashboard.
- **Home Assistant** (`io.homeassistant.companion.android.minimal`): Controls a Home Assistant smart home; Android FOSS files it under Automation.

### Samsung

- **ScamsungFonts** (`github-khunhtetznaing-scamsungfonts`): A font manager for Samsung Galaxy.

### Google Pixel

- **essentials** (`github-sameerasw-essentials`): Tools and mods for Pixels; awesome-shizuku files it under Customization.

### Xiaomi

- **mtbtool-android-app** (`github-h3nnes-mtbtool-android-app`): Band locking on Qualcomm-based Xiaomi devices.

### Gaming Handhelds

- **flipx** (`github-jlgrimes-flipx`): For the Anbernic RG Rotate handheld.
- **Calibrate-SoC** (`github-mayusi-calibrate-soc`): A tuner and monitor for Android gaming handhelds.

### E-ink Tablets

- **BooxUltimatum** (`github-huuunleashed-booxultimatum`): For BOOX e-ink tablets.
- **SuperBoox** (`github-rn-os-superboox`): For ONYX BOOX e-ink tablets.
- **InkPalm+** (`github-rn-os-inkpalm-plus`): For the Moaan InkPalm Plus e-ink device.

### Android Auto

- **AAAD** (`github-shmykelsa-aaad`): Installs third-party Android Auto apps; awesome-shizuku files it under Customization.
- **DiAuto** (`github-shihabal3amri-diauto`): An Android Auto receiver for BYD head units.

### Other Devices

- **RedTrigger** (`com.redtrigger`): For Nubia Red Magic phones; no category names that maker.
- **MindControl** (`github-dinico414-mindcontrol`): For the iKKO MindOne; no category names that maker.
- **Evolve_Launcher_v2** (`github-jarjarblinkz-evolve-launcher-v2`): For Meta Quest headsets; no category names that device.

### Network Tools

- **Data Monitor** (`com.drnoob.datamonitor`): Tracks data usage.
- **5G** (`com.openappslabs.fiveg`): Forces the 5G network mode.
- **NFCGate** (`de.tu_darmstadt.seemoo.nfcgate`): An NFC research toolkit.
- **OONI Probe** (`org.openobservatory.ooniprobe`): Measures internet censorship, speed and performance.
- **NodeLook** (`ir.ammari.nodelook`): Checks websites for people facing internet restrictions.
- **Network Survey** (`com.craxiom.networksurvey`): Surveys cellular, Wi-Fi, Bluetooth and GNSS.
- **PCAPdroid** (`com.emanuelef.remote_capture`): A network monitor and packet capture.
- **WifiAnalyzer** (`com.vrem.wifianalyzer`): Analyzes Wi-Fi networks.
- **Captive Portal Controller** (`io.github.muntashirakon.captiveportalcontroller`): Controls how Android detects captive portals.
- **NekokoLPA2** (`github-iebb-nekokolpa2`): An eSIM manager.

### Privacy Tools

- **Just Delete Me** (`com.amanoteam.kurt`): Links for deleting accounts from web services.
- **Permission Pilot** (`eu.darken.myperm`): An overview of app permissions.
- **Auditor** (`github-grapheneos-auditor`): Hardware attestation and intrusion detection.

### Passwords & 2FA

- **Monica** (`github-monica-pass-monica`): A password vault with TOTP; awesome-shizuku files it under Privacy.

### VPNs & Proxies

- **InviZible Pro** (`pan.alexander.tordnscrypt.stable`): Tor, DNSCrypt and I2P.
- **sing-box** (`io.nekohasekai.sfa`): A universal proxy platform; awesome-shizuku files it under Network.
- **NaiveproxyForAndroid** (`github-dobiec-naiveproxyforandroid`): Runs NaiveProxy; awesome-shizuku files it under Network.

### Firewalls

- **ShizuWall** (`com.arslan.shizuwall`): An app firewall; awesome-shizuku files it under Network.
- **FireWall Blocks** (`com.shayan.firewall`): A firewall; awesome-shizuku files it under Network.
- **NetWall** (`com.ysy.app.firewall`): An app firewall; awesome-shizuku files it under Network.

### Ad Blockers

- **ADNS** (`com.eyalm.adns`): A DNS-based ad blocker; awesome-shizuku files it under Network.
- **hikari-adblock** (`github-codegeasse1-hikari-adblock`): An ad, tracker and malware blocker; awesome-shizuku files it under Network.

### Link Tools

- **Lemmy Redirect** (`dev.zwander.lemmyredirect`): Opens Lemmy links in your chosen client.
- **Mastodon Redirect** (`dev.zwander.mastodonredirect`): Opens fediverse links in your chosen client.
- **Bluesky Redirect** (`github-turtlepaw-blueskyredirect`): Opens Bluesky links in your chosen client.
- **Crosstune** (`github-astrovm-crosstune`): Opens music links in your chosen app.

### Profiles & Device Owner

- **Headwind MDM Agent** (`com.hmdm.launcher`): A mobile device management agent.
- **HardenDroid** (`github-oddbyte-hardendroid`): Manages users without root.
- **Island** (`com.oasisfeng.island`): Isolates and clones apps, as Shelter and Insular here do; awesome-shizuku files it under Software management.
- **CloneCat** (`github-ahmetcanarslan-clonecat`): Clones apps across the work profile, private space and secondary users.
- **AppDualZuku** (`github-nathanatgit-appdualzuku`): Runs app instances in managed profiles.
- **CloneSpace** (`github-udmodz0-adb-cloner`): Runs extra copies of apps in separate profiles.
- **User-Hopper** (`github-dlawoals2713-user-hopper`): Creates and manages guest and secondary users.
- **Youki Users** (`github-mryouki-youki-users`): Creates, switches and deletes user profiles.

### Safety & Anti-Theft

- **Keep Alive** (`io.keepalive.android`): Notifies others when the device goes unused.
- **Stay Put** (`org.y20k.stayput`): Guards against theft while charging in public.
- **Mafza** (`github-yshalsager-mafza`): Runs emergency actions.
- **FindMyDevice** (`de.nulide.findmydevice`): Finds a lost device; awesome-shizuku files it under Network.

### System UI & Gestures

- **Dark theme** (`com.phstudio.darktheme`): Turns on the dark theme.
- **DarQ** (`github-kieronquinn-darq`): Forces dark mode per app.
- **AutoDark** (`github-0ranko0p-autodark`): Schedules dark mode.
- **setbox** (`github-yassernull-setbox`): Changes system settings through modules, as the settings editors here do.
- **FabricateOverlay** (`github-zacharee-fabricateoverlay`): Manages fabricated overlays.

### Desktop Modes

- **Taskbar** (`com.farmerbb.taskbar`): Opens apps from a start menu.
- **Smart Dock** (`cu.axel.smartdock`): Turns the phone into a desktop with a taskbar and a start menu.
- **DroidOS** (`github-katsuyamaki-droidos`): A tiling window manager that replaces Samsung DeX.
- **YoukiDEX** (`github-mryouki-youkidex-android-desktop`): A desktop experience layer for Android.
- **Extendroid** (`github-legendsayantan-extendroid`): Adds desktop-like multi-window support.
- **magicdesk** (`github-mekhontsev-magicdesk`): A workstation with windows, external displays and desktops.
- **Dextop** (`github-naryuki-dextop`): A desktop environment with multitasking and a custom resolution.
- **AG Displays** (`com.htl.agdisplays`): Opens a desktop mode on virtual displays, or apps on external ones.

### Launchers

- **SysReadout-Launcher** (`github-andsni-sysreadout-launcher`): A terminal-style home screen launcher; awesome-shizuku files it under Customization.
- **Jarngreipr** (`github-brianjr03-jarngreipr`): A launcher for dual-screen gaming devices; awesome-shizuku files it under Customization.
- **DevBay-Launcher** (`github-zoder-studio-devbay-launcher`): A developer-focused launcher; awesome-shizuku files it under Customization.

### Keyboards

- **BiBi Keyboard** (`github-brycewg-bibi-keyboard`): A voice input keyboard; awesome-shizuku files it under Input methods.
- **pastiera** (`github-palsoftware-pastiera`): A keyboard for physical-keyboard devices; awesome-shizuku files it under Input methods.

### Buttons & Controllers

- **VolumeScroll** (`com.yeapguy.volumescroll`): Scrolls with the volume buttons.

### Wallpapers

- **LogCat Live Wallpaper** (`github-yassernull-logcat-live-wallpaper`): A live wallpaper; awesome-shizuku files it under Customization.

### Social & Forums

- **Mastodon** (`org.joinmastodon.android`): The Mastodon app; Android FOSS files it under Messaging, and other Mastodon clients sit here.
- **Moshidon** (`github-lucasggamerm-moshidon`): A Mastodon client; Android FOSS files it under Messaging.

### Calls & Contacts

- **ShizuCallRecorder** (`com.kitsumed.shizucallrecorder`): Records phone calls.
- **GhostMode** (`github-foxlape-ghostmode`): Makes the phone look unavailable for incoming calls.
- **cally** (`github-lyosu-cally`): A call recorder.
- **Call Recorder (Skvalex)** (`awesome-shizuku-call-recorder-skvalex`): A call recorder; awesome-shizuku files it under Audio.

### Video Streaming Clients

- **BendyStraw** (`rocks.mm_dev.BendyStraw`): Manages NewPipe's databases.
- **Odysee** (`com.odysee.floss`): A client for the Odysee video service.

### Sound & Volume

- **Granular Volume: Quiet Dial** (`github-rzuss-granular-volume`): Volume control below Android's minimum.
- **Hush** (`github-coldmew-hush`): Skips Spotify ad breaks, as Spotify Ad Skipper here does.

### Anime & Manga

- **Mihon** (`github-mihonapp-mihon`): A manga reader.

### Screen & Audio Recorders

- **Audio Recorder** (`gitlab-axet-android-audio-recorder`): An audio recorder, as its name says; the source gives no description.
- **Fossify Voice Recorder** (`org.fossify.voicerecorder`): A voice recorder.
- **Rainy Screenshot** (`github-catmiaozhi-rainyscreenshot`): Screenshots and screen recording.
- **Screen Recorder** (`github-muhammadhaseebiqbal-dev-screen-recorder`): A screen recorder.
- **IrisShot** (`github-raging-flames-irisshot`): Takes scrolling screenshots.
- **CaptureCap** (`github-yepgoryo-capturecap`): Records the screen and audio.

### Notes & Journals

- **Orgro** (`com.madlonkay.orgro`): Reads and edits Org Mode notes.

### E-book & Document Readers

- **Openreads** (`software.mdev.bookstracker`): A books tracker and reading list.

### Calculators & Converters

- **Converter NOW** (`com.ferrarid.converterpro`): A unit converter.

### Habits & Time Tracking

- **Track & Graph** (`com.samco.trackandgraph`): Records and graphs habits and daily activities.
- **BetterCounter** (`org.kde.bettercounter`): Tracks good and bad habits by counting them.
- **Simple Time Tracker** (`com.razeeman.util.simpletimetracker`): A time tracker for work, study and habits.

### To-Do & Planners

- **Flux** (`com.flux`): Plans the day and manages tasks.
- **Super Productivity** (`com.superproductivity.superproductivity`): A to-do list, time tracker and daily planner.
- **TimePlanner** (`ru.aleshin.timeplanner`): Plans the day.
- **Timeto.me** (`me.timeto.app`): Goals, checklists, tasks and time tracking.
- **Cresto** (`github-nevodev-cresto`): A to-do app.

### Scanners & PDF Tools

- **OCR** (`io.github.subhamtyagi.ocr`): Reads text from images (OCR).

### Clocks & Timers

- **Cuppa** (`com.nathanatos.Cuppa`): Times a cup of tea.
- **silent-alarm** (`github-izumisagirii-silent-alarm`): An alarm clock.

### Translators

- **overlay-translator** (`github-ciddwd-overlay-translator`): An on-screen translator.

### Focus & Screen Time

- **PlugBrain** (`app.plugbrain.android`): Blocks apps to reduce screen time.
- **Screen Time** (`de.markusfisch.android.screentime`): Shows screen time.
- **Goodtime** (`com.apps.adrcotfas.goodtime`): A productivity timer against distractions.
- **DetoxDroid** (`com.flx_apps.digitaldetox`): A digital detox app.
- **Curbox** (`neth.iecal.curbox`): Reduces screen addiction.
- **Ripple** (`awesome-shizuku-ripple`): A screen-time and app blocker.
- **Nudge** (`dev.astraedus.nudge`): An app blocker that delays opening an app.

### Speech & Voice

- **TTS Util** (`com.danefinlay.ttsutil`): A text-to-speech utility.
- **Voice Notify** (`com.pilot51.voicenotify`): Speaks notifications aloud with text-to-speech.
- **Whisper** (`org.woheller69.whisper`): Voice recognition.

### Bookmarks & Read Later

- **Linkora** (`com.sakethh.linkora`): A link organizer.
- **LinkHub** (`com.amrdeveloper.linkhub`): A link manager.
- **Read Later** (`io.github.sak.read.it.later`): A reading list.

### Clipboard Tools

- **ClipHistory** (`app.cliphistory`): Saves copied text.
- **HyperCopy** (`github-1812z-hypercopy`): Opens copied links in the right app.
- **ClipShare** (`github-aa2013-clipshare`): Syncs the clipboard across devices.

### Other Productivity Tools

- **quickdash** (`github-balajitechlabs-quickdash`): A floating dashboard of payment and chat shortcuts; no category names this.

### Browsers

- **TxtNet-Browser** (`github-lukeaschenbrenner-txtnet-browser`): Browses the web over SMS.

### Maps & Navigation

- **Navit** (`org.navitproject.navit`): A car navigation system; Android FOSS files it under Downloader & Manager.

### Health & Sports

- **Blink** (`github-character-flat-blink`): An eye-care timer.

### RSS Readers

- **Nextcloud News** (`de.luhmer.owncloudnewsreader`): A feed reader for Nextcloud News; Android FOSS files it under Synchronisation.

### Other Web & World Apps

- **Offline Web Search** (`io.github.rumcajs.offlinewebsearch`): An offline directory of websites and feeds; no category names this.
- **AirData UAV** (`com.airdata.uav.app`): Drone flight analysis; awesome-shizuku files it under File management for its access to app data.

### Puzzle Games

- **Xeonjia** (`xyz.deepdaikon.xeonjia`): Ice puzzles.
- **Zoysii** (`xyz.deepdaikon.zoysii`): A logic game.

### Board & Card Games

- **Dooz** (`io.github.yamin8000.dooz`): Tic-tac-toe.

### Educational Games

- **DekaDico** (`com.example.spokennumbers`): A memory trainer for spoken numbers.

### Arcade Games

- **Apple Flinger** (`com.gitlab.ardash.appleflinger.android`): A slingshot game.
- **Destination Sol** (`com.miloshpetrov.sol2.android`): A 2D space arcade game.
- **Ball2Box** (`com.simondalvai.ball2box`): Swipe to shoot the ball.
- **Breakout 71** (`me.lecaro.breakout`): Break the bricks.
- **Falling Blocks** (`org.sajeg.fallingblocks`): Catch the falling blocks of your color.
- **Quinb** (`xyz.deepdaikon.quinb`): A reaction game.

### Word Games

- **WordleSolver** (`org.billthefarmer.solver`): Solves Wordle puzzles.

### Racing & Sports Games

- **Pocket Broomball** (`com.simondalvai.pocketbroomball`): A broomball game.

### Other Games

- **Burger Party** (`com.agateau.burgerparty`): A burger-making game; no genre here names it.
- **Endless Sky** (`github-thewierdnut-endless-mobile`): A sandbox space exploration and trading game; no genre here names it.
- **Luanti** (`net.minetest.minetest`): A voxel game platform of many genres.
- **Space Vertex Multiplayer** (`fr.arnaudguyon.spacevertex`): A multiplayer cat-and-mouse game; no genre here names it.

## Left in remainders

An app goes to a remainder when the sources do not plainly say where it
belongs. Each is placed there on purpose, with its reason above.

- **Other System Tools** (System & Tweaks): Omni, HiddenAlarmRevealer, NotiFixer, VineOS, KeiOS, TinyKit.
- **Developer Tools** (Automation & Dev Tools): Json List, shizuku_apk_installer, ServiceManagerCompat, Anywhere. It is also an ordinary category, which its upstream categories map into.
- **Other Devices** (Device-specific): RedTrigger, MindControl, Evolve_Launcher_v2.
- **Other Communication Apps** (Communication): none today.
- **Other Media Apps** (Media): none today.
- **Other Productivity Tools** (Productivity): quickdash.
- **Other Web & World Apps** (Web & World): Offline Web Search, AirData UAV.
- **Other Games** (Games): Burger Party, Endless Sky, Luanti, Space Vertex Multiplayer.

2 remainders are empty and are not shown in the app until something lands in them.
