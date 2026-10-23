(function () {
  "use strict";
  const { $, $$, esc, brl, fmt, pct, dataBR, dataHoraBR, norm, telBR, api, toast, armar, overlay, icon } = window.UI;
  const C = window.Calc;
  const app = $("#app");

  const S = { me: null, cfg: {}, insumos: [], receitas: [], insMap: {}, q: "", qRec: "", dirty: false };
  const isPro = () => S.me && S.me.plano === "pro";
  const p2 = (n) => (isFinite(n) ? n : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const setInsumos = (list) => { S.insumos = [...list].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")); S.insMap = {}; S.insumos.forEach((i) => { S.insMap[i.id] = i; }); };
  const usadoEm = (id) => S.receitas.filter((r) => r.itens.some((l) => l.insumoId === id));

  /* ================= inicialização ================= */
  // Link do WhatsApp do suporte com a mensagem pronta. É por ele que o usuário assina e renova o Pro.
  function linkSuporte(motivo) {
    const num = S.cfg.suporteWhatsApp || "5515988305442";
    const nome = S.cfg.appName || "Ficha Certa";
    const textos = {
      assinar: `Olá! Quero assinar o plano Pro do ${nome} (R$ ${fmt(S.cfg.preco || 25, 2)}/mês).`,
      renovar: `Olá! Quero renovar meu plano Pro do ${nome}.`,
      ajuda: `Olá! Preciso de ajuda com o ${nome}.`,
    };
    let msg = textos[motivo] || textos.ajuda;
    if (S.me) msg += ` Meu e-mail de cadastro: ${S.me.email}`;
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  }
  const telSuporte = () => { const d = String(S.cfg.suporteWhatsApp || "5515988305442"); return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}`; };
  const motivoPro = () => (S.me && (S.me.plano === "pro" || S.me.vencido) ? "renovar" : "assinar");

  async function boot() {
    try { Object.assign(S.cfg, await api("GET", "/api/config")); } catch (e) { /* usa o padrão */ }
    const h = location.hash;
    if (h.startsWith("#redefinir=")) return renderAuth("redefinir", h.slice(11));
    try {
      const r = await api("GET", "/api/me");
      S.me = r.user; Object.assign(S.cfg, r);
      document.title = r.appName || "Ficha Certa";
      await carregarDados();
      renderShell();
    } catch (e) {
      if (e.code === "bloqueado") return renderAuth("login", null, e.message);
      renderAuth("login");
    }
  }
  async function carregarDados() {
    const [a, b] = await Promise.all([api("GET", "/api/insumos"), api("GET", "/api/receitas")]);
    setInsumos(a.insumos); S.receitas = b.receitas;
  }
  async function atualizarMe() {
    const r = await api("GET", "/api/me");
    S.me = r.user; Object.assign(S.cfg, r);
    renderSidebar();
  }
  // Sessão expirada ou conta bloqueada durante o uso.
  function tratarErro(e, alvoErro) {
    if (e.status === 401) { renderAuth("login", null, "Sua sessão terminou. Entre de novo."); return; }
    if (e.code === "bloqueado") { renderAuth("login", null, e.message); return; }
    if (e.code === "limite") { upsell(e.message); return; }
    if (alvoErro) alvoErro.textContent = e.message; else toast(esc(e.message));
  }

  /* ================= autenticação ================= */
  function renderAuth(modo, token, aviso) {
    const nome = S.cfg.appName || "Ficha Certa";
    const marca = `<div class="brand"><span class="logo">${icon("chef")}</span>${esc(nome)}</div>`;
    const forms = {
      login: `
        <h1>Entrar</h1><p class="sub">Acesse seus insumos e fichas técnicas.</p>
        <form id="f" class="auth-box" style="gap:10px" novalidate>
          <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" autocomplete="email" required autofocus></div>
          <div class="field"><label for="senha">Senha</label><input class="input" id="senha" type="password" autocomplete="current-password" required></div>
          <div class="err" id="err">${esc(aviso || "")}</div>
          <button class="btn primary block" type="submit">Entrar</button>
          <div class="switch"><button type="button" data-go="esqueci">Esqueci minha senha</button></div>
          <div class="switch">Ainda não tem conta? <button type="button" data-go="cadastro">Criar conta grátis</button></div>
          <div class="switch"><a href="${linkSuporte("ajuda")}" target="_blank" rel="noopener">Falar com o suporte no WhatsApp</a></div>
        </form>`,
      cadastro: `
        <h1>Criar conta</h1><p class="sub">Grátis para começar. Sem cartão.</p>
        <form id="f" class="auth-box" style="gap:10px" novalidate>
          <div class="field"><label for="nome">Nome</label><input class="input" id="nome" autocomplete="name" required autofocus></div>
          <div class="field"><label for="tel">DDD + telefone</label><input class="input" id="tel" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(15) 99999-9999" required></div>
          <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="senha">Senha</label><input class="input" id="senha" type="password" autocomplete="new-password" minlength="8" placeholder="Mínimo de 8 caracteres" required></div>
          <div class="err" id="err"></div>
          <button class="btn primary block" type="submit">Criar conta</button>
          <div class="switch">Já tem conta? <button type="button" data-go="login">Entrar</button></div>
        </form>`,
      esqueci: `
        <h1>Recuperar senha</h1><p class="sub">Enviaremos um link para o seu e-mail.</p>
        <form id="f" class="auth-box" style="gap:10px" novalidate>
          <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" required autofocus></div>
          <div class="err" id="err"></div>
          <button class="btn primary block" type="submit">Enviar link</button>
          <div class="switch"><button type="button" data-go="login">Voltar para o login</button></div>
        </form>`,
      redefinir: `
        <h1>Nova senha</h1><p class="sub">Escolha uma senha com pelo menos 8 caracteres.</p>
        <form id="f" class="auth-box" style="gap:10px" novalidate>
          <div class="field"><label for="senha">Nova senha</label><input class="input" id="senha" type="password" autocomplete="new-password" required autofocus></div>
          <div class="err" id="err"></div>
          <button class="btn primary block" type="submit">Salvar nova senha</button>
        </form>`,
    };
    const planos = modo === "cadastro" ? `
      <div class="auth-plans">
        <div class="plan"><b>Free</b><ul>
          <li>${icon("check")}Até 10 insumos</li><li>${icon("check")}Até 2 fichas técnicas</li><li>${icon("check")}Recálculo automático</li>
          <li class="no">${icon("minus")}Histórico de preços</li></ul></div>
        <div class="plan"><b>Pro · R$ ${fmt(25)}/mês</b><ul>
          <li>${icon("check")}Insumos ilimitados</li><li>${icon("check")}Fichas técnicas ilimitadas</li><li>${icon("check")}Recálculo automático</li>
          <li>${icon("check")}Histórico de preços</li></ul></div>
      </div>` : "";
    app.innerHTML = `<div class="auth">${marca}<div class="auth-box">${forms[modo]}</div>${planos}</div>`;
    $$("[data-go]").forEach((b) => b.addEventListener("click", () => renderAuth(b.dataset.go)));
    const tel = $("#tel");
    if (tel) tel.addEventListener("input", () => { tel.value = mascaraTel(tel.value); });
    $("#f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#err"), btn = e.submitter || $("#f button[type=submit]");
      err.textContent = ""; btn.disabled = true;
      try {
        if (modo === "login") await api("POST", "/api/auth/login", { email: $("#email").value, senha: $("#senha").value });
        if (modo === "cadastro") await api("POST", "/api/auth/cadastro", { nome: $("#nome").value, telefone: $("#tel").value, email: $("#email").value, senha: $("#senha").value });
        if (modo === "esqueci") { const r = await api("POST", "/api/auth/esqueci", { email: $("#email").value }); err.style.color = "var(--text-2)"; err.textContent = r.mensagem; btn.disabled = false; return; }
        if (modo === "redefinir") { await api("POST", "/api/auth/redefinir", { token, senha: $("#senha").value }); history.replaceState(null, "", "/"); renderAuth("login", null, "Senha alterada. Entre com a nova senha."); return; }
        location.hash = modo === "cadastro" ? "#insumos" : location.hash;
        boot();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    });
  }
  function mascaraTel(v) {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : "";
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  /* ================= estrutura ================= */
  function renderShell() {
    app.innerHTML = `
      <div class="shell">
        <aside class="sidebar" id="side"></aside>
        <div id="sideScrim" class="scrim-side" hidden></div>
        <main class="main" id="main">
          <div class="topbar"><button class="icon-btn menu-btn" id="menuBtn" aria-label="Abrir menu">${icon("menu")}</button><span class="crumb" id="crumb"></span><span class="spacer"></span><span id="topActions" class="row"></span></div>
          <div id="view"></div>
        </main>
      </div>`;
    $("#menuBtn").onclick = () => toggleSide(true);
    $("#sideScrim").onclick = () => toggleSide(false);
    renderSidebar();
    if (!location.hash || location.hash === "#") location.hash = "#insumos"; else route();
  }
  function toggleSide(open) { $("#side").classList.toggle("open", open); $("#sideScrim").hidden = !open; }

  function renderSidebar() {
    const side = $("#side"); if (!side) return;
    const me = S.me, h = location.hash.split("/")[0] || "#insumos";
    const cur = (k) => (h === k || (k === "#fichas" && h === "#ficha") ? 'aria-current="page"' : "");
    const lim = me.limites;
    const meter = (rot, usado, max) => {
      if (max == null) return "";
      const p = Math.min(100, (usado / max) * 100);
      return `<div class="meter"><span>${rot}: ${usado} de ${max}</span><div class="bar"><i class="${usado >= max ? "full" : ""}" style="width:${p}%"></i></div></div>`;
    };
    side.innerHTML = `
      <div class="ws"><span class="avatar">${esc((me.nome || "?")[0].toUpperCase())}</span><span class="who">${esc(me.nome)}</span>
        <span class="tag ${isPro() ? "blue" : ""}" style="margin-left:auto">${isPro() ? "Pro" : "Free"}</span></div>
      <div class="nav-label">Cozinha</div>
      <button class="nav-item" data-href="#insumos" ${cur("#insumos")}>${icon("box")}Insumos<span class="count">${me.uso.insumos}</span></button>
      <button class="nav-item" data-href="#fichas" ${cur("#fichas")}>${icon("book")}Fichas técnicas<span class="count">${me.uso.receitas}</span></button>
      <button class="nav-item" data-href="#historico" ${cur("#historico")}>${icon("history")}Histórico de preços${isPro() ? "" : `<span class="count">${icon("lock").replace("<svg", '<svg style="width:14px;height:14px"')}</span>`}</button>
      <div class="nav-label">Conta</div>
      <button class="nav-item" data-href="#notificacoes" ${cur("#notificacoes")}>${icon("bell")}Notificações${me.naoLidas ? `<span class="badge">${me.naoLidas}</span>` : ""}</button>
      <button class="nav-item" data-href="#plano" ${cur("#plano")}>${icon("card")}Plano e assinatura</button>
      <button class="nav-item" data-href="#conta" ${cur("#conta")}>${icon("user")}Meus dados</button>
      ${me.role === "admin" ? `<a class="nav-item" href="/admin" style="text-decoration:none">${icon("shield")}Painel admin</a>` : ""}
      <div class="side-foot">
        ${meter("Insumos", me.uso.insumos, lim.insumos)}
        ${meter("Fichas", me.uso.receitas, lim.receitas)}
        ${!isPro() ? `<button class="btn primary" data-href="#plano">Assinar Pro · R$ ${fmt(me.preco, 2)}/mês</button>` : me.diasRestantes <= 7 ? `<button class="btn" data-href="#plano">Pro vence em ${me.diasRestantes} dia(s)</button>` : ""}
        <button class="nav-item" id="sair" style="padding-left:0">${icon("logout")}Sair</button>
      </div>`;
    $$("[data-href]", side).forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.href; toggleSide(false); }));
    $("#sair").onclick = async () => { await api("POST", "/api/auth/logout").catch(() => {}); S.me = null; history.replaceState(null, "", "/"); renderAuth("login"); };
  }

  window.addEventListener("hashchange", () => { if (S.me) route(); });
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
  let lastHash = location.hash;
  function route() {
    if (S.dirty && location.hash !== lastHash) {
      if (!confirm("Há alterações não salvas nesta ficha. Sair mesmo assim?")) { history.replaceState(null, "", lastHash); return; }
      S.dirty = false;
    }
    lastHash = location.hash;
    const [h, arg] = location.hash.split("/");
    $("#topActions").innerHTML = "";
    renderSidebar();
    $("#main").scrollTop = 0;
    const views = { "#insumos": viewInsumos, "#fichas": viewFichas, "#ficha": () => viewFicha(arg), "#historico": viewHistorico, "#notificacoes": viewNotificacoes, "#plano": viewPlano, "#conta": viewConta };
    (views[h] || viewInsumos)();
  }
  const crumb = (t) => { $("#crumb").textContent = t; };
  const pageHead = (ic, titulo, desc) => `<div class="page-icon">${icon(ic)}</div><h1 class="page-title">${esc(titulo)}</h1>${desc ? `<p class="page-desc">${desc}</p>` : ""}`;

  function upsell(msg) {
    const m = overlay(`<div class="modal" role="dialog" aria-modal="true">
      <h2>Disponível no plano Pro</h2>
      <p class="muted" style="margin:0 0 14px">${esc(msg)}</p>
      <div class="plan" style="margin-bottom:14px"><div class="price">R$ ${fmt(S.me.preco, 2)} <small>/ mês</small></div>
        <ul><li>${icon("check")}Insumos e fichas técnicas ilimitados</li><li>${icon("check")}Histórico de preços de cada insumo</li><li>${icon("check")}Seus dados continuam salvos se o plano vencer</li></ul></div>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="mc">Agora não</button><a class="btn primary" id="mg" href="${linkSuporte(motivoPro())}" target="_blank" rel="noopener">Assinar pelo WhatsApp</a></div>
      <p class="small faint" style="margin:10px 0 0;text-align:right">O pagamento é feito com o suporte: ${esc(telSuporte())}</p>
    </div>`, { center: true });
    $("#mc", m.root).onclick = m.close;
    $("#mg", m.root).addEventListener("click", m.close);
  }

  /* ================= insumos ================= */
  function viewInsumos() {
    crumb("Insumos");
    const lim = S.me.limites.insumos, cheio = lim != null && S.insumos.length >= lim;
    $("#view").innerHTML = `<div class="page wide">
      ${pageHead("box", "Insumos", "Tudo o que você compra, com a embalagem e o preço pago. Mude o preço direto na tabela: as fichas técnicas que usam o item são recalculadas na hora.")}
      ${cheio ? `<div class="callout yellow">${icon("info")}<div class="ct">Você chegou ao limite de ${lim} insumos do plano Free. <a href="#plano">Assine o Pro</a> para cadastrar sem limite.</div></div>` : ""}
      <div class="db-toolbar">
        <span class="view">${icon("table")}Tabela</span><span class="spacer"></span>
        <input class="search" id="q" type="search" placeholder="Buscar…" value="${esc(S.q)}" aria-label="Buscar insumo">
        <button class="btn ghost" id="imp">${icon("upload")}Importar lista</button>
        <button class="btn primary" id="novo">${icon("plus")}Novo</button>
      </div>
      <div class="table-wrap"><table class="db"><thead><tr>
        <th>Nome</th><th class="r">Embalagem</th><th class="r">Preço pago</th><th class="r">Custo base</th><th>Usado em</th><th>Atualizado</th>
      </tr></thead><tbody id="tb"></tbody></table></div>
      <button class="add-row" id="addRow">${icon("plus")}Novo insumo</button>
    </div>`;
    const novo = () => (cheio ? upsell(`O plano Free permite até ${lim} insumos. Assine o Pro para cadastrar sem limite.`) : peekInsumo(null));
    $("#novo").onclick = novo; $("#addRow").onclick = novo;
    $("#imp").onclick = modalImportar;
    $("#q").addEventListener("input", (e) => { S.q = e.target.value; tabelaInsumos(); });
    tabelaInsumos();
  }
  function tabelaInsumos() {
    const tb = $("#tb"); if (!tb) return;
    const q = norm(S.q);
    const list = S.insumos.filter((i) => !q || norm(i.nome).includes(q));
    if (!S.insumos.length) { tb.innerHTML = `<tr><td colspan="6"><div class="empty">Nenhum insumo ainda. Clique em <b>Novo</b> ou importe uma lista como “Arroz, 1kg, 3,60”.</div></td></tr>`; return; }
    if (!list.length) { tb.innerHTML = `<tr><td colspan="6"><div class="empty">Nada encontrado para “${esc(S.q)}”.</div></td></tr>`; return; }
    tb.innerHTML = list.map((i) => {
      const fam = C.UN[i.unidade].fam, n = usadoEm(i.id).length;
      return `<tr class="click" data-id="${i.id}">
        <td><span class="title-cell">${icon("doc")}${esc(i.nome)}</span></td>
        <td class="r num">${fmt(i.qtd, 3)} ${esc(i.unidade)}</td>
        <td class="r"><input class="cell-input" data-preco="${i.id}" inputmode="decimal" value="${p2(i.preco).replace(/\./g, "")}" aria-label="Preço de ${esc(i.nome)}"></td>
        <td class="r num muted">${brl(C.pricePerDisplayUnit(i))}/${C.BASE_LABEL[fam]}</td>
        <td>${n ? `<span class="tag green">${n} ficha${n > 1 ? "s" : ""}</span>` : `<span class="faint">—</span>`}</td>
        <td class="muted small num">${dataBR(i.atualizadoEm)}</td></tr>`;
    }).join("");
    $$("tr.click", tb).forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("input")) peekInsumo(Number(tr.dataset.id)); }));
    $$("[data-preco]", tb).forEach((inp) => {
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); if (e.key === "Escape") { inp.value = p2(S.insMap[inp.dataset.preco].preco); inp.blur(); } });
      inp.addEventListener("change", () => salvarPrecoInline(inp));
    });
  }
  async function salvarPrecoInline(inp) {
    const i = S.insMap[inp.dataset.preco]; if (!i) return;
    const v = C.parseNum(inp.value);
    if (!(v >= 0)) { inp.value = p2(i.preco); toast("Preço inválido. Use o formato 3,60."); return; }
    if (Math.abs(v - i.preco) < 0.001) return;
    try {
      const r = await api("PUT", `/api/insumos/${i.id}`, { ...i, preco: v });
      Object.assign(i, r.insumo);
      inp.classList.remove("saved"); void inp.offsetWidth; inp.classList.add("saved");
      avisarImpacto(r);
      tabelaInsumosDepois();
    } catch (e) { inp.value = p2(i.preco); tratarErro(e); }
  }
  // Re-renderiza a tabela sem roubar o foco de quem está digitando em outra célula.
  function tabelaInsumosDepois() { setTimeout(() => { if (!document.activeElement || !document.activeElement.matches("[data-preco]")) tabelaInsumos(); }, 1300); }
  function avisarImpacto(r) {
    if (!r.mudouPreco) return;
    const n = r.impacto.length;
    toast(`<b>${esc(r.insumo.nome)}</b> atualizado para ${brl(r.insumo.preco)}. ${n ? `${n} ficha${n > 1 ? "s" : ""} recalculada${n > 1 ? "s" : ""}:<ul>${r.impacto.map((x) => `<li>${esc(x.nome)}: ${brl(x.antes)} → ${brl(x.depois)} por ${esc(singular(x.un))}</li>`).join("")}</ul>` : "Nenhuma ficha usa este insumo."}`, n ? 8000 : 3500);
  }
  const singular = (u) => String(u || "porção").replace(/ões$/, "ão").replace(/s$/, "");

  function peekInsumo(id) {
    const i = id ? S.insMap[id] : { nome: "", qtd: 1, unidade: "kg", preco: "" };
    const usadas = id ? usadoEm(id) : [];
    const p = overlay(`<div class="peek" role="dialog" aria-modal="true">
      <div class="peek-head"><span class="muted small">${id ? "Insumo" : "Novo insumo"}</span><button class="icon-btn" id="pc" aria-label="Fechar">${icon("x")}</button></div>
      <form class="peek-body" id="pf" novalidate>
        <input class="title-input" id="pn" placeholder="Nome do insumo" value="${esc(i.nome)}" autofocus>
        <div class="props">
          <div class="k">${icon("hash")}Embalagem</div><div class="v row" style="flex-wrap:nowrap"><input class="input" id="pq" inputmode="decimal" style="max-width:110px" value="${i.qtd !== "" ? fmt(i.qtd, 3) : ""}">
            <select class="input" id="pu" style="max-width:90px">${Object.keys(C.UN).map((u) => `<option ${u === i.unidade ? "selected" : ""}>${u}</option>`).join("")}</select></div>
          <div class="k">${icon("coin")}Preço pago</div><div class="v"><input class="input" id="pp" inputmode="decimal" placeholder="3,60" value="${i.preco !== "" ? p2(i.preco) : ""}"></div>
          <div class="k">${icon("chart")}Custo base</div><div class="v" style="padding:6px" id="pb">—</div>
          <div class="k">${icon("book")}Usado em</div><div class="v" style="padding:6px">${usadas.length ? usadas.map((r) => `<span class="tag green" style="margin:0 4px 4px 0">${esc(r.nome)}</span>`).join("") : '<span class="faint">Nenhuma ficha</span>'}</div>
        </div>
        <div class="err" id="pe"></div>
        <div class="row" style="justify-content:space-between">
          <button class="btn primary" type="submit">Salvar</button>
          ${id ? `<button class="btn danger" type="button" id="pd">Excluir</button>` : ""}
        </div>
        ${id ? `<div id="ph"></div>` : ""}
      </form></div>`);
    $("#pc", p.root).onclick = p.close;
    const prev = () => {
      const q = C.parseNum($("#pq").value), pr = C.parseNum($("#pp").value), u = $("#pu").value, fam = C.UN[u].fam;
      $("#pb").textContent = q > 0 && pr >= 0 ? `${brl(C.pricePerDisplayUnit({ qtd: q, preco: pr, unidade: u }))} por ${C.BASE_LABEL[fam]}` : "—";
    };
    ["pq", "pp", "pu"].forEach((k) => $("#" + k).addEventListener("input", prev)); prev();
    $("#pf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { nome: $("#pn").value, qtd: $("#pq").value, unidade: $("#pu").value, preco: $("#pp").value };
      try {
        if (id) {
          const r = await api("PUT", `/api/insumos/${id}`, body);
          Object.assign(S.insMap[id], r.insumo); avisarImpacto(r);
        } else {
          const r = await api("POST", "/api/insumos", body);
          setInsumos([...S.insumos, r.insumo].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
          toast(`<b>${esc(r.insumo.nome)}</b> cadastrado.`);
        }
        p.close(); await atualizarMe(); if (location.hash.startsWith("#insumos")) viewInsumos();
      } catch (ex) { tratarErro(ex, $("#pe")); }
    });
    if (id) {
      const b = $("#pd");
      if (usadas.length) b.onclick = () => { $("#pe").textContent = `Não dá para excluir: usado em ${usadas.length} ficha(s). Remova-o dessas fichas antes.`; };
      else armar(b, "Confirmar exclusão", async () => {
        try { await api("DELETE", `/api/insumos/${id}`); setInsumos(S.insumos.filter((x) => x.id !== id)); p.close(); toast("Insumo excluído."); await atualizarMe(); viewInsumos(); }
        catch (ex) { tratarErro(ex, $("#pe")); }
      });
      // Histórico do insumo (Pro)
      const ph = $("#ph");
      if (isPro()) {
        api("GET", `/api/historico?insumo=${id}`).then((r) => {
          if (!r.historico.length) return;
          ph.innerHTML = `<div class="h2" style="font-size:16px">Histórico de preços</div><div class="table-wrap"><table class="db" style="min-width:0"><thead><tr><th>Data</th><th class="r">Embalagem</th><th class="r">Preço</th><th class="r">Variação</th></tr></thead><tbody>${r.historico.map((h) => `<tr><td class="small num">${dataHoraBR(h.data)}</td><td class="r num">${fmt(h.qtd, 3)} ${esc(h.unidade)}</td><td class="r num">${brl(h.preco)}</td><td class="r num">${variacao(h)}</td></tr>`).join("")}</tbody></table></div>`;
        }).catch(() => {});
      } else {
        ph.innerHTML = `<div class="callout" style="margin-top:20px">${icon("lock")}<div class="ct small">O histórico de preços deste insumo fica disponível no plano Pro. <a href="#plano">Conhecer o Pro</a></div></div>`;
        $("a", ph).addEventListener("click", p.close);
      }
    }
  }
  function variacao(h) {
    if (h.precoAnterior == null) return '<span class="faint">cadastro</span>';
    if (!(h.precoAnterior > 0)) return "—";
    const v = h.preco / h.precoAnterior - 1;
    return `<span class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${v > 0 ? "+" : ""}${fmt(v * 100, 1)}%</span>`;
  }

  function modalImportar() {
    const m = overlay(`<div class="modal" role="dialog" aria-modal="true">
      <h2>Importar lista de insumos</h2>
      <p class="muted small" style="margin:0 0 10px">Um item por linha: <b>nome, quantidade+unidade, preço</b>. Insumos com o mesmo nome têm o preço atualizado.</p>
      <textarea class="input" id="il" rows="8" placeholder="Arroz, 1kg, R$3,60&#10;Leite integral, 1L, 4,89&#10;Ovo, 12un, 9,90" autofocus></textarea>
      <div class="err" id="ie"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="ic">Cancelar</button><button class="btn primary" id="ig">Importar</button></div>
    </div>`, { center: true });
    $("#ic", m.root).onclick = m.close;
    $("#ig", m.root).onclick = async () => {
      const linhas = $("#il").value.split("\n").filter((l) => l.trim());
      if (!linhas.length) { $("#ie").textContent = "Cole ao menos uma linha."; return; }
      try {
        const r = await api("POST", "/api/insumos/importar", { linhas });
        const a = await api("GET", "/api/insumos"); setInsumos(a.insumos);
        await atualizarMe(); viewInsumos();
        if (r.rejeitadas.length) {
          $("#il").value = r.rejeitadas.join("\n");
          const e = $("#ie"); e.textContent = `${r.criados} cadastrado(s), ${r.atualizados} atualizado(s). ${r.rejeitadas.length} linha(s) não entraram${r.limite ? ` — ${r.mensagemLimite}` : " (confira o formato)"}.`;
        } else { m.close(); toast(`${r.criados} insumo(s) cadastrado(s), ${r.atualizados} atualizado(s).`); }
      } catch (ex) { tratarErro(ex, $("#ie")); }
    };
  }

  /* ================= fichas ================= */
  function viewFichas() {
    crumb("Fichas técnicas");
    const lim = S.me.limites.receitas, cheio = lim != null && S.receitas.length >= lim;
    const q = norm(S.qRec);
    const list = S.receitas.filter((r) => !q || norm(r.nome).includes(q) || norm(r.categoria).includes(q));
    $("#view").innerHTML = `<div class="page wide">
      ${pageHead("book", "Fichas técnicas", "Cada ficha usa os preços atuais dos seus insumos. Quando um preço muda, o custo e o preço sugerido se atualizam sozinhos.")}
      ${cheio ? `<div class="callout yellow">${icon("info")}<div class="ct">Você está usando ${S.receitas.length} de ${lim} fichas do plano Free. <a href="#plano">Assine o Pro</a> para criar sem limite.</div></div>` : ""}
      <div class="db-toolbar"><span class="view">${icon("grid")}Galeria</span><span class="spacer"></span>
        <input class="search" id="q" type="search" placeholder="Buscar…" value="${esc(S.qRec)}" aria-label="Buscar ficha">
        <button class="btn primary" id="nova">${icon("plus")}Nova</button></div>
      <div class="gallery">
        ${list.map((r) => {
          const c = C.calcRecipe(r, S.insMap);
          const over = c.venda > 0 && c.cmvReal > r.cmvAlvo / 100;
          return `<button class="gcard" data-id="${r.id}">
            <div class="cover"><span>${brl(c.porcao)}</span></div>
            <div class="body"><div class="t">${esc(r.nome)}</div>
              <div class="row" style="gap:4px">${r.categoria ? `<span class="tag orange">${esc(r.categoria)}</span>` : ""}${c.errs ? `<span class="tag red">${c.errs} pendência</span>` : ""}${c.venda > 0 ? `<span class="tag ${over ? "red" : "green"}">CMV ${pct(c.cmvReal)}</span>` : ""}</div>
              <div class="prop"><span>Custo total</span><b>${brl(c.total)}</b></div>
              <div class="prop"><span>Rende</span><b>${fmt(c.rend)} ${esc(r.unidadeRend)}</b></div>
              <div class="prop"><span>Preço sugerido</span><b>${brl(c.sugerido)}</b></div>
            </div></button>`;
        }).join("")}
        <button class="gcard new" id="novaCard">${S.receitas.length ? "+ Nova ficha técnica" : S.insumos.length ? "+ Criar sua primeira ficha técnica" : "Cadastre insumos primeiro"}</button>
      </div></div>`;
    const nova = () => {
      if (!S.insumos.length) { location.hash = "#insumos"; toast("Cadastre ao menos um insumo antes de montar a ficha."); return; }
      if (cheio) return upsell(`O plano Free permite até ${lim} fichas técnicas. Assine o Pro para criar sem limite.`);
      location.hash = "#ficha/nova";
    };
    $("#nova").onclick = nova; $("#novaCard").onclick = nova;
    $$(".gcard[data-id]").forEach((b) => b.addEventListener("click", () => { location.hash = `#ficha/${b.dataset.id}`; }));
    $("#q").addEventListener("input", (e) => { S.qRec = e.target.value; const pos = e.target.selectionStart; viewFichas(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function viewFicha(arg) {
    const id = arg === "nova" ? null : Number(arg);
    const orig = id ? S.receitas.find((r) => r.id === id) : null;
    if (id && !orig) { location.hash = "#fichas"; return; }
    if (!S.insumos.length) { location.hash = "#insumos"; return; }
    const r = orig ? JSON.parse(JSON.stringify(orig)) : { nome: "", categoria: "", rendimento: 1, unidadeRend: "porções", cmvAlvo: 30, precoVenda: 0, preparo: "", itens: [] };
    crumb(`Fichas técnicas / ${r.nome || "Nova ficha"}`);
    S.dirty = false;
    const insOpts = (sel) => `<option value="">Escolha…</option>` + S.insumos.map((i) => `<option value="${i.id}" ${i.id === sel ? "selected" : ""}>${esc(i.nome)}</option>`).join("");
    const unitOpts = (fam, sel) => C.FAM_UNITS[fam].map((u) => `<option ${u === sel ? "selected" : ""}>${u}</option>`).join("");
    $("#topActions").innerHTML = `<span class="small faint" id="saveState"></span>${id ? `<button class="btn ghost danger" id="del">Excluir</button>` : ""}<button class="btn primary" id="save">Salvar</button>`;
    $("#view").innerHTML = `<div class="page">
      <div class="page-icon">${icon("book")}</div>
      <input class="title-input" id="fn" placeholder="Nome da receita" value="${esc(r.nome)}" aria-label="Nome da receita">
      <div class="props">
        <div class="k">${icon("tag")}Categoria</div><div class="v"><input class="input" id="fcat" placeholder="Vazio" value="${esc(r.categoria)}"></div>
        <div class="k">${icon("hash")}Rendimento</div><div class="v row" style="flex-wrap:nowrap"><input class="input" id="frend" inputmode="decimal" style="max-width:100px" value="${fmt(r.rendimento, 2)}"><input class="input" id="frendu" placeholder="porções" value="${esc(r.unidadeRend)}"></div>
        <div class="k">${icon("percent")}CMV alvo</div><div class="v row" style="flex-wrap:nowrap"><input class="input" id="fcmv" inputmode="decimal" style="max-width:100px" value="${fmt(r.cmvAlvo, 1)}"><span class="muted">%</span></div>
        <div class="k">${icon("coin")}Preço de venda</div><div class="v"><input class="input" id="fven" inputmode="decimal" placeholder="Opcional" value="${r.precoVenda ? fmt(r.precoVenda, 2) : ""}" style="max-width:160px"></div>
      </div>
      <div class="callout" id="tot"></div>
      <div class="h2">Ingredientes</div>
      <p class="muted small" style="margin:0 0 8px">Quantidade = peso líquido usado. FC = fator de correção (perdas com casca, aparas etc.; 1 = sem perda). O custo considera quantidade × FC.</p>
      <div class="ing head"><span>Insumo</span><span>Qtd.</span><span>Unid.</span><span>FC</span><span style="text-align:right">Custo</span><span></span></div>
      <div id="lines"></div>
      <button class="add-row" id="addLine">${icon("plus")}Adicionar ingrediente</button>
      <div class="h2">Modo de preparo</div>
      <textarea class="input" id="fprep" rows="6" placeholder="Descreva o passo a passo…" style="background:none">${esc(r.preparo)}</textarea>
      <div class="err" id="ferr" style="margin-top:10px"></div>
      ${id ? `<p class="faint small">Criada em ${dataBR(orig.criadoEm)} · editada em ${dataHoraBR(orig.atualizadoEm)}</p>` : ""}
    </div>`;
    const lines = $("#lines");
    const addLine = (l = { insumoId: "", qtd: "", unidade: "g", fc: 1 }) => {
      const ins = S.insMap[l.insumoId];
      const fam = ins ? C.UN[ins.unidade].fam : "massa";
      const row = document.createElement("div");
      row.className = "ing";
      row.innerHTML = `<select class="input sel" aria-label="Insumo">${insOpts(l.insumoId)}</select>
        <input class="input q" inputmode="decimal" placeholder="0" aria-label="Quantidade" value="${l.qtd !== "" ? fmt(l.qtd, 3) : ""}">
        <select class="input u" aria-label="Unidade">${unitOpts(fam, l.unidade)}</select>
        <input class="input fc" inputmode="decimal" aria-label="Fator de correção" value="${fmt(l.fc || 1, 3)}">
        <span class="cost">—</span>
        <button class="icon-btn rm" type="button" aria-label="Remover ingrediente">${icon("x")}</button>`;
      $(".sel", row).addEventListener("change", (e) => {
        const i = S.insMap[e.target.value]; if (!i) return;
        const f = C.UN[i.unidade].fam;
        $(".u", row).innerHTML = unitOpts(f, f === "unidade" ? "un" : f === "volume" ? "ml" : "g");
        recompute();
      });
      $(".rm", row).onclick = () => { row.remove(); sujo(); recompute(); };
      lines.appendChild(row);
    };
    const ler = () => ({
      nome: $("#fn").value.trim(), categoria: $("#fcat").value.trim(), rendimento: C.parseNum($("#frend").value),
      unidadeRend: $("#frendu").value.trim() || "porções", cmvAlvo: C.parseNum($("#fcmv").value), precoVenda: C.parseNum($("#fven").value) || 0,
      preparo: $("#fprep").value,
      itens: [...lines.children].map((row) => ({ insumoId: Number($(".sel", row).value) || 0, qtd: C.parseNum($(".q", row).value) || 0, unidade: $(".u", row).value, fc: C.parseNum($(".fc", row).value) || 1 })),
    });
    function recompute() {
      const f = ler(), c = C.calcRecipe(f, S.insMap);
      [...lines.children].forEach((row, k) => {
        const L = c.lines[k];
        $(".cost", row).innerHTML = !L.insumoId ? '<span class="faint">—</span>' : L.err ? `<span class="tag red">${L.err}</span>` : brl(L.cost);
      });
      const over = c.venda > 0 && c.cmvReal > (f.cmvAlvo || 30) / 100;
      $("#tot").innerHTML = `${icon("bulb")}<div class="ct"><div class="totals">
        <div><span>Custo total</span><b>${brl(c.total)}</b></div>
        <div><span>Custo por ${esc(singular(f.unidadeRend))}</span><b>${brl(c.porcao)}</b></div>
        <div class="hl"><span>Preço sugerido (CMV ${fmt(f.cmvAlvo || 30, 1)}%)</span><b>${brl(c.sugerido)}</b></div>
        <div><span>CMV praticado</span><b class="${over ? "up" : ""}">${c.venda > 0 ? pct(c.cmvReal) : "—"}</b></div>
      </div></div>`;
    }
    const sujo = () => { S.dirty = true; $("#saveState").textContent = "Alterações não salvas"; };
    (r.itens.length ? r.itens : [undefined, undefined]).forEach((l) => addLine(l));
    $("#addLine").onclick = () => { addLine(); $(".sel", lines.lastElementChild).focus(); };
    const page = $("#view .page");
    page.addEventListener("input", () => { sujo(); recompute(); });
    page.addEventListener("change", () => { sujo(); recompute(); });
    recompute();
    if (!id) $("#fn").focus();

    async function salvar() {
      const f = ler(); f.itens = f.itens.filter((l) => l.insumoId);
      const err = $("#ferr"); err.textContent = "";
      if (!f.nome) { err.textContent = "Dê um nome para a receita."; $("#fn").focus(); return; }
      try {
        const res = id ? await api("PUT", `/api/receitas/${id}`, f) : await api("POST", "/api/receitas", f);
        if (id) S.receitas = S.receitas.map((x) => (x.id === id ? res.receita : x)); else S.receitas.push(res.receita);
        S.receitas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        S.dirty = false;
        toast(`Ficha <b>${esc(res.receita.nome)}</b> salva.`);
        await atualizarMe();
        if (!id) { lastHash = `#ficha/${res.receita.id}`; location.hash = lastHash; }
        else { $("#saveState").textContent = "Salvo"; crumb(`Fichas técnicas / ${res.receita.nome}`); }
      } catch (ex) { tratarErro(ex, err); }
    }
    $("#save").onclick = salvar;
    page.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); salvar(); } });
    if (id) armar($("#del"), "Confirmar exclusão", async () => {
      try { await api("DELETE", `/api/receitas/${id}`); S.receitas = S.receitas.filter((x) => x.id !== id); S.dirty = false; toast("Ficha excluída."); await atualizarMe(); location.hash = "#fichas"; }
      catch (ex) { tratarErro(ex, $("#ferr")); }
    });
  }

  /* ================= histórico ================= */
  async function viewHistorico() {
    crumb("Histórico de preços");
    const head = pageHead("history", "Histórico de preços", "Cada alteração de preço dos seus insumos, com a variação e o efeito no custo das fichas técnicas.");
    if (!isPro()) {
      $("#view").innerHTML = `<div class="page">${head}
        <div class="callout blue">${icon("lock")}<div class="ct"><b>Disponível no plano Pro</b><p style="margin:4px 0 12px">Acompanhe quanto cada insumo subiu ou caiu ao longo do tempo e veja o impacto no custo das suas receitas. Suas alterações já estão sendo registradas: ao assinar, o histórico aparece completo.</p><button class="btn primary" id="go">Assinar Pro · R$ ${fmt(S.me.preco, 2)}/mês</button></div></div></div>`;
      $("#go").onclick = () => { location.hash = "#plano"; };
      return;
    }
    $("#view").innerHTML = `<div class="page wide">${head}
      <div class="db-toolbar"><span class="view">${icon("table")}Linha do tempo</span><span class="spacer"></span>
        <select class="input" id="hf" style="width:auto;min-height:30px" aria-label="Filtrar por insumo"><option value="">Todos os insumos</option>${S.insumos.map((i) => `<option value="${i.id}">${esc(i.nome)}</option>`).join("")}</select></div>
      <div id="hl"><div class="empty">Carregando…</div></div></div>`;
    const load = async () => {
      try {
        const f = $("#hf").value;
        const r = await api("GET", "/api/historico" + (f ? `?insumo=${f}` : ""));
        const rows = r.historico.filter((h) => h.precoAnterior != null || f);
        $("#hl").innerHTML = rows.length ? `<div class="table-wrap"><table class="db"><thead><tr><th>Data</th><th>Insumo</th><th class="r">De</th><th class="r">Para</th><th class="r">Variação</th><th>Efeito nas fichas (custo por porção)</th></tr></thead><tbody>
          ${rows.map((h) => `<tr><td class="small num">${dataHoraBR(h.data)}</td><td><b style="font-weight:500">${esc(h.nome)}</b> <span class="faint small">${fmt(h.qtd, 3)} ${esc(h.unidade)}</span></td>
            <td class="r num">${h.precoAnterior != null ? brl(h.precoAnterior) : "—"}</td><td class="r num">${brl(h.preco)}</td><td class="r num">${variacao(h)}</td>
            <td class="small">${h.impacto.length ? h.impacto.map((x) => `${esc(x.nome)}: <span class="num">${brl(x.antes)} → ${brl(x.depois)}</span>`).join("<br>") : '<span class="faint">—</span>'}</td></tr>`).join("")}
          </tbody></table></div>` : `<div class="empty">Nenhuma alteração de preço ainda. Quando você mudar o preço de um insumo, ela aparece aqui.</div>`;
      } catch (e) { tratarErro(e); }
    };
    $("#hf").addEventListener("change", load);
    load();
  }

  /* ================= notificações ================= */
  async function viewNotificacoes() {
    crumb("Notificações");
    $("#view").innerHTML = `<div class="page">${pageHead("bell", "Notificações", "")}<div class="list" id="nl"><div class="empty">Carregando…</div></div></div>`;
    try {
      const r = await api("GET", "/api/notificacoes");
      $("#nl").innerHTML = r.notificacoes.length ? r.notificacoes.map((n) => `<div class="list-item"><span class="dot ${n.lida ? "read" : ""}"></span><div class="li-body">
        <div class="li-title">${esc(n.titulo)} ${n.tipo === "renovacao" ? '<span class="tag yellow">Renovação</span>' : ""}</div>
        <div style="font-size:14px;white-space:pre-wrap">${esc(n.mensagem)}</div><div class="li-meta">${dataHoraBR(n.criadoEm)}</div>
        ${n.tipo === "renovacao" ? `<a class="btn primary" style="margin-top:8px" href="${linkSuporte("renovar")}" target="_blank" rel="noopener">Renovar pelo WhatsApp</a>` : ""}</div></div>`).join("") : `<div class="empty">Nenhuma notificação.</div>`;
      $$("[data-href]", $("#nl")).forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.href; }));
      if (S.me.naoLidas) { await api("POST", "/api/notificacoes/lidas"); S.me.naoLidas = 0; renderSidebar(); }
    } catch (e) { tratarErro(e); }
  }

  /* ================= plano ================= */
  async function viewPlano() {
    crumb("Plano e assinatura");
    const me = S.me;
    const estado = isPro()
      ? `<div class="callout ${me.diasRestantes <= 7 ? "yellow" : "blue"}">${icon("info")}<div class="ct">Seu plano <b>Pro</b> está ativo até <b>${dataBR(me.proAte)}</b> (${me.diasRestantes} dia${me.diasRestantes === 1 ? "" : "s"}). ${me.diasRestantes <= 7 ? "Renove para não perder o acesso ilimitado." : "Você pode renovar antes: os dias são somados."}</div></div>`
      : me.vencido
        ? `<div class="callout red">${icon("info")}<div class="ct">Seu plano Pro venceu em ${dataBR(me.proAte)}. Seus insumos e fichas continuam salvos; renove para voltar a cadastrar sem limite e ver o histórico.</div></div>`
        : "";
    $("#view").innerHTML = `<div class="page">${pageHead("card", "Plano e assinatura", "")}${estado}
      <div class="plans">
        <div class="plan ${!isPro() ? "current" : ""}"><div class="row" style="justify-content:space-between"><b>Free</b>${!isPro() ? '<span class="tag blue">Seu plano</span>' : ""}</div>
          <div class="price">R$ 0</div>
          <ul><li>${icon("check")}Até 10 insumos</li><li>${icon("check")}Até 2 fichas técnicas</li><li>${icon("check")}Recálculo automático das fichas</li><li class="no">${icon("minus")}Histórico de preços</li></ul></div>
        <div class="plan ${isPro() ? "current" : ""}"><div class="row" style="justify-content:space-between"><b>Pro</b>${isPro() ? '<span class="tag blue">Seu plano</span>' : ""}</div>
          <div class="price">R$ ${fmt(me.preco, 2)} <small>/ mês</small></div>
          <ul><li>${icon("check")}Insumos ilimitados</li><li>${icon("check")}Fichas técnicas ilimitadas</li><li>${icon("check")}Recálculo automático das fichas</li><li>${icon("check")}Histórico de preços dos insumos</li></ul>
          <a class="btn primary block" href="${linkSuporte(motivoPro())}" target="_blank" rel="noopener">${isPro() || me.vencido ? "Renovar pelo WhatsApp" : "Assinar pelo WhatsApp"}</a>
          <span class="small faint">O pagamento é combinado com o suporte no WhatsApp ${esc(telSuporte())}. Assim que for confirmado, o Pro é liberado na sua conta por 30 dias.</span></div>
      </div>
      <div class="callout">${icon("info")}<div class="ct small">Ao abrir o WhatsApp, a mensagem já vai com o seu e-mail de cadastro (${esc(me.email)}) para o suporte localizar sua conta.</div></div>
      <div class="h2">Pagamentos</div><div id="pl"><div class="empty">Carregando…</div></div></div>`;
    try {
      const r = await api("GET", "/api/assinatura");
      $("#pl").innerHTML = r.pagamentos.length ? `<div class="table-wrap"><table class="db" style="min-width:0"><thead><tr><th>Data</th><th class="r">Valor</th><th>Período</th><th>Situação</th></tr></thead><tbody>
        ${r.pagamentos.map((p) => `<tr><td class="num">${dataBR(p.aprovadoEm || p.criadoEm)}</td><td class="r num">${brl(p.valor)}</td><td>${p.dias} dias</td><td><span class="tag green">Confirmado</span></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">Nenhum pagamento ainda.</div>`;
    } catch (e) { tratarErro(e); }
  }

  /* ================= conta ================= */
  function viewConta() {
    crumb("Meus dados");
    const me = S.me;
    $("#view").innerHTML = `<div class="page">${pageHead("user", "Meus dados", "")}
      <form id="cf" novalidate>
        <div class="props">
          <div class="k">${icon("user")}Nome</div><div class="v"><input class="input" id="cn" value="${esc(me.nome)}" autocomplete="name"></div>
          <div class="k">${icon("hash")}Telefone</div><div class="v"><input class="input" id="ct" value="${esc(telBR(me.telefone))}" inputmode="tel" autocomplete="tel-national"></div>
          <div class="k">${icon("send")}E-mail</div><div class="v" style="padding:6px">${esc(me.email)}</div>
          <div class="k">${icon("card")}Cliente desde</div><div class="v" style="padding:6px">${dataBR(me.criadoEm)}</div>
        </div>
        <div class="err" id="ce"></div>
        <button class="btn primary" type="submit">Salvar dados</button>
      </form>
      <div class="h2">Alterar senha</div>
      <form id="sf" novalidate style="max-width:360px;display:flex;flex-direction:column;gap:10px">
        <div class="field"><label for="sa">Senha atual</label><input class="input" id="sa" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="sn">Nova senha</label><input class="input" id="sn" type="password" autocomplete="new-password" placeholder="Mínimo de 8 caracteres"></div>
        <div class="err" id="se"></div>
        <div><button class="btn" type="submit">Alterar senha</button></div>
      </form></div>`;
    $("#ct").addEventListener("input", (e) => { e.target.value = mascaraTel(e.target.value); });
    $("#cf").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const r = await api("PUT", "/api/me", { nome: $("#cn").value, telefone: $("#ct").value }); S.me = r.user; renderSidebar(); toast("Dados salvos."); $("#ce").textContent = ""; }
      catch (ex) { tratarErro(ex, $("#ce")); }
    });
    $("#sf").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("PUT", "/api/me/senha", { atual: $("#sa").value, nova: $("#sn").value }); $("#sa").value = $("#sn").value = ""; $("#se").textContent = ""; toast("Senha alterada."); }
      catch (ex) { tratarErro(ex, $("#se")); }
    });
  }

  // Registra o service worker (instalação no celular e abertura offline da tela).
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
  }

  boot();
})();
