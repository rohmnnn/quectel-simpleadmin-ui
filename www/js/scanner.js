(function () {
  var scannedCells = [];

  function atFields(line) {
    var payload = line.substring(line.indexOf(":") + 1);
    var values = [];
    var current = "";
    var quoted = false;
    for (var i = 0; i < payload.length; i++) {
      var ch = payload[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        values.push(current.trim());
        current = "";
      } else current += ch;
    }
    values.push(current.trim());
    return values;
  }

  function value(row, index) { return (row[index] || "").replace(/^"|"$/g, "").trim(); }

  function operator(mcc, mnc) {
    var code = (mcc + mnc).replace(/\D/g, "");
    var names = {
      "46000": "China Mobile", "46002": "China Mobile", "46004": "China Mobile", "46007": "China Mobile", "46008": "China Mobile",
      "46001": "China Unicom", "46006": "China Unicom", "46009": "China Unicom",
      "46003": "China Telecom", "46005": "China Telecom", "46011": "China Telecom", "46015": "China Broadnet"
    };
    return (names[code] ? names[code] + " · " : "") + (code || "Unknown");
  }

  function appendRow(tbody, cells, emptyMessage) {
    tbody.replaceChildren();
    if (!cells.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = tbody === document.getElementById("scan-rows") ? 6 : 4;
      td.textContent = emptyMessage;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }
    cells.forEach(function (values) {
      var tr = document.createElement("tr");
      values.forEach(function (value) {
        var td = document.createElement("td");
        td.textContent = value || "—";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function renderScan() {
    var filter = document.getElementById("scan-filter").value;
    var cells = scannedCells.filter(function (cell) { return filter === "all" || cell.rat === filter; })
      .map(function (cell) { return [cell.rat, cell.operator, cell.band, cell.earfcn, cell.pci, cell.rsrp]; });
    appendRow(document.getElementById("scan-rows"), cells, "No cells matched the selected filter.");
  }

  function parseScan(text) {
    scannedCells = text.split(/\r?\n/).filter(function (line) {
      return /^\s*\+QSCAN:/i.test(line) && /LTE|NR5G/i.test(line);
    }).map(function (line) {
      var fields = atFields(line);
      var rat = /NR5G/i.test(line) ? "NR5G" : "LTE";
      return {
        rat: rat,
        operator: operator(value(fields, 1), value(fields, 2)),
        earfcn: value(fields, 3),
        pci: value(fields, 4),
        rsrp: value(fields, 5),
        band: value(fields, 12) || "—"
      };
    });
    renderScan();
  }

  function parseNeighbors(text) {
    var cells = text.split(/\r?\n/).filter(function (line) {
      return /^\s*\+(QENG|QNWCFG):/i.test(line) && /LTE|NR5G/i.test(line);
    }).map(function (line) {
      var fields = atFields(line);
      var rat = /LTE/i.test(line) ? "LTE" : "NR5G";
      return [rat, value(fields, 2), value(fields, 3), value(fields, rat === "LTE" ? 5 : 4)];
    });
    appendRow(document.getElementById("neighbor-rows"), cells, "No neighboring cells were returned.");
  }

  function run(buttonId, outputId, resultId, atcmd, render, confirmation) {
    var button = document.getElementById(buttonId);
    var output = document.getElementById(outputId);
    var result = document.getElementById(resultId);
    button.addEventListener("click", function () {
      if (confirmation && !window.confirm(confirmation)) return;
      button.disabled = true;
      result.className = "result";
      result.textContent = "Waiting for the modem…";
      output.textContent = "";
      fetch("/cgi-bin/get_atcommand?" + new URLSearchParams({ atcmd: atcmd }), { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");
          return response.text();
        })
        .then(function (text) {
          output.textContent = text.trim() || "The modem returned an empty response.";
          if (/\b(ERROR|FAIL)\b|\+CME ERROR/i.test(text)) throw new Error(text.trim());
          render(text);
          result.textContent = "Modem query completed.";
          result.className = "result is-success";
        })
        .catch(function (error) {
          result.textContent = error.message || "The modem query failed.";
          result.className = "result is-error";
        })
        .finally(function () { button.disabled = false; });
    });
  }

  run("scan-run", "scan-output", "scan-result", "AT+QSCAN=3,1", parseScan);
  run("neighbor-read", "neighbor-output", "neighbor-result", 'AT+QENG="neighbourcell";+QNWCFG="nr5g_meas_info",1;+QNWCFG="nr5g_meas_info"', parseNeighbors,
    'Read neighboring cells and enable NR5G measurement reporting with +QNWCFG="nr5g_meas_info",1?');
  document.getElementById("scan-filter").addEventListener("change", renderScan);
})();
