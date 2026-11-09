# RG501Q-EU AT compatibility (from AT Commands Manual V1.1.1 Preliminary, 2020-10-09)

Source: `at-manual.txt` (converted from the PDF). "Not in manual" does **not** prove the firmware rejects a command
(the manual is a 2020 preliminary version), it only means there is no documented support. The diagnostics page
(see prompt below) confirms what your modem really answers.

## Commands the current UI home page sends

| Command | In manual? | Notes / fix |
|---|---|---|
| `+QSIMSTAT?` | Yes (4.10) | Response `+QSIMSTAT: <enable>,<inserted_status>` |
| `+CSQ` | Yes (5.3) | OK |
| `+QTEMP` | Yes (12.5) | Multi-line, values are **quoted strings**: `+QTEMP:"cpu0-a7-usr","27"`. Sensor names differ per module. Do not hardcode one sensor, show max numeric value (or the chip/case sensor if present). |
| `+QUIMSLOT?` | Yes (4.11) | Slot 1 or 2. Manual example has a typo (`+QUSIMSLOT`), accept both. If ERROR, hide the SIM slot field. |
| `+QSPN` | Yes (5.10) | OK |
| `+CGCONTRDP=1` | **Not in manual** | Use `+CGPADDR=1` (9.7) for the IP and `+CGDCONT?` (9.2) for the APN. Keep CGCONTRDP only as optional, tolerate ERROR. |
| `+QMAP="WWANIP"` | **Not in manual** | Replace with `+CGPADDR=1`. |
| `+QENG="servingcell"` | Yes (5.11) | Format depends on mode, see below. |
| `+QNWINFO` | Yes (5.9) | Manual's access-technology list has no NR5G. Take the RAT from `+QENG="servingcell"` instead. Can return `+QNWINFO: No Service`. |
| `+QRSRP` | **Not in manual** | Likely source of ERROR. No per-antenna command exists in this manual. |
| `+QRSRQ` | **Not in manual** | Same. |
| `+QSINR` | **Not in manual** | Same. |
| `+QCAINFO` | Yes (5.12) | LTE carrier aggregation only (`"LTE BAND n"`, bandwidth in RB units 6/15/25/50/75/100). |

### `+QENG="servingcell"` formats (watch the field order)

- **LTE:** `+QENG: "servingcell",<state>,"LTE",<is_tdd>,<MCC>,<MNC>,<cellID>,<PCID>,<earfcn>,<freq_band_ind>,<UL_bw>,<DL_bw>,<TAC>,<RSRP>,<RSRQ>,<RSSI>,<SINR>,<CQI>,<tx_power>,<srxlev>`
- **EN-DC (NSA), 3 lines:**
  - `+QENG: "servingcell",<state>`
  - `+QENG: "LTE",<is_tdd>,<MCC>,<MNC>,<cellID>,<PCID>,<earfcn>,<freq_band_ind>,<UL_bw>,<DL_bw>,<TAC>,<RSRP>,<RSRQ>,<RSSI>,<SINR>,<CQI>,<tx_power>,<srxlev>` (no `"servingcell"` prefix on this line)
  - `+QENG: "NR5G-NSA",<MCC>,<MNC>,<PCID>,<RSRP>,<SINR>,<RSRQ>,<ARFCN>,<band>` (**SINR comes before RSRQ here**)
- **SA:** `+QENG: "servingcell",<state>,"NR5G-SA",<duplex_mode>,<MCC>,<MNC>,<cellID>,<PCID>,<TAC>,<ARFCN>,<band>,<NR_DL_bandwidth>,<RSRP>,<RSRQ>,<SINR>,<tx_power>,<srxlev>`
- LTE `<SINR>` is raw. Manual formula: `Y = (1/5) × X × 10 − 20` (dB). NR SINR is already in dB (-20 to 30).
- `<NR_DL_bandwidth>` is an index (0=5 MHz … 11=100 MHz, 12=200, 13=400), not MHz.
- LTE `<DL_bandwidth>` is an index (0=1.4, 1=3, 2=5, 3=10, 4=15, 5=20 MHz).

If the original parser assumes the RG520N-CN layout (field positions, SINR/RSRQ order, extra fields), it will mis-assign values on the RG501Q-EU.
Parse by mode string and by position from this table, never by regex on the whole blob.

## Commands other SimpleAdmin pages likely need

| Page | Command | In manual? | Notes |
|---|---|---|---|
| Network / bands | `+QNWPREFCFG="mode_pref"` | Yes (5.15.5) | Values `AUTO`, `WCDMA`, `LTE`, `NR5G`, colon separated (e.g. `LTE:NR5G`) |
| | `+QNWPREFCFG="lte_band"` | Yes (5.15.2) | Numbers joined by `:` (e.g. `1:3:7:20`) |
| | `+QNWPREFCFG="nsa_nr5g_band"` / `"nr5g_band"` | Yes (5.15.3/4) | `N1:N3:N78` style |
| | `"ue_capability_band"`, `"policy_band"`, `"nr5g_disable_mode"` | Yes | read-only info / SA-NSA toggle |
| | `+QNWLOCK`, `+QCFG="nrcapable"` | **Not in manual** | tolerate ERROR |
| APN | `+CGDCONT` | Yes (9.2) | |
| Cell scan | `+QSCAN` | **Not in manual** | Alternatives: `+COPS=?` (5.1, slow, can drop the connection, needs warning) and `+QENG="neighbourcell"` |
| SMS | `+CMGF`, `+CPMS`, `+CMGL`, `+CMGR`, `+CMGD`, `+CMGS`, `+CNMI` | Yes (ch. 8) | |
| Device info | `+CGMI`, `+CGMM`, `+CGMR`, `+CGSN`, `+CIMI` | Yes | |
| | `+QCCID` | **Not in manual** | hide ICCID if it errors |
| Ethernet / RGMII | `+QETH="rgmii"`, `"ipptmac"`, `"speed"`, `"an"`, `"dm"`, `"mac_address"`, `"routing"` | Yes (12.7) | |
| | `+QCFG="data_interface"`, `"pcie/mode"` | Yes (3.3.7/3.3.8) | |
| Reboot | `+CFUN=1,1` | Yes (2.22) | Manual says not recommended with PCIe, use hardware reset |
| Other | `+QMBNCFG`, `+QCFG="usbnet"`, `+QNETDEVCTL`, `+QGETCAPABILITY` | **Not in manual** | tolerate ERROR |

---

# Replace "Step 1b" in the Copilot prompt with this

````
# Step 1b: Fix AT commands for my Quectel RG501Q-EU (do this before translating or porting)
My modem is an RG501Q-EU. The UI was written for an RG520N-CN, so some AT commands return ERROR and some responses have a different format.
Sources of truth:
- `docs/reference/at-manual.txt` = RG50xQ/RM5xxQ AT Commands Manual V1.1.1 (a 2020 preliminary version; newer firmware may support more).
- `docs/reference/rg501q-at-compat.md` = my notes, a table of commands and formats checked against that manual.

Rules:
1. Remove or replace commands not in the manual:
   - `+QRSRP`, `+QRSRQ`, `+QSINR`: not documented. The per-antenna PRX/DRX/RX2/RX3 panel and the 4G/5G antenna switch depend on them. Show that panel only if these commands answer without ERROR; otherwise hide the panel and use RSRP/RSRQ/SINR from `+QENG="servingcell"` for the gauge and trend charts.
   - `+QMAP="WWANIP"` and `+CGCONTRDP=1`: replace with `+CGPADDR=1` (IP) and `+CGDCONT?` (APN). Keep the old ones only as optional extras that may fail silently.
   - `+QSCAN` (cell scan page): use `+QENG="neighbourcell"`, and `+COPS=?` only behind a warning ("scan can take minutes and drops the connection") and a confirmation.
   - `+QCCID`, `+QNWLOCK`, `+QMBNCFG`, `+QCFG="usbnet"`: not in the manual. Hide the field or feature if it errors.
2. Rewrite the parsers using the exact formats in `rg501q-at-compat.md`:
   - `+QENG="servingcell"`: detect the mode from the response (`"LTE"`, `"NR5G-SA"`, or `"servingcell",<state>` followed by `"LTE"` and `"NR5G-NSA"` lines = EN-DC).
   - In the `"NR5G-NSA"` line the order is RSRP, **SINR**, RSRQ (SINR before RSRQ).
   - LTE SINR is raw and must be converted with the manual's formula; NR SINR is already in dB.
   - Bandwidth fields are indexes, map them to MHz with the manual's tables.
   - `+QTEMP` returns several lines with quoted values (`+QTEMP:"sensor","27"`). Do not depend on one sensor name; show the highest numeric value.
   - `+QNWINFO` may return `No Service`; take the RAT from `+QENG` because the manual's `+QNWINFO` list has no NR5G.
   - `+QCAINFO` is LTE only; show NR carriers from `+QENG`.
3. Make polling tolerant:
   - Send commands in a batch if the endpoint supports it, but parse each command's response separately.
   - If one command returns `ERROR` or `+CME ERROR`, show "N/A" for those fields and keep the rest of the page working.
   - Remember which commands failed in this session and stop sending them on every refresh.
4. Keep the signal score algorithm as it is, but feed it the right fields. Mark any change in `signal.js` with a comment.
5. Add `diagnostics.html`:
   - It sends the read-only queries one at a time and shows: command | raw response | OK / ERROR / unparsed.
   - It has a "Copy report" button, so I can paste the results to Claude.
   - It must never send write or set commands.
6. Update `docs/PORTING_PLAN.md` with a table: command | in manual | supported on my modem (from diagnostics) | fix.
7. For the pages I port from upstream (network, bands, SMS, device info, ethernet), check every AT command against `at-manual.txt` first. If the command is not in the manual, say so in the plan and ask me before using it.
````

---

## What the UI does about it

| Area | Behaviour |
|---|---|
| All pages | One AT command per request, one request at a time, 8 s timeout (longer for scans, SMS list, RGMII). Final result line decides OK/ERROR. |
| Restart | `AT+CFUN=1,1` is sent without waiting for an answer, then a countdown and `ATI` polling until the modem is back. |
| Home | If the first poll shows an error or a cut-short answer, each query is tested once and rejected ones are dropped for the session. IP falls back to `+CGPADDR=1`. |
| SMS | Text mode + UCS2 set up automatically. `AT+CMGD=1,4` for delete-all. Number sent as typed; optional country code. |
| Settings | MPDN / DHCP DNS / usbnet controls are disabled when their query is rejected. Interface status card shows `AT+QCFG="data_interface"`, `"pcie/mode"`, `AT+QETH="rgmii"`, `"ipptmac"`. |
| Network | Fixed `AT++CGDCONT` bug; fixed `AT+QNWLOCK="common/5g",0`; `restore_band` falls back to enabling all supported bands. |
| Cell scan | `AT+QSCAN=3,1`, falling back to `AT+COPS=?` (operators only). |
| Device info | One query per field, parsed by prefix (ICCID: `+QCCID` then `+ICCID`; IP: `+CGPADDR`). |
| Diagnostics | Runs the read-only queries and produces a report with identifiers hidden. |


## How the device scripts behave (read from the upstream SDXLEMUR `cgi-bin`)

- `get_atcommand` sends the command to `/dev/ttyOUT2` with `microcom` and **repeats it in a loop until the
  answer contains "OK" or "ERROR"**. It never gives up and keeps running after the browser stopped waiting.
  So: never send two AT requests at once, and wait a few seconds after a timeout (`js/at.js` does both).
  Commands that prompt (`AT+CMGS`) cannot go through it.
- A chained line `AT+A;+B;+C` stops at the first rejected command, which is why the pages now send one
  command per request. The Home poll still chains, with the likely-rejected commands last, and tests the
  commands one by one when the answer shows an error or is cut short.
- `user_atcommand` is broken upstream (`atcmd '$x'` passes the text `$x`, not the command). The AT terminal
  therefore uses `get_atcommand`, like the original Settings page.
- `send_sms` prints no `Content-type` header, so the server may answer HTTP 500 although the SMS was sent.
  The SMS page reads the body of such answers instead of treating the status as a failure. It builds
  `AT+CMGS="<number>",<Command>`: single-part messages send `<toda>` (129/145, as in the manual), and fall back
  to the original `uid,part,total` form if the modem rejects that.
- The upstream `network.html` has two typos the fork did not copy: `"common/5g,0"` (quote in the wrong place)
  and the `AT++...` prefix that the original removed with `.replace("++", "+")`.


## IPv4 and IPv6 on the Home page

`+CGCONTRDP` is not in the RG50xQ manual and the original parser only accepts IPv6 written with colons.
The UI therefore also reads `+CGPADDR=1` and `+CGDCONT?`. 3GPP lets a modem print an IPv6 address as 16 dotted
decimal bytes (`32.1.13.184.0.0...`) and `+CGCONTRDP` adds the subnet mask (8 or 32 bytes): `AT.parseAddresses`
(`js/at.js`) converts all these forms. If IPv6 is still empty, the APN IP type is probably IPV4 only.

## Cell lock commands

| Action | Command |
|---|---|
| Lock LTE | `AT+QNWLOCK="common/4g",1,<EARFCN>,<PCI>` |
| Lock NR5G | `AT+QNWLOCK="common/5g",<PCI>,<ARFCN>,<SCS>,<BAND>` (the original SimpleAdmin sends ARFCN first; the other order is tried when the modem rejects the first) |
| Unlock | `AT+QNWLOCK="common/4g",0` / `AT+QNWLOCK="common/5g",0` |
| Apply now | `AT+COPS=2` then `AT+COPS=0` |

`AT+QNWLOCK` is not in the RG50xQ manual (V1.1.1), so support depends on the firmware.

## Login

See the README. Server side: `device/auth/auth.sh` (library), `www/cgi-bin/auth_*` (login, status, logout,
password change) and `install-auth.sh`, which adds a session check to every other CGI script.
