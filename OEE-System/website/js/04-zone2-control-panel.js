// 04-zone2-control-panel.js - ZONE 2 - what is left of the left panel: the knob API and the QC press hook
// The panel itself (knob and line-board drawings) is gone: its controls live on the control page (control.html).
// Kept for the scripts that use it:
//   window.pots[i].value() / hold(t) / release()  each machine's speed knob, t 0..1 (0..200 %); hold() sets it from
//                                                 the board or the control page, and reports it to window.onPotTurn
//   window.__qcLocal, window.__qcPress(what)      QC good / reject presses without a product (older control pages):
//                                                 counted here and marked on the OEE panel
(function () {
"use strict";
window.pots = [0, 1, 2, 3].map((index) => {
  let t = 0.5;
  return {
    value: () => t,
    hold(value) { t = Math.min(1, Math.max(0, value)); window.onPotTurn?.(index, t); },
    release() {},
  };
});
window.pot = window.pots[0];

window.__qcLocal = { good: 0, reject: 0 };
window.__qcPress = (what) => {
  if (what !== "good" && what !== "reject") return;
  if (window.__board?.live) return;   // the board's own button counts
  window.__qcLocal[what]++;
  document.querySelector('.dash-oee button[data-part="' + (what === "good" ? "good" : "bad") + '"]')?.click();
};
})();
