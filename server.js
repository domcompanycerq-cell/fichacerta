"use strict";
// Servidor do CMV Certo. Na Vercel este arquivo é a função (exporta o app Express);
// no computador, `npm start` sobe o mesmo app na porta 3000.
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { get, all, run, tx, now, ready } = require("./lib/db");
const auth = require("./lib/auth");
const planos = require("./lib/planos");
const notif = require("./lib/notificacoes");
const Calc = require("./public/calc");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "300kb" }));

// Cabeçalhos de segurança (os mesmos do vercel.json, para valer também no computador e nas respostas da API).
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  next();
});
// Respostas da API têm dados pessoais: nunca guardar em cache (navegador, CDN ou service worker).
app.use("/api", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("Vary", "Cookie"); next(); });

/* ---------------- utilidades ---------------- */
const erro = (res, status, msg, code) => res.status(status).json({ erro: msg, code });
const txt = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const soDigitos = (v) => String(v || "").replace(/\D/g, "");
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // handlers assíncronos

// Na primeira requisição de cada instância: cria as tabelas e garante a conta de admin.
let iniciado = null;
function iniciar() {
  if (!iniciado) iniciado = (async () => { await ready(); await garantirAdmin(); })().catch((e) => { iniciado = null; throw e; });
  return iniciado;
}
async function garantirAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase(), senha = process.env.ADMIN_PASSWORD || "";
  if (!email || !senha) { console.warn("[admin] Defina ADMIN_EMAIL e ADMIN_PASSWORD para criar o acesso ao painel."); return; }
  const u = await get("SELECT id, role, status FROM users WHERE email = $1", email);
  if (!u) {
    await run("INSERT INTO users (nome, email, telefone, senha_hash, role, criado_em) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING",
      "Administrador", email, "00000000000", await auth.hashSenha(senha), "admin", now());
    console.log(`[admin] Conta de administrador criada: ${email}`);
  } else if (u.role !== "admin" || u.status !== "ativo") {
    await run("UPDATE users SET role = 'admin', status = 'ativo' WHERE id = $1", u.id);
  }
}

app.get("/api/health", h(async (req, res) => { await ready(); await get("SELECT 1 AS ok"); res.json({ ok: true }); }));

app.use("/api", h(async (req, res, next) => { await iniciar(); next(); }));
// Proteção CSRF: toda escrita na API precisa do cabeçalho enviado pelo nosso front (o cron é GET).
// Também recusa escritas vindas de outro site (cabeçalho Origin diferente do próprio app).
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (req.get("X-Requested-With") !== "fetch") return erro(res, 403, "Requisição inválida.");
  const origem = req.get("origin");
  if (origem) {
    let host = "";
    try { host = new URL(origem).host; } catch (e) { /* origem inválida */ }
    if (host !== req.get("host")) return erro(res, 403, "Requisição inválida.");
  }
  next();
});
app.use("/api", auth.carregarUsuario);

async function userOut(u) {
  const { n } = await get("SELECT COUNT(*)::int AS n FROM notificacoes WHERE user_id = $1 AND lida = FALSE", u.id);
  const b = await planos.bloqueados(u);
  return {
    id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, role: u.role,
    criadoEm: u.criado_em, ...planos.resumoPlano(u), uso: await planos.uso(u.id), naoLidas: n,
    bloqueados: { insumos: b.insumos.size, receitas: b.receitas.size },
  };
}
const MSG_BLOQ_INSUMO = "Este insumo está bloqueado: sua conta está no plano Free, que permite até 10 insumos. Nada foi apagado. Renove o Pro para desbloquear.";
const MSG_BLOQ_FICHA = "Esta ficha está bloqueada: sua conta está no plano Free, que permite até 2 fichas técnicas. Nada foi apagado. Renove o Pro para desbloquear.";
const insumoOut = (r, bloq) => ({ id: r.id, nome: r.nome, qtd: r.qtd, unidade: r.unidade, preco: r.preco, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em, bloqueado: !!(bloq && bloq.insumos.has(r.id)) });
const receitaOut = (r) => ({
  id: r.id, nome: r.nome, categoria: r.categoria, rendimento: r.rendimento, unidadeRend: r.unidade_rend,
  cmvAlvo: r.cmv_alvo, precoVenda: r.preco_venda, preparo: r.preparo, itens: JSON.parse(r.itens_json || "[]"),
  criadoEm: r.criado_em, atualizadoEm: r.atualizado_em,
});
async function mapaInsumos(userId) {
  const m = {};
  (await all("SELECT * FROM insumos WHERE user_id = $1", userId)).forEach((r) => { m[r.id] = insumoOut(r); });
  return m;
}
async function receitasQueUsam(userId, insumoId) {
  return (await all("SELECT * FROM receitas WHERE user_id = $1", userId)).map(receitaOut).filter((r) => r.itens.some((l) => l.insumoId === insumoId));
}

function validarInsumo(body) {
  const nome = txt(body.nome, 120);
  const qtd = Calc.parseNum(body.qtd), preco = Calc.parseNum(body.preco);
  const unidade = String(body.unidade || "");
  if (!nome) return { erro: "Informe o nome do insumo." };
  if (!Calc.UN[unidade]) return { erro: "Unidade inválida. Use kg, g, L, ml, un ou dz." };
  if (!(qtd > 0) || qtd > 1e6) return { erro: "A quantidade da embalagem precisa ser maior que zero." };
  if (!(preco >= 0) || preco > 1e7) return { erro: "Informe um preço válido, por exemplo 3,60." };
  return { nome, qtd, unidade, preco: Math.round(preco * 100) / 100 };
}

/* ---------------- autenticação ---------------- */
app.post("/api/auth/cadastro", h(async (req, res) => {
  const nome = txt(req.body.nome, 100), email = txt(req.body.email, 160).toLowerCase();
  const telefone = soDigitos(req.body.telefone), senha = String(req.body.senha || "");
  if (await auth.limitarTentativas(`cad:${req.ip}`, 10, 60 * 60e3)) return erro(res, 429, "Muitos cadastros a partir desta rede. Tente mais tarde.");
  if (nome.length < 2) return erro(res, 400, "Informe seu nome.");
  if (!(telefone.length === 10 || telefone.length === 11)) return erro(res, 400, "Informe o telefone com DDD, por exemplo (15) 99999-9999.");
  if (!EMAIL_RE.test(email)) return erro(res, 400, "Informe um e-mail válido.");
  if (senha.length < 8) return erro(res, 400, "A senha precisa ter pelo menos 8 caracteres.");
  const hash = await auth.hashSenha(senha);
  const novo = await get(
    "INSERT INTO users (nome, email, telefone, senha_hash, criado_em, ultimo_acesso) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING RETURNING *",
    nome, email, telefone, hash, now(), now());
  if (!novo) return erro(res, 409, "Este e-mail já tem cadastro. Faça login ou recupere a senha.");
  await run("INSERT INTO notificacoes (user_id, titulo, mensagem, tipo, criado_em) VALUES ($1,$2,$3,$4,$5)", novo.id,
    `Boas-vindas ao ${notif.APP_NAME}`,
    "Comece cadastrando seus insumos com embalagem e preço. Depois monte as fichas técnicas: o custo é calculado sozinho e se atualiza sempre que um preço mudar.",
    "sistema", now());
  await auth.criarSessao(req, res, novo.id);
  res.status(201).json({ user: await userOut(novo) });
}));

app.post("/api/auth/login", h(async (req, res) => {
  const email = txt(req.body.email, 160).toLowerCase(), senha = String(req.body.senha || "");
  if (await auth.limitarTentativas(`login:${req.ip}:${email}`) || await auth.limitarTentativas(`login-ip:${req.ip}`, 40))
    return erro(res, 429, "Muitas tentativas. Aguarde 15 minutos e tente de novo.");
  const u = await get("SELECT * FROM users WHERE email = $1", email);
  const senhaOk = await auth.conferirSenha(senha, u && u.senha_hash); // roda mesmo sem usuário, para o tempo ser igual
  if (!u || !senhaOk) return erro(res, 401, "E-mail ou senha incorretos.");
  if (u.status === "bloqueado") return erro(res, 403, auth.msgBloqueio(u), "bloqueado");
  await run("UPDATE users SET ultimo_acesso = $1 WHERE id = $2", now(), u.id);
  await auth.criarSessao(req, res, u.id);
  res.json({ user: await userOut(u) });
}));

app.post("/api/auth/logout", h(async (req, res) => { await auth.encerrarSessao(req, res); res.json({ ok: true }); }));

app.post("/api/auth/esqueci", h(async (req, res) => {
  const email = txt(req.body.email, 160).toLowerCase();
  if (!notif.emailAtivo) return res.json({ ok: true, mensagem: "A recuperação por e-mail não está disponível. Fale com o suporte no WhatsApp para receber uma senha temporária." });
  if (await auth.limitarTentativas(`reset:${req.ip}`, 5)) return erro(res, 429, "Muitas tentativas. Aguarde alguns minutos.");
  const u = await get("SELECT id, nome, email FROM users WHERE email = $1", email);
  if (u) {
    const t = auth.token();
    await run("INSERT INTO reset_tokens (token_hash, user_id, expira_em) VALUES ($1,$2,$3)", auth.sha(t), u.id, new Date(Date.now() + 3600e3).toISOString());
    await notif.enviarEmail(u.email, `${notif.APP_NAME}: redefinir senha`,
      `Olá, ${u.nome.split(" ")[0]}!\n\nPara criar uma nova senha, abra o link abaixo (vale por 1 hora):\n${notif.APP_URL}/#redefinir=${t}\n\nSe não foi você, ignore este e-mail.`);
  }
  res.json({ ok: true, mensagem: "Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha." });
}));

app.post("/api/auth/redefinir", h(async (req, res) => {
  const t = String(req.body.token || ""), senha = String(req.body.senha || "");
  if (senha.length < 8) return erro(res, 400, "A senha precisa ter pelo menos 8 caracteres.");
  const row = await get("SELECT * FROM reset_tokens WHERE token_hash = $1 AND expira_em > $2", auth.sha(t), now());
  if (!row) return erro(res, 400, "Link inválido ou expirado. Peça um novo.");
  const hash = await auth.hashSenha(senha);
  await tx(async (d) => {
    await d.run("UPDATE users SET senha_hash = $1 WHERE id = $2", hash, row.user_id);
    await d.run("DELETE FROM reset_tokens WHERE user_id = $1", row.user_id);
    await d.run("DELETE FROM sessions WHERE user_id = $1", row.user_id);
  });
  res.json({ ok: true });
}));

/* ---------------- conta ---------------- */
// Dados públicos para a tela de login (nome do app e WhatsApp do suporte).
app.get("/api/config", (req, res) => {
  res.json({ appName: notif.APP_NAME, suporteWhatsApp: notif.SUPORTE_WHATSAPP, preco: planos.PRECO_PRO, precoOferta: planos.PRECO_OFERTA, diasOferta: planos.DIAS_OFERTA });
});

app.get("/api/me", h(async (req, res) => {
  if (!req.user) return erro(res, 401, "Não autenticado.", "nao_autenticado");
  if (req.user.status === "bloqueado") return erro(res, 403, auth.msgBloqueio(req.user), "bloqueado");
  res.json({ user: await userOut(req.user), suporteWhatsApp: notif.SUPORTE_WHATSAPP, emailAtivo: notif.emailAtivo, appName: notif.APP_NAME });
}));

app.put("/api/me", auth.exigirLogin, h(async (req, res) => {
  const nome = txt(req.body.nome, 100), telefone = soDigitos(req.body.telefone);
  if (nome.length < 2) return erro(res, 400, "Informe seu nome.");
  if (!(telefone.length === 10 || telefone.length === 11)) return erro(res, 400, "Informe o telefone com DDD.");
  const u = await get("UPDATE users SET nome = $1, telefone = $2 WHERE id = $3 RETURNING *", nome, telefone, req.user.id);
  res.json({ user: await userOut(u) });
}));

app.put("/api/me/senha", auth.exigirLogin, h(async (req, res) => {
  if (!(await auth.conferirSenha(String(req.body.atual || ""), req.user.senha_hash))) return erro(res, 400, "A senha atual não confere.");
  const nova = String(req.body.nova || "");
  if (nova.length < 8) return erro(res, 400, "A nova senha precisa ter pelo menos 8 caracteres.");
  const hash = await auth.hashSenha(nova);
  await tx(async (d) => {
    await d.run("UPDATE users SET senha_hash = $1 WHERE id = $2", hash, req.user.id);
    // Encerra as sessões em outros aparelhos; mantém só a atual.
    await d.run("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", req.user.id, req.sessaoHash || "");
  });
  res.json({ ok: true });
}));

/* ---------------- insumos ---------------- */
async function checarLimite(user, tipo, adicionando = 1) {
  const lim = planos.limites(user)[tipo];
  if (!isFinite(lim)) return null;
  const atual = (await planos.uso(user.id))[tipo];
  return atual + adicionando > lim ? { lim, atual } : null;
}
const msgLimite = (tipo, lim) => tipo === "insumos"
  ? `O plano Free permite até ${lim} insumos. Assine o Pro para cadastrar sem limite.`
  : `O plano Free permite até ${lim} fichas técnicas. Assine o Pro para criar sem limite.`;

async function criarInsumo(userId, v) {
  return tx(async (d) => {
    const r = await d.get("INSERT INTO insumos (user_id, nome, qtd, unidade, preco, criado_em, atualizado_em) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      userId, v.nome, v.qtd, v.unidade, v.preco, now(), now());
    await d.run("INSERT INTO insumo_historico (insumo_id, user_id, preco_anterior, preco, qtd, unidade, data) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      r.id, userId, null, v.preco, v.qtd, v.unidade, now());
    return r;
  });
}
const nomeExiste = (userId, nome, excetoId = 0) =>
  get("SELECT id FROM insumos WHERE user_id = $1 AND lower(nome) = lower($2) AND id <> $3", userId, nome, excetoId);

app.get("/api/insumos", auth.exigirLogin, h(async (req, res) => {
  const bloq = await planos.bloqueados(req.user);
  res.json({ insumos: (await all("SELECT * FROM insumos WHERE user_id = $1 ORDER BY lower(nome)", req.user.id)).map((r) => insumoOut(r, bloq)) });
}));

app.post("/api/insumos", auth.exigirLogin, h(async (req, res) => {
  const v = validarInsumo(req.body);
  if (v.erro) return erro(res, 400, v.erro);
  const l = await checarLimite(req.user, "insumos");
  if (l) return erro(res, 402, msgLimite("insumos", l.lim), "limite");
  if (await nomeExiste(req.user.id, v.nome)) return erro(res, 409, `Já existe um insumo chamado “${v.nome}”.`);
  res.status(201).json({ insumo: insumoOut(await criarInsumo(req.user.id, v)) });
}));

// Atualiza um insumo. Se preço/embalagem mudarem, grava no histórico e devolve o impacto em cada ficha.
async function atualizarInsumo(user, id, v) {
  const prev = await get("SELECT * FROM insumos WHERE id = $1 AND user_id = $2", id, user.id);
  if (!prev) return { status: 404, erro: "Insumo não encontrado." };
  if ((await planos.bloqueados(user)).insumos.has(id)) return { status: 402, erro: MSG_BLOQ_INSUMO, code: "item_bloqueado" };
  if (await nomeExiste(user.id, v.nome, id)) return { status: 409, erro: `Já existe um insumo chamado “${v.nome}”.` };
  const usadas = await receitasQueUsam(user.id, id);
  if (usadas.length && Calc.UN[v.unidade].fam !== Calc.UN[prev.unidade].fam)
    return { status: 409, erro: `Este insumo é usado em ${usadas.length} ficha(s) medidas em ${Calc.FAM_UNITS[Calc.UN[prev.unidade].fam].join("/")}. Escolha uma unidade do mesmo tipo.` };
  const mudouPreco = prev.preco !== v.preco || prev.qtd !== v.qtd || prev.unidade !== v.unidade;
  let impacto = [];
  if (mudouPreco) {
    const antes = await mapaInsumos(user.id);
    const depois = { ...antes, [id]: { ...antes[id], ...v } };
    impacto = usadas.map((r) => ({ receitaId: r.id, nome: r.nome, un: r.unidadeRend, antes: Calc.calcRecipe(r, antes).porcao, depois: Calc.calcRecipe(r, depois).porcao }));
  }
  const atualizado = await tx(async (d) => {
    const row = await d.get("UPDATE insumos SET nome = $1, qtd = $2, unidade = $3, preco = $4, atualizado_em = $5 WHERE id = $6 RETURNING *",
      v.nome, v.qtd, v.unidade, v.preco, mudouPreco ? now() : prev.atualizado_em, id);
    if (mudouPreco) await d.run("INSERT INTO insumo_historico (insumo_id, user_id, preco_anterior, preco, qtd, unidade, impacto_json, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      id, user.id, prev.preco, v.preco, v.qtd, v.unidade, JSON.stringify(impacto), now());
    return row;
  });
  return { insumo: insumoOut(atualizado), impacto, mudouPreco };
}

app.put("/api/insumos/:id", auth.exigirLogin, h(async (req, res) => {
  const v = validarInsumo(req.body);
  if (v.erro) return erro(res, 400, v.erro);
  const r = await atualizarInsumo(req.user, Number(req.params.id) || 0, v);
  if (r.erro) return erro(res, r.status, r.erro, r.code);
  res.json(r);
}));

app.delete("/api/insumos/:id", auth.exigirLogin, h(async (req, res) => {
  const id = Number(req.params.id) || 0;
  if (!(await get("SELECT 1 FROM insumos WHERE id = $1 AND user_id = $2", id, req.user.id))) return erro(res, 404, "Insumo não encontrado.");
  if ((await planos.bloqueados(req.user)).insumos.has(id)) return erro(res, 402, MSG_BLOQ_INSUMO, "item_bloqueado");
  const usadas = await receitasQueUsam(req.user.id, id);
  if (usadas.length) return erro(res, 409, `Não dá para excluir: usado em ${usadas.map((r) => r.nome).join(", ")}. Remova-o dessas fichas antes.`);
  await run("DELETE FROM insumos WHERE id = $1 AND user_id = $2", id, req.user.id);
  res.json({ ok: true });
}));

// Importa várias linhas "Nome, 1kg, 3,60". Atualiza os que já existem pelo nome.
app.post("/api/insumos/importar", auth.exigirLogin, h(async (req, res) => {
  const linhas = Array.isArray(req.body.linhas) ? req.body.linhas.slice(0, 500) : [];
  const out = { criados: 0, atualizados: 0, rejeitadas: [], limite: false };
  for (const linha of linhas) {
    const bruto = String(linha).trim();
    const p = Calc.parseLinha(linha);
    if (!p) { if (bruto) out.rejeitadas.push(bruto); continue; }
    const v = validarInsumo(p);
    if (v.erro) { out.rejeitadas.push(bruto); continue; }
    const ex = await nomeExiste(req.user.id, v.nome);
    if (ex) {
      const r = await atualizarInsumo(req.user, ex.id, v);
      if (r.erro) out.rejeitadas.push(`${bruto} (${r.code === "item_bloqueado" ? "bloqueado no plano Free" : r.erro})`); else out.atualizados++;
      continue;
    }
    if (await checarLimite(req.user, "insumos")) { out.limite = true; out.rejeitadas.push(bruto); continue; }
    await criarInsumo(req.user.id, v);
    out.criados++;
  }
  if (out.limite) out.mensagemLimite = msgLimite("insumos", planos.limites(req.user).insumos);
  res.json(out);
}));

/* ---------------- histórico (Pro) ---------------- */
function exigirPro(req, res, next) {
  if (!planos.limites(req.user).historico) return erro(res, 402, "O histórico de preços faz parte do plano Pro.", "limite");
  next();
}
app.get("/api/historico", auth.exigirLogin, exigirPro, h(async (req, res) => {
  const insumoId = Number(req.query.insumo) || 0;
  const rows = await all(
    `SELECT h.*, i.nome FROM insumo_historico h JOIN insumos i ON i.id = h.insumo_id
     WHERE h.user_id = $1 AND ($2 = 0 OR h.insumo_id = $2) ORDER BY h.data DESC, h.id DESC LIMIT 500`, req.user.id, insumoId);
  res.json({ historico: rows.map((x) => ({ id: x.id, insumoId: x.insumo_id, nome: x.nome, precoAnterior: x.preco_anterior, preco: x.preco, qtd: x.qtd, unidade: x.unidade, impacto: JSON.parse(x.impacto_json || "[]"), data: x.data })) });
}));

/* ---------------- receitas ---------------- */
async function validarReceita(user, body, itensAtuais = []) {
  const nome = txt(body.nome, 140);
  const rendimento = Calc.parseNum(body.rendimento), cmvAlvo = Calc.parseNum(body.cmvAlvo);
  const precoVenda = Calc.parseNum(body.precoVenda) || 0;
  if (!nome) return { erro: "Dê um nome para a receita." };
  if (!(rendimento > 0)) return { erro: "O rendimento precisa ser maior que zero." };
  if (!(cmvAlvo > 0 && cmvAlvo < 100)) return { erro: "O CMV alvo deve ficar entre 1% e 99%." };
  const ins = await mapaInsumos(user.id);
  const bloq = await planos.bloqueados(user);
  const jaNaFicha = new Set(itensAtuais.map((l) => l.insumoId));
  const itens = [];
  for (const l of Array.isArray(body.itens) ? body.itens.slice(0, 200) : []) {
    const insumoId = Number(l.insumoId), qtd = Calc.parseNum(l.qtd), fc = Calc.parseNum(l.fc) || 1;
    if (!insumoId) continue;
    const i = ins[insumoId];
    if (!i) return { erro: "Um dos insumos da ficha não existe mais." };
    if (bloq.insumos.has(insumoId) && !jaNaFicha.has(insumoId)) return { erro: `${i.nome} está bloqueado no plano Free e não pode ser adicionado a fichas. Renove o Pro para usar.` };
    if (!(qtd > 0)) return { erro: `Informe a quantidade de ${i.nome}.` };
    if (!Calc.UN[l.unidade] || Calc.UN[l.unidade].fam !== Calc.UN[i.unidade].fam) return { erro: `${i.nome}: unidade incompatível com a embalagem (${i.unidade}).` };
    if (!(fc >= 1 && fc <= 20)) return { erro: `${i.nome}: o fator de correção deve ficar entre 1 e 20.` };
    itens.push({ insumoId, qtd, unidade: l.unidade, fc });
  }
  if (!itens.length) return { erro: "Adicione ao menos um insumo." };
  return {
    nome, categoria: txt(body.categoria, 80), rendimento, unidadeRend: txt(body.unidadeRend, 40) || "porções",
    cmvAlvo, precoVenda, preparo: txt(body.preparo, 20000), itens,
  };
}

app.get("/api/receitas", auth.exigirLogin, h(async (req, res) => {
  const bloq = await planos.bloqueados(req.user);
  // Fichas bloqueadas aparecem só com nome e categoria; o conteúdo fica guardado e volta ao renovar.
  res.json({ receitas: (await all("SELECT * FROM receitas WHERE user_id = $1 ORDER BY lower(nome)", req.user.id)).map((r) =>
    bloq.receitas.has(r.id) ? { id: r.id, nome: r.nome, categoria: r.categoria, unidadeRend: r.unidade_rend, itens: [], bloqueado: true } : { ...receitaOut(r), bloqueado: false }) });
}));
app.get("/api/receitas/:id", auth.exigirLogin, h(async (req, res) => {
  const r = await get("SELECT * FROM receitas WHERE id = $1 AND user_id = $2", Number(req.params.id) || 0, req.user.id);
  if (!r) return erro(res, 404, "Ficha não encontrada.");
  if ((await planos.bloqueados(req.user)).receitas.has(r.id)) return erro(res, 402, MSG_BLOQ_FICHA, "item_bloqueado");
  res.json({ receita: receitaOut(r) });
}));
app.post("/api/receitas", auth.exigirLogin, h(async (req, res) => {
  const l = await checarLimite(req.user, "receitas");
  if (l) return erro(res, 402, msgLimite("receitas", l.lim), "limite");
  const v = await validarReceita(req.user, req.body);
  if (v.erro) return erro(res, 400, v.erro);
  const r = await get(`INSERT INTO receitas (user_id, nome, categoria, rendimento, unidade_rend, cmv_alvo, preco_venda, preparo, itens_json, criado_em, atualizado_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    req.user.id, v.nome, v.categoria, v.rendimento, v.unidadeRend, v.cmvAlvo, v.precoVenda, v.preparo, JSON.stringify(v.itens), now(), now());
  res.status(201).json({ receita: receitaOut(r) });
}));
app.put("/api/receitas/:id", auth.exigirLogin, h(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const atual = await get("SELECT * FROM receitas WHERE id = $1 AND user_id = $2", id, req.user.id);
  if (!atual) return erro(res, 404, "Ficha não encontrada.");
  if ((await planos.bloqueados(req.user)).receitas.has(id)) return erro(res, 402, MSG_BLOQ_FICHA, "item_bloqueado");
  const v = await validarReceita(req.user, req.body, receitaOut(atual).itens);
  if (v.erro) return erro(res, 400, v.erro);
  const r = await get(`UPDATE receitas SET nome=$1, categoria=$2, rendimento=$3, unidade_rend=$4, cmv_alvo=$5, preco_venda=$6, preparo=$7, itens_json=$8, atualizado_em=$9
    WHERE id=$10 AND user_id=$11 RETURNING *`,
    v.nome, v.categoria, v.rendimento, v.unidadeRend, v.cmvAlvo, v.precoVenda, v.preparo, JSON.stringify(v.itens), now(), id, req.user.id);
  res.json({ receita: receitaOut(r) });
}));
app.delete("/api/receitas/:id", auth.exigirLogin, h(async (req, res) => {
  if ((await planos.bloqueados(req.user)).receitas.has(Number(req.params.id) || 0)) return erro(res, 402, MSG_BLOQ_FICHA, "item_bloqueado");
  const r = await run("DELETE FROM receitas WHERE id = $1 AND user_id = $2", Number(req.params.id) || 0, req.user.id);
  if (!r.count) return erro(res, 404, "Ficha não encontrada.");
  res.json({ ok: true });
}));

/* ---------------- notificações ---------------- */
app.get("/api/notificacoes", auth.exigirLogin, h(async (req, res) => {
  res.json({ notificacoes: await all(`SELECT id, titulo, mensagem, tipo, lida, criado_em AS "criadoEm" FROM notificacoes WHERE user_id = $1 ORDER BY id DESC LIMIT 100`, req.user.id) });
}));
app.post("/api/notificacoes/lidas", auth.exigirLogin, h(async (req, res) => {
  await run("UPDATE notificacoes SET lida = TRUE WHERE user_id = $1 AND lida = FALSE", req.user.id);
  res.json({ ok: true });
}));

/* ---------------- assinatura ---------------- */
app.get("/api/assinatura", auth.exigirLogin, h(async (req, res) => {
  res.json({
    pagamentos: await all(`SELECT id, valor, status, provider, dias, criado_em AS "criadoEm", aprovado_em AS "aprovadoEm" FROM pagamentos WHERE user_id = $1 ORDER BY id DESC LIMIT 50`, req.user.id),
    suporteWhatsApp: notif.SUPORTE_WHATSAPP,
  });
}));

/* ---------------- tarefa diária (Vercel Cron) ---------------- */
// A Vercel chama esta rota uma vez por dia (vercel.json) com "Authorization: Bearer CRON_SECRET".
app.get("/api/cron/lembretes", h(async (req, res) => {
  const segredo = process.env.CRON_SECRET || "";
  const recebido = String(req.get("authorization") || "");
  const esperado = `Bearer ${segredo}`;
  if (!segredo || recebido.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado)))
    return erro(res, 401, "Não autorizado.");
  const enviados = await notif.rodarLembretes();
  // Limpeza de registros vencidos.
  await run("DELETE FROM sessions WHERE expira_em < $1", now());
  await run("DELETE FROM reset_tokens WHERE expira_em < $1", now());
  await run("DELETE FROM tentativas WHERE em < $1", Date.now() - 24 * 3600e3);
  res.json({ ok: true, enviados });
}));

/* ---------------- administração ---------------- */
const admin = express.Router();
admin.use(auth.exigirAdmin);
const logAdmin = (req, userId, acao, detalhe = "") =>
  run("INSERT INTO admin_log (admin_id, user_id, acao, detalhe, criado_em) VALUES ($1,$2,$3,$4,$5)", req.user.id, userId, acao, detalhe, now());

const SQL_USUARIOS = `SELECT u.id, u.nome, u.email, u.telefone, u.role, u.plano, u.pro_ate, u.status, u.motivo_bloqueio, u.criado_em, u.ultimo_acesso, u.oferta_usada,
  (SELECT COUNT(*) FROM insumos i WHERE i.user_id = u.id)::int AS n_insumos,
  (SELECT COUNT(*) FROM receitas r WHERE r.user_id = u.id)::int AS n_receitas,
  (SELECT COALESCE(SUM(valor),0) FROM pagamentos p WHERE p.user_id = u.id AND p.status IN ('aprovado','manual'))::float AS total_pago
  FROM users u`;
function adminUserOut(u) {
  const ativoPro = planos.proAtivo(u);
  return {
    id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, role: u.role, status: u.status, motivoBloqueio: u.motivo_bloqueio,
    plano: ativoPro ? "pro" : "free", vencido: u.plano === "pro" && !ativoPro, proAte: u.pro_ate, diasRestantes: planos.diasRestantes(u),
    criadoEm: u.criado_em, ultimoAcesso: u.ultimo_acesso, insumos: u.n_insumos, receitas: u.n_receitas, totalPago: u.total_pago,
    ofertaDisponivel: planos.ofertaDisponivel(u),
  };
}
async function filtrarUsuarios(filtro, dias = 7) {
  const lista = (await all(`${SQL_USUARIOS} WHERE u.role = 'user' ORDER BY u.criado_em DESC`)).map(adminUserOut);
  const d30 = Date.now() - 30 * 864e5;
  switch (filtro) {
    case "pro": return lista.filter((u) => u.plano === "pro");
    case "free": return lista.filter((u) => u.plano === "free");
    case "vencendo": return lista.filter((u) => u.plano === "pro" && u.diasRestantes <= dias);
    case "vencidos": return lista.filter((u) => u.vencido);
    case "bloqueados": return lista.filter((u) => u.status === "bloqueado");
    case "inativos": return lista.filter((u) => Date.parse(u.ultimoAcesso || 0) < d30);
    default: return lista;
  }
}

admin.get("/resumo", h(async (req, res) => {
  const us = await filtrarUsuarios("todos");
  const d7 = Date.now() - 7 * 864e5, d30 = Date.now() - 30 * 864e5;
  const pro = us.filter((u) => u.plano === "pro");
  const porDia = {};
  for (let i = 29; i >= 0; i--) porDia[new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)] = 0;
  us.forEach((u) => { const k = String(u.criadoEm).slice(0, 10); if (k in porDia) porDia[k]++; });
  const { v: receita30 } = await get("SELECT COALESCE(SUM(valor),0)::float AS v FROM pagamentos WHERE status IN ('aprovado','manual') AND COALESCE(aprovado_em, criado_em) > $1", new Date(d30).toISOString());
  res.json({
    total: us.length,
    pro: pro.length,
    free: us.length - pro.length,
    bloqueados: us.filter((u) => u.status === "bloqueado").length,
    ativos7: us.filter((u) => Date.parse(u.ultimoAcesso || 0) > d7).length,
    novos30: us.filter((u) => Date.parse(u.criadoEm) > d30).length,
    vencendo7: pro.filter((u) => u.diasRestantes <= 7).length,
    vencidos: us.filter((u) => u.vencido).length,
    mrr: pro.length * planos.PRECO_PRO,
    receita30,
    cadastrosPorDia: Object.entries(porDia).map(([dia, n]) => ({ dia, n })),
    preco: planos.PRECO_PRO,
    precoOferta: planos.PRECO_OFERTA,
    suporteWhatsApp: notif.SUPORTE_WHATSAPP,
    emailAtivo: notif.emailAtivo,
  });
}));

admin.get("/usuarios", h(async (req, res) => {
  const q = txt(req.query.q, 100).toLowerCase();
  let lista = await filtrarUsuarios(String(req.query.filtro || "todos"), Number(req.query.dias) || 7);
  if (q) lista = lista.filter((u) => `${u.nome} ${u.email} ${u.telefone}`.toLowerCase().includes(q));
  res.json({ usuarios: lista });
}));

admin.get("/usuarios/:id", h(async (req, res) => {
  const u = await get(`${SQL_USUARIOS} WHERE u.id = $1`, Number(req.params.id) || 0);
  if (!u) return erro(res, 404, "Usuário não encontrado.");
  res.json({
    usuario: adminUserOut(u),
    pagamentos: await all(`SELECT id, valor, status, provider, dias, criado_em AS "criadoEm", aprovado_em AS "aprovadoEm" FROM pagamentos WHERE user_id = $1 ORDER BY id DESC LIMIT 50`, u.id),
    notificacoes: await all(`SELECT id, titulo, tipo, lida, criado_em AS "criadoEm" FROM notificacoes WHERE user_id = $1 ORDER BY id DESC LIMIT 30`, u.id),
    log: await all(`SELECT acao, detalhe, criado_em AS "criadoEm" FROM admin_log WHERE user_id = $1 ORDER BY id DESC LIMIT 30`, u.id),
  });
}));

async function alvo(req, res) {
  const u = await get("SELECT * FROM users WHERE id = $1", Number(req.params.id) || 0);
  if (!u) { erro(res, 404, "Usuário não encontrado."); return null; }
  if (u.role === "admin") { erro(res, 400, "Não é possível alterar uma conta de administrador por aqui."); return null; }
  return u;
}

admin.post("/usuarios/:id/bloquear", h(async (req, res) => {
  const u = await alvo(req, res); if (!u) return;
  const motivo = txt(req.body.motivo, 200);
  await tx(async (d) => {
    await d.run("UPDATE users SET status = 'bloqueado', motivo_bloqueio = $1 WHERE id = $2", motivo || null, u.id);
    await d.run("DELETE FROM sessions WHERE user_id = $1", u.id);
  });
  await logAdmin(req, u.id, "bloqueio", motivo);
  res.json({ ok: true });
}));
admin.post("/usuarios/:id/liberar", h(async (req, res) => {
  const u = await alvo(req, res); if (!u) return;
  await run("UPDATE users SET status = 'ativo', motivo_bloqueio = NULL WHERE id = $1", u.id);
  await logAdmin(req, u.id, "liberação");
  await notif.notificar(u.id, "Conta liberada", "Seu acesso foi liberado. Bom trabalho na cozinha!", { tipo: "sistema" });
  res.json({ ok: true });
}));
admin.post("/usuarios/:id/pro", h(async (req, res) => {
  const u = await alvo(req, res); if (!u) return;
  let ate;
  if (req.body.ate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.ate))) return erro(res, 400, "Data inválida.");
    const d = new Date(`${req.body.ate}T23:59:59-03:00`); // fim do dia no horário de Brasília
    if (isNaN(d)) return erro(res, 400, "Data inválida.");
    ate = d.toISOString();
    await planos.definirProAte(u.id, ate);
  } else {
    const dias = Math.max(1, Math.min(3660, parseInt(req.body.dias, 10) || 30));
    // Primeira assinatura: os primeiros 30 dias saem pelo preço da oferta; o restante, pelo preço normal.
    const comOferta = planos.ofertaDisponivel(u);
    const meses = Math.max(1, Math.round(dias / 30));
    const valor = comOferta ? planos.PRECO_OFERTA + planos.PRECO_PRO * (meses - 1) : planos.PRECO_PRO * meses;
    ate = await planos.estenderPro(u.id, dias);
    if (req.body.registrarPagamento) await run("INSERT INTO pagamentos (user_id, valor, status, provider, dias, criado_em, aprovado_em) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      u.id, valor, "manual", comOferta ? "whatsapp-oferta" : "whatsapp", dias, now(), now());
  }
  await logAdmin(req, u.id, "pro", `até ${ate.slice(0, 10)}`);
  await notif.notificar(u.id, "Plano Pro ativo", `Seu plano Pro está ativo até ${new Date(ate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Insumos e fichas ilimitados e histórico de preços liberados.`, { tipo: "sistema", email: true });
  res.json({ ok: true, proAte: ate });
}));
admin.post("/usuarios/:id/free", h(async (req, res) => {
  const u = await alvo(req, res); if (!u) return;
  await planos.voltarFree(u.id);
  await logAdmin(req, u.id, "free");
  res.json({ ok: true });
}));
admin.post("/usuarios/:id/senha-temporaria", h(async (req, res) => {
  const u = await alvo(req, res); if (!u) return;
  const senha = crypto.randomBytes(6).toString("base64url");
  const hash = await auth.hashSenha(senha);
  await tx(async (d) => {
    await d.run("UPDATE users SET senha_hash = $1 WHERE id = $2", hash, u.id);
    await d.run("DELETE FROM sessions WHERE user_id = $1", u.id);
  });
  await logAdmin(req, u.id, "senha temporária");
  res.json({ senha });
}));

// Envia notificação para um usuário, uma lista de ids ou um filtro (ex.: vencendo em 7 dias).
admin.post("/notificar", h(async (req, res) => {
  const titulo = txt(req.body.titulo, 120), mensagem = txt(req.body.mensagem, 2000);
  if (!titulo || !mensagem) return erro(res, 400, "Preencha título e mensagem.");
  let alvos;
  if (Array.isArray(req.body.ids) && req.body.ids.length) {
    const ids = new Set(req.body.ids.map(Number));
    alvos = (await filtrarUsuarios("todos")).filter((u) => ids.has(u.id));
  } else {
    alvos = await filtrarUsuarios(String(req.body.filtro || "todos"), Number(req.body.dias) || 7);
  }
  let emails = 0;
  const whatsapp = [];
  for (const u of alvos) {
    if (await notif.notificar(u.id, titulo, mensagem, { tipo: req.body.tipo === "renovacao" ? "renovacao" : "admin", email: !!req.body.email })) emails++;
    whatsapp.push({ id: u.id, nome: u.nome, telefone: u.telefone, link: notif.linkWhatsApp(u.telefone, `Olá, ${u.nome.split(" ")[0]}! ${mensagem}`) });
  }
  await logAdmin(req, null, "notificação", `${titulo} → ${alvos.length} usuário(s)`);
  res.json({ enviadas: alvos.length, emails, whatsapp });
}));

admin.post("/lembretes/rodar", h(async (req, res) => { res.json({ enviados: await notif.rodarLembretes() }); }));

admin.get("/log", h(async (req, res) => {
  res.json({ log: await all(`SELECT l.acao, l.detalhe, l.criado_em AS "criadoEm", u.nome AS usuario FROM admin_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 200`) });
}));
app.use("/api/admin", admin);

app.use("/api", (req, res) => erro(res, 404, "Rota não encontrada."));

/* ---------------- páginas (no computador; na Vercel a pasta public/ é servida pela CDN) ---------------- */
const PUBLIC = path.join(__dirname, "public");
app.use(express.static(PUBLIC, {
  extensions: ["html"],
  // Mesmas regras de cache do vercel.json: páginas e código sempre revalidados, ícones, fotos e fontes guardados por 1 semana.
  setHeaders: (res, arquivo) => {
    if (["icons", "img", "fonts"].some((d) => arquivo.includes(`${path.sep}${d}${path.sep}`))) res.setHeader("Cache-Control", "public, max-age=604800");
    else if (/\.html$|sw\.js$/.test(arquivo)) res.setHeader("Cache-Control", "no-cache");
    else res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  },
}));
const pagina = (arquivo) => (req, res) => res.sendFile(path.join(PUBLIC, arquivo), (e) => { if (e && !res.headersSent) erro(res, 404, "Página não encontrada."); });
app.get("/admin", pagina("admin.html"));
app.get("*", pagina("index.html"));

app.use((err, req, res, _next) => {
  console.error(err);
  if (err.type === "entity.parse.failed") return erro(res, 400, "Dados inválidos.");
  erro(res, 500, "Algo deu errado do nosso lado. Tente de novo em instantes.");
});

/* ---------------- execução local ---------------- */
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  iniciar().then(() => {
    app.listen(port, () => {
      console.log(`${notif.APP_NAME} rodando em http://localhost:${port}  (painel: /admin)`);
      console.log(`Banco: ${require("./lib/db").usandoPGlite() ? "PGlite local (./data/pg)" : "Postgres (DATABASE_URL)"} · E-mail: ${notif.emailAtivo ? "ativo" : "desativado"}`);
    });
  }).catch((e) => { console.error("Falha ao iniciar o banco:", e); process.exit(1); });
}

module.exports = app;
module.exports.iniciar = iniciar;
