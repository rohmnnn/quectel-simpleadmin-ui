# Quectel SimpleAdmin UI

An English, responsive redesign of **SimpleAdmin**, the device web interface from
[iamromulan/quectel-rgmii-toolkit](https://github.com/iamromulan/quectel-rgmii-toolkit/tree/SDXLEMUR)
(SDXLEMUR branch). This front-end rewrite retains the original device CGI endpoints and modem
commands; it does not replace or modify the device-side CGI scripts.

## Attribution

This repository is a redesign fork of
[Keeson1223/quectel-simpleadmin-ui](https://github.com/Keeson1223/quectel-simpleadmin-ui).
The original SimpleAdmin UI design in the forked project is credited to Keeson1223.

SimpleAdmin and quectel-rgmii-toolkit were created by **iamromulan**:
<https://github.com/iamromulan/quectel-rgmii-toolkit>.

This project is derived from that work. The AT response parsing and signal scoring code in
[`www/js/signal.js`](www/js/signal.js) is taken from the original SimpleAdmin home page.
This project is not affiliated with or endorsed by iamromulan or Quectel.

## Features

- Responsive shell: desktop sidebar, tablet icon rail, and phone tab bar with a More menu.
- Light and dark themes, with system preference support and a saved user preference.
- Home dashboard with SIM/network status, signal scoring, RSRP/RSRQ/SINR meters, antenna
  readings, five-minute trends, uptime, temperature, and detailed cell/network values.
- Network configuration: supported LTE/NR band selection, APN, SIM slot, preferred mode,
  NR mode, and LTE/NR cell locking.
- Cell scan and neighboring-cell AT queries.
- SMS inbox, message deletion, and UCS2 multipart sending.
- Device/modem information, custom AT terminal, confirmed IMEI update, and modem restart.
- Settings for QMAP, DHCPv4 DNS, USB networking, TTL override, and AT commands.
- Watchcat status and configuration through the device's existing endpoints.
- Read-only requests on page load. Changes and other potentially writing AT commands require
  confirmation and show the modem's response.
- Polling pauses while the browser tab is hidden; the home refresh interval has a two-second
  minimum.
- Plain HTML, CSS, and JavaScript. No build step, framework, dependency, or CDN is required.

The upstream `simpleadmin/www` inventory is in [docs/PORTING_PLAN.md](docs/PORTING_PLAN.md).
The upstream reference contains no Tailscale page or CGI endpoint, so this UI does not invent a
Tailscale integration. The AT terminal and TTL controls are sections of the upstream Settings
page, not separate upstream pages.

## Repository layout

```text
www/
├── index.html       Home dashboard
├── more.html        Phone More menu and license/about notice
├── network.html     Network preferences, bands, and cell locking
├── scanner.html     Network and neighboring-cell scans
├── sms.html         SMS inbox and sending
├── settings.html    AT terminal, device settings, and TTL
├── deviceinfo.html  Device and modem information
├── watchcat.html    Watchcat configuration and status
├── diagnostics.html Read-only AT command compatibility check
├── css/
│   └── app.css      Design tokens, layout, and shared components
└── js/
    ├── shell.js     Navigation, theme, and status bar
    ├── at.js        Shared modem requests: one-at-a-time queue, timeouts, restart handling
    ├── operators.js MCC+MNC operator names (from the upstream scanner)
    ├── signal.js    AT parsing and signal scoring from upstream
    ├── home.js      Home polling and rendering
    ├── network.js   Network reads and confirmed configuration
    ├── scanner.js   On-demand cell queries
    ├── sms.js       SMS parsing, deletion, and sending
    ├── settings.js  Settings, TTL, and AT terminal
    ├── deviceinfo.js Device information and confirmed device actions
    ├── watchcat.js  Watchcat status and configuration
    └── diagnostics.js Read-only AT command checks and copyable report
docs/
└── PORTING_PLAN.md  Upstream page, script, and CGI inventory
```

`README.zh-CN.md` has been removed because the interface and documentation are now English.

## Compatibility

| Item | Target / validation |
|---|---|
| Modem and firmware | Quectel RG520N-CN, RG520NCNAAR03A01M4G (upstream reference target) |
| Panel | SimpleAdmin Rev-Alpha-0.9, lighttpd 1.4.73 (upstream reference) |
| Browser layout | Locally checked in Chromium at 390, 768, and 1280 CSS-pixel viewport widths |

Device-side CGI and modem behavior have not been tested in this environment. Other SDXLEMUR
modems (including RM520N-GL), firmware variants, and browsers remain unverified. Settings and
optional features depend on the existing device CGI scripts and modem firmware.

## Deploying to the device

Back up `/usrdata/simpleadmin/www` before deployment. The following deploy list contains all
files in this redesign; leave the device's existing `cgi-bin/`, `.htpasswd`, certificates, and
`lighttpd.conf` untouched.

```sh
zip -r www.zip www
```

Copy `www.zip` to `/usrdata/simpleadmin/`
```sh
adb push .\www.zip /usrdata/simpleadmin
```
Then extract it on the device:
```sh
cd /usrdata/simpleadmin
cp -a www "www.bak-$(date +%Y%m%d-%H%M)"
unzip -o www.zip
cd www
FILES="index.html more.html network.html scanner.html sms.html settings.html deviceinfo.html watchcat.html diagnostics.html css/app.css js/shell.js js/at.js js/operators.js js/signal.js js/home.js js/network.js js/scanner.js js/sms.js js/settings.js js/deviceinfo.js js/watchcat.js js/diagnostics.js"
chown root:root $FILES
chmod 644 $FILES
rm ../www.zip
```

Hard-refresh the browser after deployment. CSS and JavaScript cache-busting query strings are
updated together in every page.

**Rollback**

```sh
cd /usrdata/simpleadmin
mv www www.broken
cp -a www.bak-YYYYMMDD-HHMM www
```

## Security and device configuration

Use at your own risk. This UI sends commands to the modem and applies device settings only
after confirmation. Changes can interrupt connectivity or alter device behavior. The UI does
not add or change CGI endpoints. Do not commit certificates or private keys.

## Roadmap

- [x] English UI and responsive app shell
- [x] Home dashboard and status bar
- [x] Network settings, band selection, and cell locking
- [x] Cell scan and neighboring-cell queries
- [x] SMS inbox, deletion, and sending
- [x] Settings, AT terminal, and TTL
- [x] Device information and confirmed IMEI/restart controls
- [x] Watchcat status and settings ported from upstream
- [x] Navigation and mobile More menu
- [x] Deployment file list and upstream inventory

## License

Same as upstream: **MIT License with Additional Stipulations**. See [LICENSE](LICENSE).
In addition to the standard MIT terms:

1. Give clear, visible attribution to iamromulan with a link to the original repository.
2. Do not sell or charge for the software or a modified version. Selling physical products that
   include it is allowed with attribution.
3. Make modifications available on request, including source code and documentation needed to
   understand them.

Because of the no-sale clause, this is not an OSI-approved open-source license.

## Quectel RG501Q-EU notes

This interface was written for another module family. The RG50xQ AT manual (V1.1.1) does not list
several commands the original pages use (`+QRSRP`, `+QRSRQ`, `+QSINR`, `+CGCONTRDP`, `+QMAP`,
`+QCFG="usbnet"`, `+QNWLOCK`, `+QSCAN`, `+QCCID`, `+EGMR`). The pages therefore:

- send one AT command per request, through one shared queue (`js/at.js`), with timeouts;
- show "Not supported" for a feature whose query the modem rejects, instead of failing silently;
- send restart commands (`AT+CFUN=1,1`) fire-and-forget, then wait for the modem to answer again.

Open **Diagnostics** to see exactly which commands your modem answers, and copy the report.
Details: [docs/RG501Q-EU.md](docs/RG501Q-EU.md).
