# SimpleAdmin UI for the Quectel RG501Q-EU

An English, responsive web interface for the **Quectel RG501Q-EU** 5G modem. It is a redesign of
**SimpleAdmin**, the device web interface from
[iamromulan/quectel-rgmii-toolkit](https://github.com/iamromulan/quectel-rgmii-toolkit/tree/SDXLEMUR)
(SDXLEMUR branch), adapted to the RG501Q-EU. It only replaces the web pages (`www`): the device's existing CGI
scripts, web server and certificates stay untouched. It adds a safer one-click cell lock and a Diagnostics page.

## Attribution

This repository is a redesign fork of
[Keeson1223/quectel-simpleadmin-ui](https://github.com/Keeson1223/quectel-simpleadmin-ui).
The original SimpleAdmin UI design in the forked project is credited to Keeson1223.

SimpleAdmin and quectel-rgmii-toolkit were created by **iamromulan**:
<https://github.com/iamromulan/quectel-rgmii-toolkit>.

This project is derived from that work. The AT response parsing and signal scoring code in
[`www/js/signal.js`](www/js/signal.js) and the operator name table in
[`www/js/operators.js`](www/js/operators.js) are taken from the original SimpleAdmin.
This project is not affiliated with or endorsed by iamromulan or Quectel.

## RG501Q-EU compatibility

Checked with the Diagnostics page on firmware **RG501QEUAAR13A01M4G**. The AT manual for this modem (RG50xQ V1.1.1,
2020) does not list several commands, but this firmware answers most of them:

| Feature | Commands | Result on RG501QEUAAR13A01M4G |
|---|---|---|
| Home: SIM, operator, signal, temperature, bands, carrier aggregation | `+QENG`, `+CSQ`, `+QTEMP`, `+QSPN`, `+QNWINFO`, `+QCAINFO` | Works. Carriers and their bandwidth come from `+QCAINFO` (SINR is in dB on this firmware) |
| Home: per-antenna values | `+QRSRP`, `+QRSRQ`, `+QSINR` | Works (not in the manual) |
| Home: IPv4 and IPv6, APN | `+QMAP="WWAN"`, `+CGPADDR`, `+CGCONTRDP` | Works. `+CGPADDR` puts IPv4 and IPv6 in one quoted string and writes IPv6 as 16 decimal bytes: the UI converts it |
| Network: bands, mode, NR mode, APN, SIM slot | `+QNWPREFCFG`, `+CGDCONT`, `+QUIMSLOT` | Works |
| Cell lock | `+QNWLOCK="common/4g"` / `"common/5g"` | Accepted (not in the manual) |
| Cell scan | `+QSCAN` (and `+COPS=?` as fallback) | `+QSCAN` is accepted |
| Serving and neighboring cells | `+QENG="servingcell"` / `"neighbourcell"` | Works |
| SMS | `+CMGF`, `+CSCS`, `+CPMS`, `+CMGL`, `+CMGD`, `+CMGS` | Setup commands accepted; delete-all is `AT+CMGD=1,4` |
| Settings: IP passthrough rules, USB protocol | `+QMAP="MPDN_RULE"`, `+QCFG="usbnet"` | Accepted |
| Settings: DNS proxy | `+QMAP="DHCPV4DNS"` | **Rejected** by this firmware: the controls are greyed out |
| Device info | `+CGMI`, `+CGMM`, `+QGMR`, `+CIMI`, `+QCCID`/`+ICCID`, `+CGSN`, `+QMAP="LANIP"` | Works. A SIM without a stored number shows no phone number |
| Interface status | `+QCFG="data_interface"`, `"pcie/mode"`, `+QETH` | Works |
| Device resources | load average from the existing `get_uptime`; CPU %, memory, storage from the optional `get_resources` | Load average works at once. The rest needs the script (below) |

Other firmware versions may differ: run **Diagnostics** (`/diagnostics.html`) and press **Copy report**. Identifiers
(IMEI, IMSI, ICCID, phone numbers, IP addresses) are hidden in the report by default.

## Features

- Responsive shell: desktop sidebar, tablet icon rail, phone tab bar with a More menu; light and dark themes.
- Home dashboard with SIM/network status, **device resources** (CPU %, load, memory, storage), signal scoring, per-antenna values, **carrier aggregation** (the combined 4G carriers such as B3 + B1, with bandwidth, PCI, RSRP and the 5G carrier when connected), trends, uptime, temperature, IPv4 and IPv6.
- Connection label: **4G** (one carrier), **4G+** (carrier aggregation), **4G + 5G** (NSA) or **5G SA**.
- **One-click cell lock** with safety checks (see below).
- Network configuration: supported LTE/NR bands, APN, SIM slot, preferred mode, NR mode, manual cell lock.
- SMS inbox, deletion and sending, with an optional default country code.
- Device information, AT terminal, confirmed IMEI update and modem restart, Watchcat, TTL override.
- Every modem request goes through one queue with a timeout, so a page never waits forever. Restart commands are sent
  without waiting for an answer, followed by a countdown until the modem answers again.
- Read-only requests on page load. Changes need a confirmation and show the modem's response.
- Plain HTML, CSS and JavaScript. No build step, framework, dependency or CDN.

## Cell lock

1. Open **Cell scan** and press **Read serving and neighboring cells**.
2. Press **Lock** on the cell you want (the serving cell or a neighbor). Cells found by **Scan** have a Lock button too.
3. Read the confirmation. The page has already checked the cell and warns you about:
   - a cell of **another operator** than your SIM (the modem cannot connect to it and only searches),
   - a **band that is switched off** on the modem (Network page).
4. After the lock the radio is restarted (airplane mode off/on, a few seconds) so the lock is used at once.
5. The page then waits up to 30 seconds for the modem to connect. If it cannot, **the lock is removed automatically**.

If the modem is stuck on "searching" anyway, press **Unlock 4G** and **Unlock 5G** (Cell scan > Cell lock). They work
while the modem is searching. A lock is kept after a restart until you unlock it.

Notes: 5G needs a band. It is read from the serving cell; for neighbors it is derived from the ARFCN and you are asked
when two bands overlap. The 5G command is tried in both parameter orders (PCI first, as Quectel documents, then ARFCN
first, as the original SimpleAdmin sends it) and the working order is remembered. Neighbors without a PCI cannot be
locked. On a 5G NSA connection the LTE anchor cell matters too: locking only the 5G cell can lose 5G.

## Repository layout

```text
www/
├── index.html        Home dashboard
├── more.html         Phone More menu
├── network.html      Network preferences, bands, manual cell lock
├── scanner.html      Cell scan, serving/neighboring cells, one-click lock
├── sms.html          SMS inbox and sending
├── settings.html     AT terminal, device settings, TTL
├── deviceinfo.html   Device and modem information
├── watchcat.html     Watchcat
├── diagnostics.html  Read-only AT command compatibility check
├── css/app.css       Design tokens, layout, components
├── cgi-bin/          get_resources (optional, read-only: CPU %, memory, storage)
└── js/               at.js (modem requests, IP parsing, cell lock helpers), shell.js, home.js, signal.js,
                      network.js, scanner.js, sms.js, settings.js, deviceinfo.js, watchcat.js, diagnostics.js,
                      operators.js
docs/                 RG501Q-EU.md (command notes), PORTING_PLAN.md (upstream inventory)
```

## Install

Only the `www` folder is replaced. Back up first, and leave the device's `cgi-bin`, certificates and `lighttpd.conf` alone.

```sh
# on the PC: push the web files (adb)
adb push www /tmp/ui-www
adb shell
# on the modem:
cd /usrdata/simpleadmin
cp -a www "www.bak-$(date +%Y%m%d-%H%M)"
cp -a /tmp/ui-www/. www/
```

(`/usrdata/simpleadmin/www` is the upstream location. `cp -a /tmp/ui-www/. www/` copies the new files over the old ones
and keeps the existing `cgi-bin` folder.) Hard-refresh the browser afterwards: the CSS and JS links carry a version
query string, so the new files are loaded.

**Device resources (optional script).** The Home page shows the load average without any extra file. For CPU %, memory and
storage, `www/cgi-bin/get_resources` must be executable on the modem (adb push can drop the executable bit):

```sh
chmod 755 /usrdata/simpleadmin/www/cgi-bin/get_resources
```

**Load average is not CPU %.** It counts the tasks that are running or waiting, including tasks stuck waiting for hardware
(a driver or the modem firmware). On an embedded modem that number often stays near 1.00 even when the CPU is idle, so
the Load box has no bar. Use the **CPU** box for how busy the processor really is.

The script only reads `/proc` and `df`, takes half a second to answer and changes nothing. Home asks for it every 5 seconds
and stops asking if it is not installed. The shell scripts in `cgi-bin` must keep LF line endings (not CRLF).

**Rollback:** `cd /usrdata/simpleadmin && mv www www.broken && cp -a www.bak-YYYYMMDD-HHMM www`

## Troubleshooting

| Symptom | What to check |
|---|---|
| IPv6 empty, only IPv4 | The APN IP type must be **IPV4V6** (Network > APN). Then check `AT+QMAP="WWAN"` in Diagnostics |
| A field on Home is empty | Run Diagnostics: the field is missing when its command shows `ERROR` |
| 5G does not show although a phone gets it | 5G shows only while data flows. Start a download, then read the cells: an `NR5G-NSA` row means it works. The page also prints the `AT+QENDC` result (does this LTE cell offer 5G?). Check that your 5G bands (for example n40 and n41) are enabled on the Network page and that antennas are connected to all four ports |
| After a cell lock the modem only searches | Press **Unlock 4G** and **Unlock 5G**. Most often the cell belongs to another operator, its band is switched off, or it has no real signal |
| Page says the device did not answer | The AT port may be busy. Wait a few seconds: the UI sends one request at a time and pauses after a timeout |
| Device resources only show the load | `chmod 755 /usrdata/simpleadmin/www/cgi-bin/get_resources`, then reload |
| Settings row greyed out | The modem rejected that command (for example the DNS proxy). Diagnostics shows which ones |

## Security and device configuration

Use at your own risk. This UI sends commands to the modem and applies device settings only after confirmation.
Changes can interrupt connectivity or alter device behavior. The pages have no login of their own: upstream's
`lighttpd.conf` can require a Basic-auth login over HTTPS (`/opt/etc/.htpasswd`, changed with `simplepasswd`),
which is the way to protect the interface. Do not commit certificates, private keys or passwords.

## License

Same as upstream: **MIT License with Additional Stipulations**. See [LICENSE](LICENSE).
In addition to the standard MIT terms:

1. Give clear, visible attribution to iamromulan with a link to the original repository.
2. Do not sell or charge for the software or a modified version. Selling physical products that
   include it is allowed with attribution.
3. Make modifications available on request, including source code and documentation needed to
   understand them.

Because of the no-sale clause, this is not an OSI-approved open-source license.
