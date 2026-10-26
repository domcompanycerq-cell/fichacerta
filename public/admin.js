(function () {
  "use strict";
  const { $, $$, esc, brl, fmt, dataBR, dataHoraBR, telBR, relativo, api, toast, armar, overlay, icon } = window.UI;
  const app = $("#app");
  const S = { filtro: "todos", q: "", usuarios: [], sel: new Set(), resumo: null };

  const FILTROS = [
    ["todos", "Todos"], ["pro", "Pro"], ["free", "Free"], ["vencendo", "Vencendo (7 dias)"],
    ["vencidos", "Vencidos"], ["bloqueados", "Bloqueados"], ["inativos", "Sem acesso há 30 dias"],
  ];
  const MODELOS = {
    renovacao: { titulo: "Renove seu plano Pro", mensagem: "Seu plano Pro está perto do vencimento. Fale com o suporte no WhatsApp para renovar e manter insumos e fichas ilimitados e o histórico de preços." },
    vencido: { titulo: "Seu plano Pro venceu", mensagem: "Seu plano Pro venceu e a conta voltou ao Free. Seus dados continuam salvos. Fale com o suporte no WhatsApp para renovar e voltar ao acesso completo." },
    oferta: { titulo: "Oferta: Pro por R$ 10 no primeiro mês", mensagem: "Experimente o plano Pro com desconto: os primeiros 30 dias saem por R$ 10 (depois, R$ 25/mês). Insumos e fichas sem limite e histórico de preços. Para aproveitar, toque em Plano e assinatura e fale com o suporte no WhatsApp." },
    convite: { titulo: "Conheça o plano Pro", mensagem: "Com o Pro você cadastra insumos e fichas técnicas sem limite e acompanha o histórico de preços de cada insumo. Para assinar, fale com o suporte no WhatsApp pela página Plano e assinatura." },
  };

  async function boot() {
    try {
      const r = await api("GET", "/api/me");
      if (r.user.role !== "admin") { app.innerHTML = `<div class="auth"><div class="auth-box"><h1>Acesso restrito</h1><p class="sub">Esta área é só para administradores.</p><a class="btn" href="/">Voltar ao app</a></div></div>`; return; }
      shell(r.user);
    } catch (e) {
      app.innerHTML = `<div class="auth"><div class="auth-box"><h1>Painel administrativo</h1><p class="sub">Entre com a conta de administrador.</p><a class="btn primary block" href="/">Ir para o login</a></div></div>`;
    }
  }

  function shell(me) {
    app.innerHTML = `<div class="shell">
      <aside class="sidebar" id="side">
        <div class="ws"><span class="avatar" style="background:var(--tag-blue-bg);color:var(--tag-blue)">${icon("shield").replace("<svg", '<svg style="width:14px;height:14px"')}</span><span class="who">Painel admin</span></div>
        <div class="nav-label">Gestão</div>
        <button class="nav-item" data-href="#visao">${icon("chart")}Visão geral</button>
        <button class="nav-item" data-href="#usuarios">${icon("users")}Usuários</button>
        <button class="nav-item" data-href="#notificar">${icon("send")}Enviar notificação</button>
        <button class="nav-item" data-href="#log">${icon("history")}Registro de ações</button>
        <div class="side-foot">
          <span class="small faint">${esc(me.email)}</span>
          <a class="nav-item" href="/" style="text-decoration:none;padding-left:0">${icon("chef")}Abrir o app</a>
          <button class="nav-item" id="sair" style="padding-left:0">${icon("logout")}Sair</button>
        </div>
      </aside>
      <div id="sideScrim" class="scrim-side" hidden></div>
      <main class="main" id="main">
        <div class="topbar"><button class="icon-btn menu-btn" id="menuBtn" aria-label="Abrir menu">${icon("menu")}</button><span class="crumb" id="crumb"></span><span class="spacer"></span><span id="topActions" class="row"></span></div>
        <div id="view"></div>
      </main></div>`;
    const side = (o) => { $("#side").classList.toggle("open", o); $("#sideScrim").hidden = !o; };
    $("#menuBtn").onclick = () => side(true);
    $("#sideScrim").onclick = () => side(false);
    $$("[data-href]").forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.href; side(false); }));
    $("#sair").onclick = async () => { await api("POST", "/api/auth/logout").catch(() => {}); location.href = "/"; };
    window.addEventListener("hashchange", route);
    route();
  }

  function route() {
    const h = location.hash.split("/")[0] || "#visao";
    $$(".nav-item[data-href]").forEach((b) => { if (b.dataset.href !== h) b.removeAttribute("aria-current"); else b.setAttribute("aria-current", "page"); });
    $("#topActions").innerHTML = "";
    $("#main").scrollTop = 0;
    ({ "#visao": viewVisao, "#usuarios": viewUsuarios, "#notificar": () => viewNotificar(), "#log": viewLog }[h] || viewVisao)();
  }
  const crumb = (t) => { $("#crumb").textContent = t; };
  const head = (ic, t, d) => `<div class="page-icon">${icon(ic)}</div><h1 class="page-title">${esc(t)}</h1>${d ? `<p class="page-desc">${d}</p>` : ""}`;
  const falha = (e) => { if (e.status === 401 || e.status === 403) return boot(); toast(esc(e.message)); };

  function planoTag(u) {
    if (u.plano === "pro") return `<span class="tag blue">Pro</span>`;
    if (u.vencido) return `<span class="tag red">Pro vencido</span>`;
    return `<span class="tag">Free</span>`;
  }
  function venceTxt(u) {
    if (u.plano === "pro") return `<span class="${u.diasRestantes <= 7 ? "up" : ""}">${dataBR(u.proAte)} · ${u.diasRestantes}d</span>`;
    if (u.vencido) return `<span class="faint">venceu ${dataBR(u.proAte)}</span>`;
    return '<span class="faint">—</span>';
  }
  const statusTag = (u) => (u.status === "bloqueado" ? `<span class="tag red">Bloqueado</span>` : `<span class="tag green">Ativo</span>`);
  const wa = (u, msg) => {
    let d = String(u.telefone || "").replace(/\D/g, ""); if (d.length === 10 || d.length === 11) d = "55" + d;
    return `https://wa.me/${d}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`;
  };

  /* ================= visão geral ================= */
  async function viewVisao() {
    crumb("Visão geral");
    $("#view").innerHTML = `<div class="page wide">${head("chart", "Visão geral", "")}<div id="vg"><div class="empty">Carregando…</div></div></div>`;
    try {
      const [r, v] = await Promise.all([api("GET", "/api/admin/resumo"), api("GET", "/api/admin/usuarios?filtro=vencendo&dias=7")]);
      S.resumo = r;
      const conv = r.total ? (r.pro / r.total) * 100 : 0;
      $("#vg").innerHTML = `
        <div class="callout">${icon("info")}<div class="ct small">Os usuários pagam pelo WhatsApp do suporte (+${esc(r.suporteWhatsApp)}). Depois de confirmar o pagamento, abra o usuário em <a href="#usuarios">Usuários</a> e clique em <b>+30 dias</b> com “registrar como pagamento recebido” marcado.${!r.emailAtivo ? "<br><b>E-mail desativado:</b> configure SMTP no .env para enviar lembretes e recuperação de senha por e-mail. As notificações dentro do app funcionam normalmente." : ""}</div></div>
        <div class="stats">
          <div class="stat"><span>Usuários</span><b>${r.total}</b><small>${r.novos30} novos em 30 dias</small></div>
          <div class="stat"><span>Assinantes Pro</span><b>${r.pro}</b><small>${fmt(conv, 1)}% da base</small></div>
          <div class="stat"><span>Receita recorrente (MRR)</span><b>${brl(r.mrr)}</b><small>${r.pro} × ${brl(r.preco)}</small></div>
          <div class="stat"><span>Recebido em 30 dias</span><b>${brl(r.receita30)}</b><small>pagamentos confirmados</small></div>
          <div class="stat"><span>Ativos em 7 dias</span><b>${r.ativos7}</b><small>acessaram o app</small></div>
          <div class="stat"><span>Vencendo em 7 dias</span><b class="${r.vencendo7 ? "up" : ""}">${r.vencendo7}</b><small>precisam renovar</small></div>
          <div class="stat"><span>Pro vencidos</span><b>${r.vencidos}</b><small>voltaram ao Free</small></div>
          <div class="stat"><span>Bloqueados</span><b>${r.bloqueados}</b><small>sem acesso</small></div>
        </div>
        <div class="h2" style="margin-top:8px">Cadastros nos últimos 30 dias</div>
        ${grafico(r.cadastrosPorDia)}
        <div class="row" style="justify-content:space-between;margin-top:28px"><div class="h2" style="margin:0">Vencendo nos próximos 7 dias</div>
          ${v.usuarios.length ? `<button class="btn" id="notVenc">${icon("send")}Notificar todos (${v.usuarios.length})</button>` : ""}</div>
        ${v.usuarios.length ? tabelaUsuarios(v.usuarios, false) : `<div class="empty">Nenhuma assinatura vence nos próximos 7 dias.</div>`}`;
      if (v.usuarios.length) {
        $("#notVenc").onclick = () => { location.hash = "#notificar"; setTimeout(() => preencherNotificar({ filtro: "vencendo", modelo: "renovacao" }), 0); };
        ligarLinhas($("#vg"));
      }
    } catch (e) { falha(e); }
  }
  function grafico(dados) {
    const W = 720, H = 140, pad = { l: 28, r: 8, t: 10, b: 22 };
    const max = Math.max(1, ...dados.map((d) => d.n));
    const step = Math.max(1, Math.ceil(max / 4));
    const top = step * Math.ceil(max / step);
    const bw = (W - pad.l - pad.r) / dados.length;
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
    let grid = "";
    for (let v = 0; v <= top; v += step) grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--text-3)">${v}</text>`;
    const bars = dados.map((d, i) => {
      const x = pad.l + i * bw + bw * 0.18, h = y(0) - y(d.n);
      return `<rect x="${x}" y="${y(d.n)}" width="${bw * 0.64}" height="${Math.max(0, h)}" rx="2" fill="var(--blue)" opacity="${d.n ? 0.85 : 0}"><title>${d.dia.split("-").reverse().join("/")}: ${d.n}</title></rect>`;
    }).join("");
    const lbls = dados.map((d, i) => (i % 5 === 0 || i === dados.length - 1) ? `<text x="${pad.l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-3)">${d.dia.slice(8)}/${d.dia.slice(5, 7)}</text>` : "").join("");
    return `<div class="table-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" style="min-width:480px" role="img" aria-label="Cadastros por dia">${grid}${bars}${lbls}</svg></div>`;
  }

  /* ================= usuários ================= */
  function tabelaUsuarios(list, comSelecao) {
    return `<div class="table-wrap"><table class="db"><thead><tr>
      ${comSelecao ? `<th style="width:34px"><input type="checkbox" id="selAll" aria-label="Selecionar todos"></th>` : ""}
      <th>Nome</th><th>Contato</th><th>Plano</th><th>Vence em</th><th>Status</th><th class="r">Insumos</th><th class="r">Fichas</th><th>Último acesso</th></tr></thead><tbody>
      ${list.map((u) => `<tr class="click" data-uid="${u.id}">
        ${comSelecao ? `<td><input type="checkbox" class="sel" data-id="${u.id}" ${S.sel.has(u.id) ? "checked" : ""} aria-label="Selecionar ${esc(u.nome)}"></td>` : ""}
        <td><span class="title-cell">${icon("user")}${esc(u.nome)}</span></td>
        <td class="small"><div>${esc(u.email)}</div><a href="${wa(u)}" target="_blank" rel="noopener" class="muted">${esc(telBR(u.telefone))}</a></td>
        <td>${planoTag(u)}</td><td class="small num">${venceTxt(u)}</td><td>${statusTag(u)}</td>
        <td class="r num">${u.insumos}</td><td class="r num">${u.receitas}</td>
        <td class="small muted">${relativo(u.ultimoAcesso)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }
  function ligarLinhas(root) {
    $$("tr[data-uid]", root).forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("input,a")) peekUsuario(Number(tr.dataset.uid)); }));
  }

  async function viewUsuarios() {
    crumb("Usuários");
    $("#view").innerHTML = `<div class="page wide">${head("users", "Usuários", "Clique em um usuário para liberar o Pro, bloquear o acesso ou enviar uma mensagem.")}
      <div class="db-toolbar"><div class="tabs" id="tabs">${FILTROS.map(([k, t]) => `<button data-f="${k}" aria-pressed="${S.filtro === k}">${t}</button>`).join("")}</div>
        <span class="spacer"></span><input class="search" id="q" type="search" placeholder="Nome, e-mail ou telefone" value="${esc(S.q)}" aria-label="Buscar usuário"></div>
      <div id="bulk" class="row" style="padding:8px 0" hidden><span class="small" id="bulkN"></span><button class="btn" id="bulkNotify">${icon("send")}Notificar selecionados</button><button class="btn ghost" id="bulkClear">Limpar seleção</button></div>
      <div id="ul"><div class="empty">Carregando…</div></div></div>`;
    $$("#tabs button").forEach((b) => b.addEventListener("click", () => { S.filtro = b.dataset.f; $$("#tabs button").forEach((x) => x.setAttribute("aria-pressed", x === b)); carregar(); }));
    let t; $("#q").addEventListener("input", (e) => { S.q = e.target.value; clearTimeout(t); t = setTimeout(carregar, 250); });
    $("#bulkNotify").onclick = () => { location.hash = "#notificar"; setTimeout(() => preencherNotificar({ ids: [...S.sel] }), 0); };
    $("#bulkClear").onclick = () => { S.sel.clear(); carregar(); };
    carregar();
  }
  async function carregar() {
    try {
      const r = await api("GET", `/api/admin/usuarios?filtro=${S.filtro}&q=${encodeURIComponent(S.q)}`);
      S.usuarios = r.usuarios;
      const ul = $("#ul"); if (!ul) return;
      ul.innerHTML = r.usuarios.length ? tabelaUsuarios(r.usuarios, true) : `<div class="empty">Nenhum usuário neste filtro.</div>`;
      ligarLinhas(ul);
      $$(".sel", ul).forEach((c) => c.addEventListener("change", () => { const id = Number(c.dataset.id); c.checked ? S.sel.add(id) : S.sel.delete(id); bulkBar(); }));
      const all = $("#selAll");
      if (all) all.addEventListener("change", () => { r.usuarios.forEach((u) => (all.checked ? S.sel.add(u.id) : S.sel.delete(u.id))); $$(".sel", ul).forEach((c) => { c.checked = all.checked; }); bulkBar(); });
      bulkBar();
    } catch (e) { falha(e); }
  }
  function bulkBar() { const b = $("#bulk"); if (!b) return; b.hidden = !S.sel.size; $("#bulkN").textContent = `${S.sel.size} selecionado(s)`; }

  async function peekUsuario(id) {
    let d;
    try { d = await api("GET", `/api/admin/usuarios/${id}`); } catch (e) { return falha(e); }
    const u = d.usuario;
    const p = overlay(`<div class="peek" role="dialog" aria-modal="true">
      <div class="peek-head"><span class="muted small">Usuário #${u.id}</span><button class="icon-btn" id="pc" aria-label="Fechar">${icon("x")}</button></div>
      <div class="peek-body">
        <h1 class="page-title" style="font-size:30px">${esc(u.nome)}</h1>
        <div class="props">
          <div class="k">${icon("send")}E-mail</div><div class="v" style="padding:6px">${esc(u.email)}</div>
          <div class="k">${icon("hash")}Telefone</div><div class="v" style="padding:6px"><a href="${wa(u)}" target="_blank" rel="noopener">${esc(telBR(u.telefone))}</a> <span class="faint small">abre no WhatsApp</span></div>
          <div class="k">${icon("card")}Plano</div><div class="v" style="padding:6px">${planoTag(u)} <span class="small">${venceTxt(u)}</span> ${u.ofertaDisponivel ? `<span class="tag orange">Oferta 1º mês: ${brl(S.resumo ? S.resumo.precoOferta : 10)}</span>` : ""}</div>
          <div class="k">${icon("shield")}Status</div><div class="v" style="padding:6px">${statusTag(u)} ${u.motivoBloqueio ? `<span class="small muted">${esc(u.motivoBloqueio)}</span>` : ""}</div>
          <div class="k">${icon("box")}Uso</div><div class="v" style="padding:6px">${u.insumos} insumos · ${u.receitas} fichas</div>
          <div class="k">${icon("coin")}Total pago</div><div class="v" style="padding:6px">${brl(u.totalPago)}</div>
          <div class="k">${icon("history")}Cadastro</div><div class="v" style="padding:6px">${dataBR(u.criadoEm)} · último acesso ${relativo(u.ultimoAcesso)}</div>
        </div>

        <div class="h2" style="font-size:16px">Plano Pro</div>
        <div class="row">
          <button class="btn primary" data-pro="30">+30 dias</button><button class="btn" data-pro="90">+90 dias</button><button class="btn" data-pro="365">+1 ano</button>
          <label class="row small muted" style="gap:4px"><input type="checkbox" id="regPag" checked> registrar como pagamento recebido</label>
        </div>
        ${u.ofertaDisponivel ? `<p class="small muted" style="margin:6px 0 0">Primeira assinatura: os primeiros 30 dias são registrados pelo valor da oferta (${brl(S.resumo ? S.resumo.precoOferta : 10)}); meses extras, pelo preço normal.</p>` : ""}
        <div>
        </div>
        <div class="row" style="margin-top:8px"><label class="small muted" for="ate">Ou definir vencimento</label><input class="input" type="date" id="ate" style="width:auto"><button class="btn" id="setAte">Aplicar</button>
          ${u.plano === "pro" || u.vencido ? `<button class="btn ghost danger" id="toFree">Voltar ao Free</button>` : ""}</div>

        <div class="h2" style="font-size:16px">Acesso</div>
        ${u.status === "bloqueado"
          ? `<button class="btn primary" id="liberar">Liberar acesso</button>`
          : `<div class="row"><input class="input grow" id="motivo" placeholder="Motivo do bloqueio (o usuário verá esta mensagem)"><button class="btn danger" id="bloquear">Bloquear</button></div>`}
        <div class="row" style="margin-top:8px"><button class="btn ghost" id="tmp">Gerar senha temporária</button><span id="tmpOut" class="small"></span></div>

        <div class="h2" style="font-size:16px">Mensagem rápida</div>
        <div class="row"><button class="btn" id="msgRenov">${icon("send")}Lembrete de renovação</button><a class="btn ghost" target="_blank" rel="noopener" href="${wa(u, `Olá, ${u.nome.split(" ")[0]}! `)}">Abrir WhatsApp</a></div>
        <div class="err" id="pe"></div>

        ${d.pagamentos.length ? `<div class="h2" style="font-size:16px">Pagamentos</div><div class="table-wrap"><table class="db" style="min-width:0"><thead><tr><th>Data</th><th class="r">Valor</th><th>Período</th><th>Origem</th><th>Situação</th></tr></thead><tbody>${d.pagamentos.map((x) => `<tr><td class="small num">${dataBR(x.aprovadoEm || x.criadoEm)}</td><td class="r num">${brl(x.valor)}</td><td>${x.dias}d</td><td class="small">${x.provider === "whatsapp-oferta" ? "WhatsApp (oferta)" : "WhatsApp"}</td><td><span class="tag ${x.status === "pendente" ? "yellow" : "green"}">${x.status}</span></td></tr>`).join("")}</tbody></table></div>` : ""}
        ${d.log.length ? `<div class="h2" style="font-size:16px">Ações do administrador</div><div class="list">${d.log.map((l) => `<div class="list-item" style="padding:6px 0"><div class="li-body"><span class="small"><b>${esc(l.acao)}</b> ${esc(l.detalhe)}</span><div class="li-meta">${dataHoraBR(l.criadoEm)}</div></div></div>`).join("")}</div>` : ""}
        ${d.notificacoes.length ? `<div class="h2" style="font-size:16px">Notificações recebidas</div><div class="list">${d.notificacoes.map((n) => `<div class="list-item" style="padding:6px 0"><span class="dot ${n.lida ? "read" : ""}"></span><div class="li-body"><span class="small">${esc(n.titulo)}</span><div class="li-meta">${dataHoraBR(n.criadoEm)} · ${n.lida ? "lida" : "não lida"}</div></div></div>`).join("")}</div>` : ""}
      </div></div>`);
    const pe = $("#pe", p.root);
    const reabrir = async (msg) => { toast(msg); p.close(); await peekUsuario(id); if (location.hash.startsWith("#usuarios")) carregar(); else if (location.hash.startsWith("#visao") || !location.hash) viewVisao(); };
    const acao = async (url, body, msg) => { try { await api("POST", url, body); await reabrir(msg); } catch (e) { pe.textContent = e.message; } };
    $("#pc", p.root).onclick = p.close;
    $$("[data-pro]", p.root).forEach((b) => b.addEventListener("click", () => acao(`/api/admin/usuarios/${id}/pro`, { dias: Number(b.dataset.pro), registrarPagamento: $("#regPag").checked }, `Pro estendido em ${b.dataset.pro} dias.`)));
    $("#setAte", p.root).onclick = () => { const v = $("#ate").value; if (!v) { pe.textContent = "Escolha uma data."; return; } acao(`/api/admin/usuarios/${id}/pro`, { ate: v }, `Vencimento definido para ${v.split("-").reverse().join("/")}.`); };
    const tf = $("#toFree", p.root); if (tf) armar(tf, "Confirmar: voltar ao Free", () => acao(`/api/admin/usuarios/${id}/free`, {}, "Usuário voltou ao plano Free."));
    const lib = $("#liberar", p.root); if (lib) lib.onclick = () => acao(`/api/admin/usuarios/${id}/liberar`, {}, "Acesso liberado.");
    const blq = $("#bloquear", p.root); if (blq) armar(blq, "Confirmar bloqueio", () => acao(`/api/admin/usuarios/${id}/bloquear`, { motivo: $("#motivo").value }, "Usuário bloqueado. Sessões encerradas."));
    armar($("#tmp", p.root), "Confirmar: trocar a senha", async () => {
      try { const r = await api("POST", `/api/admin/usuarios/${id}/senha-temporaria`); $("#tmpOut").innerHTML = `Nova senha: <b class="num" style="user-select:all">${esc(r.senha)}</b> — envie ao usuário e peça para trocar em Meus dados.`; }
      catch (e) { pe.textContent = e.message; }
    });
    $("#msgRenov", p.root).onclick = async () => {
      try {
        const r = await api("POST", "/api/admin/notificar", { ids: [id], ...MODELOS[u.vencido ? "vencido" : "renovacao"], tipo: "renovacao", email: true });
        pe.style.color = "var(--text-2)";
        pe.innerHTML = `Notificação enviada no app${r.emails ? " e por e-mail" : ""}. <a href="${esc(r.whatsapp[0].link)}" target="_blank" rel="noopener">Enviar também pelo WhatsApp</a>`;
      } catch (e) { pe.textContent = e.message; }
    };
  }

  /* ================= notificações ================= */
  let pendente = null;
  function preencherNotificar(o) { pendente = o; viewNotificar(); }
  function viewNotificar() {
    crumb("Enviar notificação");
    const o = pendente || {}; pendente = null;
    const ids = o.ids || null;
    $("#view").innerHTML = `<div class="page">${head("send", "Enviar notificação", "A mensagem aparece no sino do app. Se o e-mail estiver configurado, também vai por e-mail. Para WhatsApp, o painel gera um link pronto por usuário.")}
      <form id="nf" novalidate style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label for="dest">Para quem</label>
          ${ids ? `<div class="callout" style="margin:0">${icon("users")}<div class="ct">${ids.length} usuário(s) selecionado(s) na lista. <button type="button" class="btn ghost" id="trocar">Escolher por filtro</button></div></div>`
            : `<select class="input" id="dest">${FILTROS.map(([k, t]) => `<option value="${k}" ${o.filtro === k ? "selected" : ""}>${k === "todos" ? "Todos os usuários" : t}</option>`).join("")}</select>`}
        </div>
        <div class="field"><label>Modelo</label><div class="row">
          <button type="button" class="btn" data-m="renovacao">Renovação</button><button type="button" class="btn" data-m="vencido">Plano vencido</button><button type="button" class="btn" data-m="oferta">Oferta R$ 10</button><button type="button" class="btn" data-m="convite">Convite para o Pro</button></div></div>
        <div class="field"><label for="nt">Título</label><input class="input" id="nt" maxlength="120"></div>
        <div class="field"><label for="nm">Mensagem</label><textarea class="input" id="nm" rows="5" maxlength="2000"></textarea></div>
        <label class="row small"><input type="checkbox" id="ne" ${S.resumo && !S.resumo.emailAtivo ? "" : "checked"}> Enviar também por e-mail</label>
        <label class="row small"><input type="checkbox" id="nr" ${o.modelo ? "checked" : ""}> Marcar como lembrete de renovação (mostra o botão “Renovar pelo WhatsApp” no app)</label>
        <div class="err" id="nerr"></div>
        <div class="row"><button class="btn primary" type="submit" id="nsend">${icon("send")}Enviar</button><span class="small muted" id="nprev"></span></div>
      </form>
      <div id="nres"></div>
      <hr class="divider">
      <div class="h2" style="font-size:16px">Lembretes automáticos</div>
      <p class="muted small" style="margin:0 0 8px">O servidor verifica a cada hora e avisa cada assinante 7 dias antes, 1 dia antes e no dia em que o Pro vence (no app e por e-mail). Cada aviso sai uma única vez por ciclo.</p>
      <button class="btn" id="runRem">Verificar agora</button> <span class="small muted" id="remOut"></span>
    </div>`;
    const aplicar = (k) => { $("#nt").value = MODELOS[k].titulo; $("#nm").value = MODELOS[k].mensagem; if (k !== "convite") $("#nr").checked = true; };
    $$("[data-m]").forEach((b) => b.addEventListener("click", () => aplicar(b.dataset.m)));
    if (o.modelo) aplicar(o.modelo);
    const tr = $("#trocar"); if (tr) tr.onclick = () => viewNotificar();
    const prev = async () => {
      if (ids) { $("#nprev").textContent = `${ids.length} destinatário(s)`; return; }
      try { const r = await api("GET", `/api/admin/usuarios?filtro=${$("#dest").value}`); $("#nprev").textContent = `${r.usuarios.length} destinatário(s)`; } catch (e) { /* ignora */ }
    };
    const dest = $("#dest"); if (dest) dest.addEventListener("change", prev); prev();
    let confirmado = false;
    $("#nf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#nerr"); err.textContent = "";
      const body = { titulo: $("#nt").value, mensagem: $("#nm").value, email: $("#ne").checked, tipo: $("#nr").checked ? "renovacao" : "admin" };
      if (ids) body.ids = ids; else { body.filtro = $("#dest").value; body.dias = 7; }
      if (!body.titulo.trim() || !body.mensagem.trim()) { err.textContent = "Preencha título e mensagem."; return; }
      if (!confirmado) { confirmado = true; $("#nsend").innerHTML = `Confirmar envio · ${$("#nprev").textContent}`; $("#nsend").classList.add("armed"); setTimeout(() => { confirmado = false; const b = $("#nsend"); if (b) { b.classList.remove("armed"); b.innerHTML = `${icon("send")}Enviar`; } }, 4000); return; }
      confirmado = false;
      try {
        const r = await api("POST", "/api/admin/notificar", body);
        $("#nsend").classList.remove("armed"); $("#nsend").innerHTML = `${icon("send")}Enviar`;
        $("#nres").innerHTML = `<div class="callout blue">${icon("check")}<div class="ct">Enviada para ${r.enviadas} usuário(s) no app${body.email ? ` · ${r.emails} e-mail(s) enviados` : ""}.</div></div>
          ${r.whatsapp.length ? `<div class="h2" style="font-size:16px">Enviar pelo WhatsApp</div><p class="muted small" style="margin:0 0 6px">Cada link abre o WhatsApp com a mensagem pronta para aquele contato.</p>
          <div class="list">${r.whatsapp.map((w) => `<div class="list-item" style="padding:6px 0;align-items:center"><div class="li-body"><b style="font-weight:500">${esc(w.nome)}</b> <span class="small muted">${esc(telBR(w.telefone))}</span></div><a class="btn" href="${esc(w.link)}" target="_blank" rel="noopener">Abrir WhatsApp</a></div>`).join("")}</div>` : ""}`;
        S.sel.clear();
      } catch (ex) { err.textContent = ex.message; }
    });
    $("#runRem").onclick = async () => {
      try { const r = await api("POST", "/api/admin/lembretes/rodar"); $("#remOut").textContent = r.enviados ? `${r.enviados} lembrete(s) enviados.` : "Nenhum lembrete pendente agora."; }
      catch (e) { falha(e); }
    };
  }

  /* ================= log ================= */
  async function viewLog() {
    crumb("Registro de ações");
    $("#view").innerHTML = `<div class="page">${head("history", "Registro de ações", "Tudo o que foi feito pelo painel: liberações, bloqueios e notificações.")}<div id="lg"><div class="empty">Carregando…</div></div></div>`;
    try {
      const r = await api("GET", "/api/admin/log");
      $("#lg").innerHTML = r.log.length ? `<div class="table-wrap"><table class="db" style="min-width:0"><thead><tr><th>Data</th><th>Ação</th><th>Usuário</th><th>Detalhe</th></tr></thead><tbody>
        ${r.log.map((l) => `<tr><td class="small num">${dataHoraBR(l.criadoEm)}</td><td><span class="tag ${l.acao === "bloqueio" ? "red" : l.acao === "pro" ? "blue" : l.acao === "liberação" ? "green" : ""}">${esc(l.acao)}</span></td><td>${esc(l.usuario || "—")}</td><td class="small muted">${esc(l.detalhe)}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">Nenhuma ação registrada ainda.</div>`;
    } catch (e) { falha(e); }
  }

  boot();
})();
