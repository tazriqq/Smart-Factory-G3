// 11-machine-gfir2-theme.js - Machine M3 GFIR CK0620/II - theme hook for its drawing
(function(document){
(function(){var b=document.body;b.classList.add("iso");function t(){var r=document.documentElement.getAttribute("data-theme");var d=r?r==="dark":matchMedia("(prefers-color-scheme: dark)").matches;b.setAttribute("data-theme",d?"dark":"light");}t();matchMedia("(prefers-color-scheme: dark)").addEventListener("change",t);new MutationObserver(t).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});})();
}).call(window, window.__mx.doc("gfir2"));
