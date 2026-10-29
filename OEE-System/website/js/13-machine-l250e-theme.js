// 13-machine-l250e-theme.js - Machine M4 Okuma GENOS L250E - theme hook for its drawing
(function(document){

(() => {
  const el = document.getElementById("gl-root");
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const t = document.documentElement.getAttribute("data-theme");
    el.setAttribute("data-theme", t === "dark" || (t !== "light" && mq.matches) ? "dark" : "light");
  };
  apply();
  mq.addEventListener?.("change", apply);
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();

}).call(window, window.__mx.doc("l250e"));
