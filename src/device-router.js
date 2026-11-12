(() => {
  const key = "cg-ops-layout-preference";
  const path = window.location.pathname;
  const isMobileEntry = /\/mobile\.html$/.test(path);
  const mobilePath = "/mobile.html";
  const desktopPath = "/";
  const isPhone = () => {
    const ua = navigator.userAgent || "";
    return /Android|iPhone|iPod|IEMobile|Opera Mini|Mobile/i.test(ua) ||
      (window.matchMedia && window.matchMedia("(max-width: 820px), (pointer: coarse) and (max-width: 1024px)").matches);
  };
  let preference = "auto";
  try { preference = localStorage.getItem(key) || "auto"; } catch (_) {}
  const targetMobile = preference === "mobile" || (preference === "auto" && isPhone());
  if (targetMobile !== isMobileEntry) {
    const destination = targetMobile ? mobilePath : desktopPath;
    window.location.replace(destination + window.location.search + window.location.hash);
    return;
  }
  const mountSwitch = () => {
    const host = document.querySelector(".th-right") || document.querySelector(".top-header");
    if (!host || document.getElementById("layoutSwitch")) return;
    const button = document.createElement("button");
    button.id = "layoutSwitch";
    button.type = "button";
    button.className = "btn";
    button.textContent = isMobileEntry ? "Desktop" : "Mobile";
    button.setAttribute("aria-label", isMobileEntry ? "Switch to desktop interface" : "Switch to mobile interface");
    button.title = "Switch interface";
    button.addEventListener("click", () => {
      const next = isMobileEntry ? "desktop" : "mobile";
      try { localStorage.setItem(key, next); } catch (_) {}
      window.location.href = (next === "mobile" ? mobilePath : desktopPath) + window.location.search;
    });
    host.appendChild(button);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountSwitch, {once:true});
  else mountSwitch();
})();