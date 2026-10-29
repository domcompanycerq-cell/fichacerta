"use strict";
const { get, all, run } = require("./db");

const PRECO_PRO = Number(process.env.PRO_PRICE || 25);
// Oferta de boas-vindas: primeiros 30 dias do Pro por um valor menor, só para quem nunca foi Pro.
const PRECO_OFERTA = Number(process.env.PRO_PRICE_OFERTA || 10);
const DIAS_OFERTA = 30;
const ofertaDisponivel = (user) => !user.oferta_usada && !user.pro_ate && user.plano !== "pro";
const LIMITES = {
  free: { insumos: 10, receitas: 2, historico: false },
  pro: { insumos: Infinity, receitas: Infinity, historico: true },
};

function proAtivo(user) {
  return user.plano === "pro" && !!user.pro_ate && Date.parse(user.pro_ate) > Date.now();
}
function planoEfetivo(user) { return proAtivo(user) ? "pro" : "free"; }
function limites(user) { return LIMITES[planoEfetivo(user)]; }

async function uso(userId) {
  const r = await get(
    `SELECT (SELECT COUNT(*) FROM insumos WHERE user_id = $1)::int AS insumos,
            (SELECT COUNT(*) FROM receitas WHERE user_id = $1)::int AS receitas`, userId);
  return { insumos: r.insumos, receitas: r.receitas };
}

// Itens bloqueados: quando a conta está no Free com mais itens do que o limite (ex.: o Pro venceu),
// ficam liberados os mais antigos até o limite e o restante fica bloqueado. Nada é apagado:
// ao renovar o Pro, tudo volta a ficar liberado. Se o usuário excluir um item liberado, o próximo bloqueado é liberado.
async function bloqueados(user) {
  const lim = limites(user);
  const out = { insumos: new Set(), receitas: new Set() };
  if (isFinite(lim.insumos)) (await all("SELECT id FROM insumos WHERE user_id = $1 ORDER BY id OFFSET $2", user.id, lim.insumos)).forEach((r) => out.insumos.add(r.id));
  if (isFinite(lim.receitas)) (await all("SELECT id FROM receitas WHERE user_id = $1 ORDER BY id OFFSET $2", user.id, lim.receitas)).forEach((r) => out.receitas.add(r.id));
  return out;
}

function diasRestantes(user) {
  if (!user.pro_ate) return null;
  return Math.ceil((Date.parse(user.pro_ate) - Date.now()) / 864e5);
}

// Novo vencimento ao somar dias: a partir do fim do período atual (ou de hoje, se já venceu).
function novoVencimento(user, dias) {
  const base = user && user.pro_ate && Date.parse(user.pro_ate) > Date.now() ? Date.parse(user.pro_ate) : Date.now();
  return new Date(base + dias * 864e5).toISOString();
}
// Valor de uma liberação: na primeira assinatura os primeiros 30 dias saem pelo preço da oferta; o restante, pelo preço normal.
function valorLiberacao(user, dias) {
  const comOferta = ofertaDisponivel(user);
  const meses = Math.max(1, Math.round(dias / 30));
  return { comOferta, valor: comOferta ? PRECO_OFERTA + PRECO_PRO * (meses - 1) : PRECO_PRO * meses };
}

async function estenderPro(userId, dias) {
  const u = await get("SELECT pro_ate FROM users WHERE id = $1", userId);
  const ate = novoVencimento(u, dias);
  await run("UPDATE users SET plano = 'pro', pro_ate = $1, oferta_usada = TRUE WHERE id = $2", ate, userId);
  // Novo ciclo: libera os lembretes do próximo vencimento.
  await run("DELETE FROM lembretes WHERE user_id = $1 AND ref <> $2", userId, ate.slice(0, 10));
  return ate;
}
async function definirProAte(userId, ateISO) {
  await run("UPDATE users SET plano = 'pro', pro_ate = $1, oferta_usada = TRUE WHERE id = $2", ateISO, userId);
  await run("DELETE FROM lembretes WHERE user_id = $1 AND ref <> $2", userId, ateISO.slice(0, 10));
}
async function voltarFree(userId) {
  await run("UPDATE users SET plano = 'free', pro_ate = NULL WHERE id = $1", userId);
}

function resumoPlano(user) {
  const p = planoEfetivo(user);
  const l = LIMITES[p];
  return {
    plano: p,
    proAte: user.pro_ate,
    diasRestantes: p === "pro" ? diasRestantes(user) : null,
    vencido: user.plano === "pro" && !proAtivo(user),
    limites: { insumos: isFinite(l.insumos) ? l.insumos : null, receitas: isFinite(l.receitas) ? l.receitas : null, historico: l.historico },
    preco: PRECO_PRO,
    oferta: { disponivel: ofertaDisponivel(user), preco: PRECO_OFERTA, dias: DIAS_OFERTA },
  };
}

module.exports = { PRECO_PRO, PRECO_OFERTA, DIAS_OFERTA, ofertaDisponivel, LIMITES, proAtivo, planoEfetivo, limites, uso, bloqueados, diasRestantes, novoVencimento, valorLiberacao, estenderPro, definirProAte, voltarFree, resumoPlano };
