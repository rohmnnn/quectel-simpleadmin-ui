(function () {
  "use strict";

  var scannedCells = [];
  var busy = false;

  function $(id) { return document.getElementById(id); }

  function value(row, index) { return (row[index] || "").trim(); }

  function setResult(id, message, kind) {
    var el = $(id);
    el.textContent = message;
    el.className = "result" + (kind ? " is-" + kind : "");
  }

  // One action at a time: every button of the page (including the Lock buttons in the tables) is disabled
  // while the modem works and ALWAYS enabled again afterwards.
  function setAll(disabled) {
    Array.prototype.forEach.call(document.querySelectorAll("#page button"), function (b) { b.disabled = disabled; });
  }

  function guard(resultId, task) {
    if (busy) return Promise.resolve();
    busy = true;
    setAll(true);
    return Promise.resolve().then(task).catch(function (error) {
      setResult(resultId, error && error.message ? error.message : "The modem query failed.", "error");
    }).finally(function () {
      busy = false;
      setAll(false);
    });
  }

  // Operator names come from js/operators.js (MCC+MNC table). Unknown codes are shown as the code.
  function operator(mcc, mnc) {
    var code = (mcc + mnc).replace(/\D/g, "");
    var names = window.OPERATOR_NAMES || {};
    return (names[code] ? names[code] + " · " : "") + (code || "Unknown");
  }

  /* ---------- tables with a Lock button per row ---------- */

  // rows: [{cells: [...], lock: {rat, earfcn, pci, band} | null}]
  function renderRows(tbody, rows, columns, emptyMessage) {
    tbody.replaceChildren();
    if (!rows.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = columns;
      td.textContent = emptyMessage;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      row.cells.forEach(function (v) {
        var cell = document.createElement("td");
        cell.textContent = v || "—";
        tr.appendChild(cell);
      });
      var action = document.createElement("td");
      if (row.lock) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.textContent = "Lock";
        button.setAttribute("aria-label", "Lock to " + row.lock.rat + " PCI " + row.lock.pci);
        button.addEventListener("click", function () { lockToCell(row.lock); });
        action.appendChild(button);
      } else {
        action.textContent = "—";
      }
      tr.appendChild(action);
      tbody.appendChild(tr);
    });
  }

  function isNum(v) { return /^\d+$/.test(String(v || "").trim()); }

  function makeLock(rat, earfcn, pci, band, plmn) {
    return isNum(earfcn) && isNum(pci) ? { rat: rat, earfcn: String(earfcn).trim(), pci: String(pci).trim(), band: String(band || "").replace(/\D/g, ""), plmn: plmn || "" } : null;
  }

  // operator of a cell as "mcc:mnc" (the MNC is compared as a number: "01" and "1" are the same operator)
  var servingPlmn = "";
  function plmnKey(mcc, mnc) {
    var m = String(mcc || "").replace(/\D/g, ""), n = String(mnc || "").replace(/\D/g, "");
    return m && n ? m + ":" + parseInt(n, 10) : "";
  }
  function plmnFromNumeric(numeric) {
    var d = String(numeric || "").replace(/\D/g, "");
    return d.length >= 5 ? plmnKey(d.slice(0, 3), d.slice(3)) : "";
  }

  /* ---------- cell lock ---------- */

  // NR-ARFCN ranges (3GPP 38.101-1 downlink) of the common bands. Some ranges overlap, so a derived band
  // can be ambiguous: then the user is asked.
  var NR_BANDS = [
    [1, 422000, 434000], [2, 386000, 398000], [3, 361000, 376000], [5, 173800, 178800], [7, 524000, 538000],
    [8, 185000, 192000], [12, 145800, 149200], [20, 158200, 164200], [25, 386000, 399000], [28, 151600, 160600],
    [38, 514000, 524000], [40, 460000, 480000], [41, 499200, 537999], [66, 422000, 440000], [71, 123400, 130400],
    [77, 620000, 680000], [78, 620000, 653333], [79, 693334, 733333]
  ];

  function nrBandCandidates(arfcn) {
    var n = Number(arfcn);
    return NR_BANDS.filter(function (b) { return n >= b[1] && n <= b[2]; }).map(function (b) { return b[0]; });
  }

  function resolveNrBand(target) {
    if (target.band) return target.band;
    var candidates = nrBandCandidates(target.earfcn);
    if (candidates.length === 1) return String(candidates[0]);
    var answer = window.prompt("Which NR band is ARFCN " + target.earfcn + " on?" + (candidates.length ? " Candidates: " + candidates.map(function (b) { return "n" + b; }).join(", ") : "") + "\n\nEnter the band number (for example 78).", candidates.length ? String(candidates[0]) : "");
    var band = String(answer || "").replace(/\D/g, "");
    return band || null;
  }

  // Downlink EARFCN ranges of the common LTE bands (3GPP 36.101).
  var LTE_BANDS = [
    [1, 0, 599], [2, 600, 1199], [3, 1200, 1949], [4, 1950, 2399], [5, 2400, 2649], [7, 2750, 3449], [8, 3450, 3799],
    [12, 5010, 5179], [13, 5180, 5279], [17, 5730, 5849], [20, 6150, 6449], [25, 8040, 8689], [26, 8690, 9039],
    [28, 9210, 9659], [38, 37750, 38249], [39, 38250, 38649], [40, 38650, 39649], [41, 39650, 41589],
    [42, 41590, 43589], [43, 43590, 45589], [66, 66436, 67335], [71, 68586, 68935]
  ];

  function lteBandFromEarfcn(earfcn) {
    var n = Number(earfcn);
    for (var i = 0; i < LTE_BANDS.length; i++) if (n >= LTE_BANDS[i][1] && n <= LTE_BANDS[i][2]) return LTE_BANDS[i][0];
    return 0;
  }

  function enabledBands(type) {
    return AT.soft('AT+QNWPREFCFG="' + type + '"').then(function (r) {
      if (!r.ok) return null;
      var m = new RegExp('"' + type + '",([0-9:]+)').exec(r.text);
      return m ? m[1].split(":").filter(Boolean) : null;
    });
  }

  // Why a lock would leave the modem "searching": another operator's cell, or a band the modem has switched off.
  function precheck(target, band) {
    var warnings = [];
    var plmnStep = servingPlmn ? Promise.resolve() : AT.soft("AT+QSPN").then(function (r) {
      if (r.ok) servingPlmn = plmnFromNumeric(AT.fields(AT.line(r.text, "+QSPN:"))[4]);
    });
    return plmnStep.then(function () {
      if (target.plmn && servingPlmn && target.plmn !== servingPlmn) {
        warnings.push("This cell belongs to another operator (" + target.plmn.replace(":", "-") + ", your SIM uses " + servingPlmn.replace(":", "-") + "). The modem cannot connect to it and would only search.");
      }
      if (target.rat === "LTE") {
        var lteBand = lteBandFromEarfcn(target.earfcn);
        if (!lteBand) return null;
        return enabledBands("lte_band").then(function (list) {
          if (list && list.indexOf(String(lteBand)) === -1) warnings.push("LTE band " + lteBand + " is switched off on this modem (Network page), so it cannot use this cell.");
        });
      }
      return enabledBands("nsa_nr5g_band").then(function (nsa) {
        return enabledBands("nr5g_band").then(function (sa) {
          var on = (nsa && nsa.indexOf(String(band)) !== -1) || (sa && sa.indexOf(String(band)) !== -1);
          if ((nsa || sa) && !on) warnings.push("5G band n" + band + " is switched off on this modem (Network page), so it cannot use this cell.");
        });
      });
    }).then(function () { return warnings; });
  }

  function lockToCell(target) {
    if (busy) return;
    var reattach = $("lock-reattach").checked;
    var verify = $("lock-verify").checked;
    var kind = target.rat === "LTE" ? "4g" : "5g";
    var command, label;
    var band = "", scs = "";
    if (target.rat === "LTE") {
      command = 'AT+QNWLOCK="common/4g",1,' + target.earfcn + "," + target.pci;
      label = "LTE  EARFCN " + target.earfcn + ", PCI " + target.pci;
    } else {
      band = resolveNrBand(target);
      if (!band) { setResult("lock-result", "A band is needed to lock a 5G cell.", "error"); return; }
      scs = $("lock-scs").value === "auto" ? String(AT.cellLock.defaultScs(band)) : $("lock-scs").value;
      command = 'AT+QNWLOCK="common/5g",' + target.pci + "," + target.earfcn + "," + scs + "," + band;
      label = "NR5G  ARFCN " + target.earfcn + ", PCI " + target.pci + ", band n" + band + ", SCS " + scs + " kHz";
    }

    guard("lock-result", function () {
      setResult("lock-result", "Checking the cell…");

      function applyLock() {
        setResult("lock-result", "Sending the lock command…");
        var lock = target.rat === "LTE" ? AT.cellLock.lockLte(target.earfcn, target.pci) : AT.cellLock.lockNr(target.pci, target.earfcn, scs, band);
        return lock.then(function () {
          if (!reattach) return "Locked. The lock is used when the modem next selects a cell.";
          setResult("lock-result", "Locked. Restarting the radio…");
          return AT.cellLock.reattach().then(function () {
            if (!verify) return "Locked. The radio was restarted.";
            return AT.cellLock.waitRegistered(30000, function (left) {
              setResult("lock-result", "Waiting for the modem to connect to the cell… (" + left + " s)");
            }).then(function (state) {
              if (state === true) return "Locked and connected.";
              if (state === null) return "Locked. The connection could not be checked.";
              setResult("lock-result", "The modem could not connect to this cell. Removing the lock…");
              return AT.cellLock.unlock(kind).then(function () { return AT.cellLock.reattach(); }).then(function () {
                return AT.cellLock.waitRegistered(25000);
              }).then(function (back) {
                return { undone: true, message: "The modem could not connect to this cell, so the lock was removed" + (back === false ? ", but it is still searching: press Unlock 4G and Unlock 5G, or restart the modem." : " and it is connected again.") };
              });
            });
          });
        }, function (error) {
          if (error.modemError) throw new Error(error.message + " (the modem rejected the lock command)");
          throw error;
        });
      }

      return precheck(target, band).then(function (warnings) {
        var text = "Lock the modem to this cell?\n\n" + label + "\n\n" + command +
          (warnings.length ? "\n\nWARNING:\n- " + warnings.join("\n- ") : "") +
          "\n\nThe modem will use only this cell." +
          (verify ? "\nIf it cannot connect within 30 s the lock is removed again." : "\nIf it cannot connect, press Unlock.");
        if (!window.confirm(text)) { setResult("lock-result", "Nothing was changed."); return; }
        return applyLock().then(function (outcome) {
          var undone = typeof outcome === "object";
          setResult("lock-result", undone ? outcome.message : outcome, undone ? "error" : "success");
          return readLockStatus();
        });
      });
    });
  }

  function unlock(kind) {
    if (busy) return;
    if (!window.confirm("Remove the " + kind.toUpperCase() + " cell lock?" + ($("lock-reattach").checked ? "\nThe radio is restarted afterwards (a few seconds without connection)." : ""))) return;
    guard("lock-result", function () {
      setResult("lock-result", "Unlocking…");
      return AT.cellLock.unlock(kind).then(function () {
        if (!$("lock-reattach").checked) return "Unlocked.";
        setResult("lock-result", "Unlocked. Restarting the radio…");
        return AT.cellLock.reattach().then(function () { return "Unlocked. The radio was restarted, the modem now searches for the best cell."; });
      }).then(function (message) {
        setResult("lock-result", message, "success");
        return readLockStatus();
      });
    });
  }

  function readLockStatus() {
    var out = [];
    return ['AT+QNWLOCK="common/4g"', 'AT+QNWLOCK="common/5g"'].reduce(function (chain, cmd) {
      return chain.then(function () {
        return AT.soft(cmd).then(function (r) {
          out.push("> " + cmd + "\n" + (r.ok ? (r.text.trim() || "(empty response)") : "Not available: " + r.error));
        });
      });
    }, Promise.resolve()).then(function () { $("lock-status").textContent = out.join("\n\n"); });
  }

  /* ---------- network scan ---------- */

  function renderScan() {
    var filter = $("scan-filter").value;
    var rows = scannedCells.filter(function (cell) { return filter === "all" || cell.rat === filter; }).map(function (cell) {
      return { cells: [cell.rat, cell.operator, cell.band, cell.earfcn, cell.pci, cell.rsrp], lock: cell.lock };
    });
    renderRows($("scan-rows"), rows, 7, "No cells matched the selected filter.");
  }

  // AT+QSCAN lines (module families that support it)
  function parseQscan(text) {
    scannedCells = AT.lines(text, "+QSCAN:").filter(function (line) { return /LTE|NR5G/i.test(line); }).map(function (line) {
      var fields = AT.fields(line);
      var rat = /NR5G/i.test(line) ? "NR5G" : "LTE";
      var band = value(fields, 12) || "";
      return {
        rat: rat,
        operator: operator(value(fields, 1), value(fields, 2)),
        earfcn: value(fields, 3),
        pci: value(fields, 4),
        rsrp: value(fields, 5),
        band: band || "—",
        lock: makeLock(rat, value(fields, 3), value(fields, 4), band, plmnKey(value(fields, 1), value(fields, 2)))
      };
    });
    renderScan();
  }

  // AT+COPS=? (documented for the RG50xQ): (stat,"long","short","numeric",AcT),...
  var ACT = { "0": "GSM", "2": "UTRAN", "3": "EGPRS", "4": "HSDPA", "5": "HSUPA", "6": "HSPA", "7": "LTE", "10": "LTE", "11": "NR5G", "12": "NR5G", "13": "LTE" };
  var STAT = { "0": "unknown", "1": "available", "2": "current", "3": "forbidden" };
  function parseCops(text) {
    var cells = [];
    var pattern = /\((\d),"([^"]*)","([^"]*)","(\d+)",(\d+)\)/g;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      cells.push({
        rat: ACT[match[5]] || "ACT " + match[5],
        operator: (match[2] || match[3] || "Unknown") + " (" + match[4] + ", " + (STAT[match[1]] || "?") + ")",
        earfcn: "", pci: "", rsrp: "", band: "—", lock: null
      });
    }
    scannedCells = cells;
    renderScan();
    return cells.length;
  }

  function runScan() {
    if (!window.confirm("Start a network scan?\n\nThe scan can take one to three minutes and may interrupt the data connection while it runs.")) return;
    guard("scan-result", function () {
      setResult("scan-result", "Scanning… this can take a few minutes.");
      $("scan-output").textContent = "";
      return AT.at("AT+QSCAN=3,1", { timeout: 200000 }).then(function (text) {
        $("scan-output").textContent = text.trim() || "The modem returned an empty response.";
        parseQscan(text);
        setResult("scan-result", "Scan completed.", "success");
      }, function (error) {
        if (!error.modemError) throw error;
        // AT+QSCAN is not in the RG50xQ manual: offer the documented operator search instead
        if (!window.confirm("AT+QSCAN is not supported by this modem (" + error.message + ").\n\nSearch for operators with AT+COPS=? instead? It lists operators only (no band, PCI or RSRP) and can take up to three minutes.")) {
          setResult("scan-result", "Scan cancelled.");
          return;
        }
        setResult("scan-result", "Searching for operators… this can take a few minutes.");
        return AT.at("AT+COPS=?", { timeout: 200000 }).then(function (text) {
          $("scan-output").textContent = text.trim() || "The modem returned an empty response.";
          var count = parseCops(text);
          setResult("scan-result", count + " operator(s) found (AT+COPS=?).", count ? "success" : "");
        });
      });
    });
  }

  /* ---------- serving + neighbouring cells ---------- */

  // +QENG="servingcell" (manual 5.11). The field positions differ per mode:
  //  LTE      "servingcell",state,"LTE",tdd,mcc,mnc,cellid,PCID,EARFCN,band,ulbw,dlbw,tac,RSRP,...
  //  NR SA    "servingcell",state,"NR5G-SA",duplex,mcc,mnc,cellid,PCID,tac,ARFCN,band,dlbw,RSRP,...
  //  EN-DC    "LTE",tdd,mcc,mnc,cellid,PCID,EARFCN,band,ulbw,dlbw,tac,RSRP,...   (no "servingcell" prefix)
  //           "NR5G-NSA",mcc,mnc,PCID,RSRP,SINR,RSRQ,ARFCN,band
  function parseServing(text) {
    var rows = [];
    function add(rat, band, earfcn, pci, rsrp, plmn) {
      if (plmn && !servingPlmn) servingPlmn = plmn;
      rows.push({ cells: [rat, band ? (rat === "NR5G" ? "n" : "B") + band : "", earfcn, pci, rsrp], lock: makeLock(rat, earfcn, pci, band, plmn) });
    }
    servingPlmn = "";
    AT.lines(text, "+QENG:").forEach(function (line) {
      if (/neighbourcell/i.test(line)) return;
      var f = AT.fields(line);
      if (f[0] === "servingcell") {
        if (/^LTE$/i.test(f[2])) add("LTE", value(f, 9), value(f, 8), value(f, 7), value(f, 13), plmnKey(f[4], f[5]));
        else if (/NR5G-SA/i.test(f[2])) add("NR5G", value(f, 10), value(f, 9), value(f, 7), value(f, 12), plmnKey(f[4], f[5]));
      } else if (/^LTE$/i.test(f[0])) {
        add("LTE", value(f, 7), value(f, 6), value(f, 5), value(f, 11), plmnKey(f[2], f[3]));
      } else if (/NR5G-NSA/i.test(f[0])) {
        add("NR5G", value(f, 8), value(f, 7), value(f, 3), value(f, 4), plmnKey(f[1], f[2]));
      }
    });
    renderRows($("serving-rows"), rows, 6, "No serving cell reported (the modem may not be registered).");
    return rows.length;
  }

  function parseNeighbors(text) {
    var rows = [];
    function add(rat, earfcn, pci, rsrp) {
      rows.push({ cells: [rat, earfcn, pci, rsrp], lock: makeLock(rat, earfcn, pci, "") });
    }
    AT.lines(text, "+QENG:").forEach(function (line) {
      if (!/neighbourcell/i.test(line) || !/LTE|NR5G/i.test(line)) return;
      var fields = AT.fields(line);
      var rat = /LTE/i.test(line) ? "LTE" : "NR5G";
      add(rat, value(fields, 2), value(fields, 3), value(fields, rat === "LTE" ? 5 : 4));
    });
    AT.lines(text, "+QNWCFG:").forEach(function (line) {
      if (!/LTE|NR5G/i.test(line)) return;
      var fields = AT.fields(line);
      var rat = /LTE/i.test(line) ? "LTE" : "NR5G";
      add(rat, value(fields, 2), value(fields, 3), value(fields, rat === "LTE" ? 5 : 4));
    });
    renderRows($("neighbor-rows"), rows, 5, "No neighboring cells were returned.");
  }

  // AT+QENDC (manual 5.13): +QENDC: <endc_avl>,<plmn_info_list_r15_avl>,<endc_rstr>,<5g_basic>
  function endcSummary(text) {
    var l = AT.line(text, "+QENDC:");
    if (!l) return "";
    var f = AT.fields(l);
    if (f[0] === "0") return "5G (EN-DC): this LTE cell does NOT offer 5G. A phone may be on another anchor cell or band.";
    if (f[1] === "0") return "5G (EN-DC): the registered operator does not signal 5G support here.";
    if (f[2] === "0") return "5G (EN-DC): the network restricts 5G for this connection.";
    if (f[0] === "1" && f[2] === "1") return "5G (EN-DC): this LTE cell offers 5G and it is not restricted.";
    return "";
  }

  function readCells() {
    var withNr = window.confirm('Also read the 5G neighbors with +QNWCFG="nr5g_meas_info",1?\n\nOK = serving cell, LTE and NR5G neighbors\nCancel = serving cell and LTE neighbors only');
    guard("neighbor-result", function () {
      setResult("neighbor-result", "Waiting for the modem…");
      var log = [];
      var all = "";
      var okCount = 0;
      function step(cmd, timeout) {
        return AT.soft(cmd, { timeout: timeout }).then(function (r) {
          log.push("> " + cmd + "\n" + (r.ok ? (r.text.trim() || "(empty response)") : "Not available: " + r.error));
          if (r.ok) { okCount++; all += "\n" + r.text; }
        });
      }
      var chain = step('AT+QENG="servingcell"', 10000).then(function () { return step("AT+QENDC", 8000); })
        .then(function () { return step('AT+QENG="neighbourcell"', 15000); });
      if (withNr) {
        chain = chain.then(function () { return step('AT+QNWCFG="nr5g_meas_info",1', 8000); })
          .then(function () { return step('AT+QNWCFG="nr5g_meas_info"', 8000); });
      }
      return chain.then(function () {
        $("neighbor-output").textContent = log.join("\n\n");
        var serving = parseServing(all);
        parseNeighbors(all);
        if (!okCount) setResult("neighbor-result", "The modem rejected every query. See the raw response below.", "error");
        else {
          var endc = endcSummary(all);
          setResult("neighbor-result", (serving ? "Cells read. Press Lock on a row to lock to that cell." : "Cells read, but no serving cell was reported.") + (endc ? " " + endc : ""), "success");
        }
      });
    });
  }

  $("scan-run").addEventListener("click", runScan);
  $("neighbor-read").addEventListener("click", readCells);
  $("scan-filter").addEventListener("change", renderScan);
  $("unlock-4g").addEventListener("click", function () { unlock("4g"); });
  $("unlock-5g").addEventListener("click", function () { unlock("5g"); });
  $("lock-status-read").addEventListener("click", function () { guard("lock-result", function () { setResult("lock-result", "Reading…"); return readLockStatus().then(function () { setResult("lock-result", "Lock status read.", "success"); }); }); });
})();
