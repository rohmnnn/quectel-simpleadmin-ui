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

  function guard(buttonIds, resultId, task) {
    if (busy) return Promise.resolve();
    busy = true;
    var buttons = buttonIds.map($);
    buttons.forEach(function (b) { b.disabled = true; });
    return Promise.resolve().then(task).catch(function (error) {
      setResult(resultId, error && error.message ? error.message : "The modem query failed.", "error");
    }).finally(function () {
      busy = false;
      buttons.forEach(function (b) { b.disabled = false; });
    });
  }

  // Operator names come from js/operators.js (MCC+MNC table). Unknown codes are shown as the code.
  function operator(mcc, mnc) {
    var code = (mcc + mnc).replace(/\D/g, "");
    var names = window.OPERATOR_NAMES || {};
    return (names[code] ? names[code] + " · " : "") + (code || "Unknown");
  }

  function appendRow(tbody, cells, emptyMessage) {
    tbody.replaceChildren();
    if (!cells.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = tbody === $("scan-rows") ? 6 : 4;
      td.textContent = emptyMessage;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }
    cells.forEach(function (values) {
      var tr = document.createElement("tr");
      values.forEach(function (v) {
        var cell = document.createElement("td");
        cell.textContent = v || "—";
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
  }

  function renderScan() {
    var filter = $("scan-filter").value;
    var cells = scannedCells.filter(function (cell) { return filter === "all" || cell.rat === filter; })
      .map(function (cell) { return [cell.rat, cell.operator, cell.band, cell.earfcn, cell.pci, cell.rsrp]; });
    appendRow($("scan-rows"), cells, "No cells matched the selected filter.");
  }

  // AT+QSCAN lines (module families that support it)
  function parseQscan(text) {
    scannedCells = AT.lines(text, "+QSCAN:").filter(function (line) { return /LTE|NR5G/i.test(line); }).map(function (line) {
      var fields = AT.fields(line);
      return {
        rat: /NR5G/i.test(line) ? "NR5G" : "LTE",
        operator: operator(value(fields, 1), value(fields, 2)),
        earfcn: value(fields, 3),
        pci: value(fields, 4),
        rsrp: value(fields, 5),
        band: value(fields, 12) || "—"
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
        earfcn: "", pci: "", rsrp: "", band: "—"
      });
    }
    scannedCells = cells;
    renderScan();
    return cells.length;
  }

  function runScan() {
    if (!window.confirm("Start a network scan?\n\nThe scan can take one to three minutes and may interrupt the data connection while it runs.")) return;
    guard(["scan-run"], "scan-result", function () {
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

  /* ---------- neighbour cells ---------- */

  function parseNeighbors(text) {
    var cells = [];
    AT.lines(text, "+QENG:").forEach(function (line) {
      if (!/neighbourcell/i.test(line) || !/LTE|NR5G/i.test(line)) return;
      var fields = AT.fields(line);
      var rat = /LTE/i.test(line) ? "LTE" : "NR5G";
      cells.push([rat, value(fields, 2), value(fields, 3), value(fields, rat === "LTE" ? 5 : 4)]);
    });
    AT.lines(text, "+QNWCFG:").forEach(function (line) {
      if (!/LTE|NR5G/i.test(line)) return;
      var fields = AT.fields(line);
      var rat = /LTE/i.test(line) ? "LTE" : "NR5G";
      cells.push([rat, value(fields, 2), value(fields, 3), value(fields, rat === "LTE" ? 5 : 4)]);
    });
    appendRow($("neighbor-rows"), cells, "No neighboring cells were returned.");
  }

  function readNeighbors() {
    var withNr = window.confirm('Also enable NR5G measurement reporting with +QNWCFG="nr5g_meas_info",1?\n\nOK = read LTE and NR5G cells\nCancel = read only the LTE neighboring cells');
    guard(["neighbor-read"], "neighbor-result", function () {
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
      var chain = step('AT+QENG="neighbourcell"', 15000);
      if (withNr) {
        chain = chain.then(function () { return step('AT+QNWCFG="nr5g_meas_info",1', 8000); })
          .then(function () { return step('AT+QNWCFG="nr5g_meas_info"', 8000); });
      }
      return chain.then(function () {
        $("neighbor-output").textContent = log.join("\n\n");
        parseNeighbors(all);
        if (!okCount) setResult("neighbor-result", "The modem rejected every query. See the raw response below.", "error");
        else setResult("neighbor-result", "Modem query completed.", "success");
      });
    });
  }

  $("scan-run").addEventListener("click", runScan);
  $("neighbor-read").addEventListener("click", readNeighbors);
  $("scan-filter").addEventListener("change", renderScan);
})();
