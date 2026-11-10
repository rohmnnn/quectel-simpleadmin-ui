(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function next() {
    var n = new URLSearchParams(location.search).get("next") || "/";
    // only a path on this device, never another site and never the login page itself
    return /^\/(?![\/\\])/.test(n) && !/^\/login\.html/.test(n) ? n : "/";
  }

  function setResult(message, kind) {
    var el = $("login-result");
    el.textContent = message;
    el.className = "result" + (kind ? " is-" + kind : "");
  }

  var setup = false;

  function showForm(isSetup) {
    setup = isSetup;
    $("login-title").textContent = isSetup ? "Create a password" : "Sign in";
    $("login-sub").textContent = isSetup ? "No password is set yet. Choose one (at least 8 characters) to protect this device." : "Enter the password for this device.";
    $("login-confirm-field").style.display = isSetup ? "" : "none";
    $("login-submit").textContent = isSetup ? "Save password" : "Sign in";
    $("password").setAttribute("autocomplete", isSetup ? "new-password" : "current-password");
    $("login-form").style.display = "";
    $("password").focus();
  }

  function check() {
    fetch("/cgi-bin/auth_status", { cache: "no-store", credentials: "same-origin" }).then(function (response) {
      if (response.ok) { location.replace(next()); return; }
      if (response.status === 401) {
        return response.json().then(function (data) { showForm(data && data.configured === false); }, function () { showForm(false); });
      }
      $("login-sub").textContent = "The login is not installed on this device. Open the web interface directly.";
      var link = document.createElement("a");
      link.href = "/";
      link.textContent = "Open the web interface";
      $("login-sub").appendChild(document.createElement("br"));
      $("login-sub").appendChild(link);
    }).catch(function () {
      $("login-sub").textContent = "The device did not answer. Check the connection and reload the page.";
    });
  }

  $("login-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var password = $("password").value;
    if (!password) { setResult("Enter the password.", "error"); return; }
    if (setup) {
      if (password.length < 8) { setResult("Use at least 8 characters.", "error"); return; }
      if (password !== $("password-confirm").value) { setResult("The two passwords are different.", "error"); return; }
    }
    $("login-submit").disabled = true;
    setResult("Please wait…");
    var body = new URLSearchParams({ password: password });
    if (setup) body.set("action", "setup");
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
    fetch("/cgi-bin/auth_login", { method: "POST", body: body, credentials: "same-origin", cache: "no-store", signal: controller ? controller.signal : undefined })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) { return { ok: response.ok && data.ok, data: data, status: response.status }; });
      }).then(function (r) {
        if (r.ok) { location.replace(next()); return; }
        setResult(r.data && r.data.error ? r.data.error : "Login failed (HTTP " + r.status + ").", "error");
        $("password").value = "";
        $("password-confirm").value = "";
      }).catch(function (error) {
        setResult(error && error.name === "AbortError" ? "The device did not answer in time." : "Could not reach the device.", "error");
      }).finally(function () {
        if (timer) clearTimeout(timer);
        $("login-submit").disabled = false;
      });
  });

  check();
})();
