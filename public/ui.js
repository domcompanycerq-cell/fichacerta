// Utilidades compartilhadas pelo app e pelo painel admin.
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const brl = (n) => (isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmt = (n, d = 2) => (isFinite(n) ? n : 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: d });
  const pct = (n) => (isFinite(n) ? fmt(n * 100, 1) + "%" : "—");
  const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
  const dataHoraBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function telBR(t) {
    const d = String(t || "").replace(/\D/g, "");
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d;
  }
  function relativo(iso) {
    if (!iso) return "nunca";
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return "agora";
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    const d = Math.floor(s / 86400);
    return d === 1 ? "ontem" : `há ${d} dias`;
  }

  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    let data = {};
    try { data = await r.json(); } catch (e) { /* sem corpo */ }
    if (!r.ok) {
      const err = new Error(data.erro || "Não foi possível concluir. Verifique a conexão e tente de novo.");
      err.status = r.status; err.code = data.code;
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(html, ms = 4000) {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.innerHTML = `<div class="toast" role="status">${html}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.innerHTML = ""; }, ms);
  }

  // Botão de duas etapas para ações destrutivas (alert/confirm não são usados).
  function armar(btn, rotulo, fn) {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("armed")) { btn.classList.remove("armed"); fn(); return; }
      const old = btn.innerHTML;
      btn.classList.add("armed"); btn.textContent = rotulo;
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove("armed"); btn.innerHTML = old; } }, 3500);
    });
  }

  function overlay(html, { center = false, onClose } = {}) {
    const root = document.createElement("div");
    root.className = "overlay" + (center ? " center" : "");
    root.innerHTML = html;
    document.body.appendChild(root);
    const close = () => { root.remove(); document.removeEventListener("keydown", onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
    document.addEventListener("keydown", onKey);
    const f = root.querySelector("[autofocus], input, select, textarea");
    if (f) setTimeout(() => f.focus(), 30);
    return { root, close };
  }

  // Ícones em traço fino, no espírito dos ícones do Notion.
  const P = {
    box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    doc: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    check: '<path d="M5 12.5 10 17l9-10"/>',
    minus: '<path d="M6 12h12"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8L3 12Z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v1.5M12 16v1.5"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    chart: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/>',
    chef: '<path d="M7 14a4 4 0 1 1 1.5-7.7A4 4 0 0 1 16 6a4 4 0 1 1 1 8v6H7v-6Z"/><path d="M7 17h10"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ""}</svg>`;

  window.UI = { $, $$, esc, brl, fmt, pct, dataBR, dataHoraBR, norm, telBR, relativo, api, toast, armar, overlay, icon };
})();
