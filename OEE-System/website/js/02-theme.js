// 02-theme.js - Light / dark theme switch for the page
(()=>{const r=document.documentElement,b=document.body,q=matchMedia("(prefers-color-scheme: dark)");
const pick=()=>{const t=r.getAttribute("data-theme");b.dataset.theme=t==="dark"||t==="light"?t:(q.matches?"dark":"light");};
b.classList.add("iso");pick();q.addEventListener("change",pick);new MutationObserver(pick).observe(r,{attributes:true,attributeFilter:["data-theme"]});})();
