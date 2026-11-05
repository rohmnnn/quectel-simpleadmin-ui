# SimpleAdmin page-port inventory

This inventory was prepared from the local upstream reference at
`../quectel-rgmii-toolkit-upstream/simpleadmin/www`. The upstream assets are
reference-only; no upstream files are copied into this repository.

The inventory includes every upstream HTML page, JavaScript file, and CGI
endpoint. `watchcat_backup.html` is an upstream alternate/backup implementation,
not a separate user-facing feature; its behavior is accounted for on the
Watchcat page.

| Upstream page / asset | Purpose | CGI endpoints / AT commands used | New file name | Status |
|---|---|---|---|---|
| `index.html` | Home dashboard: SIM/network state, signal, traffic, uptime, and connectivity | `/cgi-bin/get_atcommand` (`AT+QTEMP;+QUIMSLOT?;+QSPN;+CGCONTRDP=1;+QMAP="WWANIP";+QENG="servingcell";+QCAINFO;+QSIMSTAT?;+CSQ;+QGDNRCNT?;+QGDCNT?`); `/cgi-bin/get_ping`; `/cgi-bin/get_uptime` | `www/index.html` (existing) | Complete; translated, read-only |
| `network.html` | Network preferences, band selection, and LTE/5G cell locking | `/cgi-bin/get_atcommand`; query `AT+QNWPREFCFG` for UE bands, policy bands, LTE/NSA/SA bands, network mode, NR mode; query `AT+QUIMSLOT?;+CGCONTRDP=1;+QNWLOCK="common/4g";+QNWLOCK="common/5g";+QNWPREFCFG="mode_pref";+QNWPREFCFG="nr5g_disable_mode";+QCAINFO;+CGDCONT?`; writes `AT+QNWPREFCFG=...`, `AT+QNWLOCK="common/4g",...`, `AT+QNWLOCK="common/5g",...`, and band restore | `www/network.html`, `www/js/network.js` | Complete; writes confirmed |
| `scanner.html` | Cellular network scan and serving/neighbour cell measurements | `/cgi-bin/get_atcommand`; `AT+QSCAN=3,1`; `AT+QENG="neighbourcell";+QNWCFG="nr5g_meas_info",1;+QNWCFG="nr5g_meas_info"` | `www/scanner.html`, `www/js/scanner.js` | Complete; on demand; NR measurement setup requires confirmation |
| `sms.html` | Read SMS messages, send SMS, and delete selected/all messages | `/cgi-bin/get_atcommand` (inbox query `AT+CSCA?;+CMGL="ALL"`; confirmed SMS setup `AT+CSMS=1;+CSDH=0;+CNMI=2,1,0,0,0;+CMGF=1;+CSCA?;+CSMP=17,167,0,8;+CPMS="ME","ME","ME";+CSCS="UCS2"`; `AT+CMGD=...`); `/cgi-bin/send_sms` | `www/sms.html`, `www/js/sms.js` | Complete; send, delete, and modem setup confirmed |
| `settings.html` | Device settings, AT command tools, USB networking, DHCP DNS, and TTL | `/cgi-bin/get_atcommand`; `/cgi-bin/user_atcommand`; `/cgi-bin/get_ttl_status`; `/cgi-bin/set_ttl`; commands include ATI, `AT+CFUN=1,1`, `AT&F`, `AT+QMAP="MPDN_RULE"...`, `AT+QMAPWAC=1`, `AT+QMAP="DHCPV4DNS",...`, and `AT+QCFG="usbnet",0..3` | `www/settings.html`, `www/js/settings.js` | Complete; writes confirmed |
| `deviceinfo.html` | Device/modem information, custom AT query, IMEI change, and modem restart | `/cgi-bin/get_atcommand`; query `AT+CGMI;+CGMM;+QGMR;+CIMI;+ICCID;+CGSN;+QMAP="LANIP";+QMAP="WWAN";+CNUM`; writes `AT+EGMR=1,7,...` and `AT+CFUN=1,1` | `www/deviceinfo.html`, `www/js/deviceinfo.js` | Complete; writes confirmed |
| `watchcat.html` | Configure Watchcat connectivity monitoring and read its current status | `/cgi-bin/watchcat_maker`; `/cgi-bin/get_watchcat_status` | `www/watchcat.html`, `www/js/watchcat.js` | Complete; ported active upstream implementation |
| `watchcat_backup.html` | Stale alternate Watchcat form; its footer says it is still under development | `/cgi-bin/watchcat_maker` | Covered by `www/watchcat.html`; no separate navigation page planned | Inventory only; no additional working behavior beyond the active page |
| `js/alpinejs.min.js` | Upstream Alpine.js UI/runtime dependency | None | None; do not carry dependency into plain-JS redesign | Not ported |
| `js/bootstrap.bundle.min.js` | Upstream Bootstrap UI/runtime dependency | None | None; do not carry dependency into plain-JS redesign | Not ported |
| `js/dark-mode.js` | Upstream dark-mode behavior | None | `www/js/shell.js` | Replaced by redesigned shell |
| `js/generate-freq-box.js` | Generates frequency/band input controls for network settings | None | `www/js/network.js` | Ported as responsive LTE cell-lock fields |
| `js/parse-settings.js` | Parses modem network/band settings | None | `www/js/network.js` | Ported with guarded response parsing |
| `js/populate-checkbox.js` | Builds LTE/NSA/SA band checkboxes and cell-lock controls | None | `www/js/network.js` | Ported using device-reported supported bands |
| `cgi-bin/get_atcommand` | Reads/query modem AT commands | AT command string supplied by the calling page | Existing device endpoint; no new CGI file | Keep calls compatible; do not copy/modify endpoint |
| `cgi-bin/get_ping` | Checks connectivity by pinging `8.8.8.8` | None | Existing device endpoint; no new CGI file | Keep call compatible |
| `cgi-bin/get_ttl_status` | Reads current TTL rule/value | None | Existing device endpoint; no new CGI file | Keep call compatible |
| `cgi-bin/get_uptime` | Returns device uptime | None | Existing device endpoint; no new CGI file | Keep call compatible |
| `cgi-bin/get_watchcat_status` | Reads Watchcat configuration/status | None | Existing device endpoint; no new CGI file | Keep call compatible |
| `cgi-bin/send_sms` | Sends an SMS via the modem serial interface | SMS payload is sent as the endpoint's query data | Existing device endpoint; no new CGI file | Keep call compatible |
| `cgi-bin/set_ttl` | Applies the requested TTL value/rule | None | Existing device endpoint; no new CGI file | Keep call compatible |
| `cgi-bin/set_watchcat` | Writes Watchcat configuration | None | Existing device endpoint; no new CGI file | Present in upstream CGI folder, but not referenced by any upstream HTML or JavaScript; do not call unless further device-side evidence requires it |
| `cgi-bin/user_atcommand` | Sends user-supplied AT commands | User-entered AT command | Existing device endpoint; no new CGI file | Keep call compatible; confirm before writes |
| `cgi-bin/watchcat_maker` | Creates/updates Watchcat configuration | None | Existing device endpoint; no new CGI file | Keep call compatible; confirm before applying changes |

## Porting notes

- All user-facing upstream pages are represented in the redesigned UI. The
  Watchcat backup is an unfinished alternate form, not a separate feature.
- Existing device CGI endpoints and modem command behavior are compatibility
  boundaries. No new endpoints or configuration behavior will be introduced.
- Before applying settings or sending a write command, the UI must request
  confirmation, disable the action while it runs, and display the result.
- Any page polling must pause while the browser tab is hidden and use an
  interval of at least two seconds.
- The upstream tree has no Tailscale HTML page or Tailscale CGI endpoint. Tailscale
  was therefore not added. The AT terminal and TTL controls are sections of the
  upstream Settings page rather than separate upstream pages.
