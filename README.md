# Quectel SimpleAdmin UI

English | [简体中文](README.zh-CN.md)

A redesigned, responsive web interface for **SimpleAdmin**, the web admin panel of
[iamromulan/quectel-rgmii-toolkit](https://github.com/iamromulan/quectel-rgmii-toolkit/tree/SDXLEMUR)
(SDXLEMUR branch). It is a full front-end rewrite of a Chinese-localized SimpleAdmin build
(Rev-Alpha-0.9). The interface language is Simplified Chinese.

> **Status: work in progress.** Only the app shell and the home page have been rewritten.
> The other pages (network, scan, SMS, settings, device info) are still the original
> SimpleAdmin pages on the device.

## Attribution

SimpleAdmin and quectel-rgmii-toolkit are created by **iamromulan**:
<https://github.com/iamromulan/quectel-rgmii-toolkit>.

This project is derived from that work through a Chinese-localized build and is distributed
under the same license. The AT response parsing and signal scoring code in
[`www/js/signal.js`](www/js/signal.js) is taken verbatim from the original SimpleAdmin home page.

This project is not affiliated with or endorsed by iamromulan or Quectel.

## Features

**App shell**

- Sidebar on desktop (≥ 1024 px), icon rail on tablet (768–1023 px), bottom tab bar on phones.
- Light and dark themes. Follows the system setting until the user picks one; the choice is
  stored in `localStorage`.
- Status bar showing how long ago data was last read.

**Home page**

- Overall signal gauge. The score combines RSRP and SINR with the same algorithm as the
  original page, so readings match the old UI.
- Tier meters for RSRP, RSRQ and SINR.
- Per-antenna readings (PRX / DRX / RX2 / RX3) with a 4G / 5G switch.
- RSRP and SINR trend charts for the last 5 minutes (up to 150 points). Gaps where no data
  was read are left blank instead of being drawn as zero.
- Summary cards: connection, network, module temperature, SIM.
- Collapsible detail tables: PCI, cell ID, TAC, EARFCN, band, bandwidth, CSQ, APN,
  IPv4 / IPv6, MCCMNC.
- Adjustable refresh interval (minimum 2 s), pause button, and automatic pause while the
  browser tab is hidden.

**Watchcat page**: placeholder only. It calls no endpoint, because Watchcat does not work on
the tested firmware.

## Design principles

- **Presentation layer only.** Uses only CGI endpoints that already exist on the device. No new
  endpoints, no changes to AT commands or device configuration.
- **Read-only home page.** It only sends query AT commands.
- **No build step, no dependencies.** Plain HTML, CSS and JavaScript.

## Endpoints used

| Endpoint | Purpose |
|---|---|
| `GET /cgi-bin/get_atcommand?atcmd=…` | One batched AT query per refresh: `+QSIMSTAT?` `+CSQ` `+QTEMP` `+QUIMSLOT?` `+QSPN` `+CGCONTRDP=1` `+QMAP="WWANIP"` `+QENG="servingcell"` `+QNWINFO` `+QRSRP` `+QRSRQ` `+QSINR` |
| `GET /cgi-bin/get_ping` | Latency (only when a SIM is active) |
| `GET /cgi-bin/get_uptime` | Uptime |

## Compatibility

| Item | Tested with |
|---|---|
| Modem | Quectel RG520N-CN |
| Firmware | RG520NCNAAR03A01M4G |
| Panel | SimpleAdmin Rev-Alpha-0.9 (Chinese build), lighttpd 1.4.73 |
| Browser | Chrome on macOS |

Other SDXLEMUR modems (for example RM520N-GL) and other browsers have not been tested yet.

## Repository layout

```text
www/
├── index.html       Home page
├── more.html        "More" menu (phone tab bar)
├── watchcat.html    Watchcat placeholder
├── css/app.css      Design tokens, layout, components
└── js/
    ├── shell.js     Navigation, theme, status bar
    ├── signal.js    AT parsing and signal scoring (verbatim from the original page)
    └── home.js      Home page polling and rendering
```

## Deploying to the device

You need a root shell on the modem (adb, SSH or the ttyd web console) and SimpleAdmin
installed at `/usrdata/simpleadmin`. Only the seven files above are added or replaced. Leave
everything else on the device untouched: other pages, `cgi-bin/`, `.htpasswd`, certificates
and `lighttpd.conf`.

1. Pack the files on your computer. `COPYFILE_DISABLE=1` keeps macOS from adding `._*` files.

   ```sh
   COPYFILE_DISABLE=1 tar -C www -cf ui.tar .
   ```

2. Copy `ui.tar` to `/usrdata/simpleadmin/` on the device with whatever method you have.
   Avoid `/tmp`, which may be cleared.

3. On the device, back up and extract:

   ```sh
   cd /usrdata/simpleadmin
   cp -a www "www.bak-$(date +%Y%m%d-%H%M)"
   tar -xf ui.tar -C www
   cd www
   FILES="index.html more.html watchcat.html css/app.css js/shell.js js/signal.js js/home.js"
   chown root:root $FILES
   chmod 644 $FILES
   rm ../ui.tar
   ```

4. Hard-refresh the browser. When you change CSS or JS, bump the `?v=` query string in the
   three HTML files so browsers fetch the new files.

**Rollback**

```sh
cd /usrdata/simpleadmin
mv www www.broken
cp -a www.bak-YYYYMMDD-HHMM www
```

## Removing the "Not secure" warning (optional)

The device ships with a self-signed certificate, so browsers mark it as not secure. One way
to fix it:

1. On your computer, create a local CA with [mkcert](https://github.com/FiloSottile/mkcert) and
   issue a certificate whose SAN includes `IP:192.168.225.1` (or your device IP).
2. Back up `/usrdata/simpleadmin/server.crt` and `server.key`, replace them with the new pair,
   keep the original file permissions, and run `systemctl reload lighttpd`.
3. Import the CA root certificate on every client device.

The CA private key (`rootCA-key.pem`) must stay on your computer. Never copy it to the device
and never commit certificates or keys; `.gitignore` already excludes `*.pem`, `*.key` and
`*.crt`.

## Roadmap

- [x] App shell
- [x] Home page
- [ ] Network
- [ ] Scan
- [ ] SMS
- [ ] Settings
- [ ] Device info
- [ ] Watchcat (blocked: not working on the tested firmware)

## Disclaimer

Use at your own risk. The home page is read-only, but pages still under development may send
AT commands that change modem settings. Quectel is a trademark of Quectel Wireless Solutions
Co., Ltd.

## License

Same as upstream: **MIT License with Additional Stipulations**. See [LICENSE](LICENSE).
On top of the standard MIT terms:

1. You must give clear, visible attribution to the original author (iamromulan), with a link to
   the original repository.
2. The software and any modified version must not be sold or charged for. Selling physical
   products that include it is allowed with attribution.
3. Modifications must be made available on request, including source code and the
   documentation needed to understand them.

Because of the no-sale clause, this is not an OSI-approved open-source license.
