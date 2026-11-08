(function () {
  var form = document.getElementById("watchcat-form");
  var submit = form.querySelector('[type="submit"]');
  var refreshButton = document.getElementById("watchcat-refresh");

  function setResult(message, kind) {
    var el = document.getElementById("watchcat-result");
    el.textContent = message;
    el.className = "result field-wide" + (kind ? " is-" + kind : "");
  }

  function loadStatus() {
    refreshButton.disabled = true;
    setResult("Reading Watchcat status…");
    AT.fetchText("/cgi-bin/get_watchcat_status", 10000).then(function (body) {
      try { return JSON.parse(body); } catch (e) { throw new Error("The device returned an invalid Watchcat status."); }
    }).then(function (data) {
      var config = data && data.watchcat && typeof data.watchcat === "object" ? data.watchcat : data;
      if (!config || typeof config !== "object") throw new Error("The device returned an invalid Watchcat status.");
      if (!Object.keys(config).length) {
        form.elements.enabled.value = "disable";
        form.elements.track_ip.value = "1.1.1.1";
        form.elements.ping_timeout.value = 30;
        form.elements.ping_failure_count.value = 3;
        document.getElementById("watchcat-logs").value = JSON.stringify(data, null, 2);
        setResult("No Watchcat configuration was found. Default values are shown; apply them only if intended.");
        return;
      }
      if (typeof config.enabled !== "boolean") throw new Error("The device returned an invalid Watchcat status.");
      form.elements.enabled.value = config.enabled ? "enable" : "disable";
      form.elements.track_ip.value = config.track_ip || "";
      form.elements.ping_timeout.value = config.ping_timeout || 30;
      form.elements.ping_failure_count.value = config.ping_failure_count || 3;
      document.getElementById("watchcat-logs").value = JSON.stringify(data, null, 2);
      setResult(config.enabled ? "Watchcat is enabled." : "Watchcat is disabled.", "success");
    }).catch(function (error) {
      setResult(error.message, "error");
      document.getElementById("watchcat-logs").value = error.message;
    }).finally(function () { refreshButton.disabled = false; });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var ip = form.elements.track_ip.value.trim();
    var timeout = form.elements.ping_timeout.value;
    var failures = form.elements.ping_failure_count.value;
    var ipParts = ip.split(".");
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || ipParts.some(function (part) { return Number(part) > 255; })) {
      setResult("Enter a valid IPv4 address to monitor.", "error");
      return;
    }
    if (!/^\d+$/.test(timeout) || Number(timeout) < 1 || !/^\d+$/.test(failures) || Number(failures) < 1) {
      setResult("Timeout and failure count must be positive whole numbers.", "error");
      return;
    }
    var enabled = form.elements.enabled.value;
    if (!window.confirm("Apply Watchcat settings?\n\nEnabled: " + enabled + "\nHost: " + ip + "\nTimeout: " + timeout + " seconds\nFailures: " + failures)) return;
    submit.disabled = true;
    refreshButton.disabled = true;
    setResult("Applying Watchcat settings…");
    var params = new URLSearchParams({
      WATCHCAT_ENABLED: enabled,
      TRACK_IP: ip,
      PING_TIMEOUT: timeout,
      PING_FAILURE_COUNT: failures
    });
    AT.fetchText("/cgi-bin/watchcat_maker?" + params, 20000).then(function (text) {
      if (/invalid|must be|error/i.test(text)) throw new Error(text.trim());
      document.getElementById("watchcat-logs").value = text.trim();
      setResult(text.trim() || "Watchcat settings applied.", "success");
      return loadStatus();
    }).catch(function (error) {
      setResult(error.message, "error");
    }).finally(function () {
      submit.disabled = false;
      refreshButton.disabled = false;
    });
  });

  refreshButton.addEventListener("click", loadStatus);
  loadStatus();
})();
