// Light / dark / auto theme switch.
// Loaded in <head> so the saved theme applies before the page draws.
(function () {
  "use strict";
  var KEY = "fleet-theme";
  var COLORS = { light: "#ffffff", dark: "#1a1f23" };

  function saved() {
    try { return localStorage.getItem(KEY) || "light"; } catch (e) { return "light"; }
  }
  function effective(choice) {
    if (choice !== "auto") return choice;
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function apply(choice) {
    var root = document.documentElement;
    if (choice === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", COLORS[effective(choice)]);
    var buttons = document.querySelectorAll("[data-theme-choice]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", String(buttons[i].getAttribute("data-theme-choice") === choice));
    }
  }

  apply(saved());

  document.addEventListener("DOMContentLoaded", function () { apply(saved()); });
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-theme-choice]");
    if (!b) return;
    var choice = b.getAttribute("data-theme-choice");
    try { localStorage.setItem(KEY, choice); } catch (e) {}
    apply(choice);
  });
  if (window.matchMedia) {
    var mq = matchMedia("(prefers-color-scheme: dark)");
    var onChange = function () { if (saved() === "auto") apply("auto"); };
    if (mq.addEventListener) mq.addEventListener("change", onChange); else if (mq.addListener) mq.addListener(onChange);
  }
})();
