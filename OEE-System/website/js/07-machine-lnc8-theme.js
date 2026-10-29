// 07-machine-lnc8-theme.js - Machine M1 Okuma LNC-8 - theme hook for its drawing
(function(document){
(()=>{const root=document.documentElement,main=document.querySelector("main.iso"),m=matchMedia("(prefers-color-scheme: dark)");const set=()=>{const t=root.dataset.theme||(m.matches?"dark":"light");main.dataset.theme=t};set();m.addEventListener("change",set);new MutationObserver(set).observe(root,{attributes:true,attributeFilter:["data-theme"]})})()
}).call(window, window.__mx.doc("lnc8"));
