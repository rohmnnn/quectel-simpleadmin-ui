(function () {
  "use strict";

  // Read-only queries only. Nothing here changes a setting.
  var GROUPS = [
    { name: "Home page", cmds: ["AT+QSIMSTAT?", "AT+CSQ", "AT+QTEMP", "AT+QUIMSLOT?", "AT+QSPN", "AT+CGCONTRDP=1", "AT+CGPADDR=1", "AT+CGDCONT?",
      'AT+QENG="servingcell"', "AT+QNWINFO", "AT+QRSRP", "AT+QRSRQ", "AT+QSINR", "AT+QCAINFO", "AT+QGDNRCNT?", "AT+QGDCNT?"] },
    { name: "Network", cmds: ['AT+QNWPREFCFG="ue_capability_band"', 'AT+QNWPREFCFG="policy_band"', 'AT+QNWPREFCFG="lte_band"', 'AT+QNWPREFCFG="nsa_nr5g_band"',
      'AT+QNWPREFCFG="nr5g_band"', 'AT+QNWPREFCFG="mode_pref"', 'AT+QNWPREFCFG="nr5g_disable_mode"', 'AT+QNWLOCK="common/4g"', 'AT+QNWLOCK="common/5g"'] },
    { name: "Settings", cmds: ['AT+QMAP="MPDN_RULE"', 'AT+QMAP="DHCPV4DNS"', 'AT+QCFG="usbnet"', 'AT+QCFG="data_interface"', 'AT+QCFG="pcie/mode"', 'AT+QETH="ipptmac"', 'AT+QETH="rgmii"'] },
    { name: "Device info", cmds: ["AT+CGMI", "AT+CGMM", "AT+QGMR", "AT+CGMR", "AT+CIMI", "AT+QCCID", "AT+ICCID", "AT+CGSN", 'AT+QMAP="LANIP"', 'AT+QMAP="WWAN"', "AT+CNUM"] },
    { name: "SMS", cmds: ["AT+CMGF?", "AT+CSCS?", "AT+CSCS=?", "AT+CPMS?", "AT+CPMS=?", "AT+CSCA?", "AT+CNMI?", "AT+CMGD=?"] },
    { name: "Cell scan", cmds: ['AT+QENG="neighbourcell"', "AT+QSCAN=?", "AT+COPS?"] }
  ];
  var SLOW = { 'AT+QETH="rgmii"': 25000 };
  var MANUAL = { // commands the RG50xQ manual V1.1.1 does NOT list
    "AT+CGCONTRDP=1": 1, "AT+QRSRP": 1, "AT+QRSRQ": 1, "AT+QSINR": 1, "AT+QGDNRCNT?": 1, "AT+QGDCNT?": 1,
    'AT+QNWLOCK="common/4g"': 1, 'AT+QNWLOCK="common/5g"': 1, 'AT+QMAP="MPDN_RULE"': 1, 'AT+QMAP="DHCPV4DNS"': 1, 'AT+QCFG="usbnet"': 1,
    "AT+QGMR": 1, "AT+QCCID": 1, "AT+ICCID": 1, 'AT+QMAP="LANIP"': 1, 'AT+QMAP="WWAN"': 1, "AT+QSCAN=?": 1
  };

  var results = [];
  var running = false;
  var stopRequested = false;

  function $(id) { return document.getElementById(id); }

  function redact(text) {
    return String(text)
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "x.x.x.x")
      .replace(/[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){3,7}/gi, "<ipv6>")
      .replace(/\+?\d{10,}/g, "<digits>");
  }

  function shown(text) { return $("diag-redact").checked ? redact(text) : text; }

  function buildReport() {
    var lines = ["SimpleAdmin diagnostics (read-only queries)", "Date: " + new Date().toISOString(), "Identifiers hidden: " + ($("diag-redact").checked ? "yes" : "no"), ""];
    results.forEach(function (r) {
      lines.push("[" + r.status + "] " + r.cmd + (MANUAL[r.cmd] ? "   (not in RG50xQ manual V1.1.1)" : ""));
      var body = r.status === "OK" ? r.text.trim() : r.error;
      if (body) lines.push(shown(body).split(/\r?\n/).map(function (l) { return "    " + l; }).join("\n"));
    });
    return lines.join("\n");
  }

  function render() {
    var tbody = $("diag-rows");
    tbody.replaceChildren();
    results.forEach(function (r) {
      var tr = document.createElement("tr");
      var cmd = document.createElement("td");
      cmd.textContent = r.cmd;
      var status = document.createElement("td");
      status.textContent = r.status + (MANUAL[r.cmd] ? " · not in manual" : "");
      var body = document.createElement("td");
      var text = r.status === "OK" ? r.text.trim() : r.error;
      body.textContent = shown(text || "").replace(/\s+/g, " ").slice(0, 160);
      tr.appendChild(cmd); tr.appendChild(status); tr.appendChild(body);
      tbody.appendChild(tr);
    });
    $("diag-report").value = buildReport();
  }

  function run() {
    if (running) return;
    running = true;
    stopRequested = false;
    results = [];
    $("diag-run").disabled = true;
    $("diag-stop").disabled = false;
    var includeSlow = $("diag-slow").checked;
    var all = [];
    GROUPS.forEach(function (g) { g.cmds.forEach(function (c) { if (SLOW[c] && !includeSlow) return; all.push(c); }); });
    var chain = Promise.resolve();
    all.forEach(function (cmd, index) {
      chain = chain.then(function () {
        if (stopRequested) return;
        $("diag-result").textContent = "Running " + (index + 1) + " of " + all.length + ": " + cmd;
        $("diag-result").className = "result";
        return AT.soft(cmd, { timeout: SLOW[cmd] || 8000 }).then(function (r) {
          results.push({ cmd: cmd, status: r.ok ? "OK" : (r.timedOut ? "TIMEOUT" : "ERROR"), text: r.text, error: r.error });
          render();
        });
      });
    });
    chain.finally(function () {
      running = false;
      $("diag-run").disabled = false;
      $("diag-stop").disabled = true;
      var ok = results.filter(function (r) { return r.status === "OK"; }).length;
      $("diag-result").textContent = (stopRequested ? "Stopped. " : "Finished. ") + ok + " of " + results.length + " commands answered OK. Press \"Copy report\" and send it.";
      $("diag-result").className = "result is-success";
    });
  }

  function copyReport() {
    var area = $("diag-report");
    area.value = buildReport();
    area.select();
    var done = function () { $("diag-result").textContent = "Report copied."; $("diag-result").className = "result is-success"; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(area.value).then(done, function () { document.execCommand("copy"); done(); });
    else { try { document.execCommand("copy"); done(); } catch (e) { /* the text is selected: copy it manually */ } }
  }

  $("diag-run").addEventListener("click", run);
  $("diag-stop").addEventListener("click", function () { stopRequested = true; });
  $("diag-copy").addEventListener("click", copyReport);
  $("diag-redact").addEventListener("change", render);
})();
