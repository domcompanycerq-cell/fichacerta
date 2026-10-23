// Cálculo de custo das fichas técnicas. Usado pelo navegador (window.Calc) e pelo servidor (require).
(function (root) {
  "use strict";

  const UN = {
    kg: { fam: "massa", x: 1000 }, g: { fam: "massa", x: 1 },
    L: { fam: "volume", x: 1000 }, ml: { fam: "volume", x: 1 },
    un: { fam: "unidade", x: 1 }, dz: { fam: "unidade", x: 12 },
  };
  const FAM_UNITS = { massa: ["g", "kg"], volume: ["ml", "L"], unidade: ["un", "dz"] };
  const BASE_LABEL = { massa: "kg", volume: "L", unidade: "un" };
  const BASE_MULT = { massa: 1000, volume: 1000, unidade: 1 };

  function parseNum(s) {
    if (typeof s === "number") return s;
    s = String(s == null ? "" : s).replace(/r\$/i, "").replace(/\s/g, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  // Preço por unidade base (g, ml ou un).
  function costPerBase(ins) {
    const u = UN[ins.unidade];
    if (!u || !(ins.qtd > 0)) return NaN;
    return ins.preco / (ins.qtd * u.x);
  }

  // Preço por kg, L ou un, para exibição.
  function pricePerDisplayUnit(ins) {
    const u = UN[ins.unidade];
    if (!u) return NaN;
    return costPerBase(ins) * BASE_MULT[u.fam];
  }

  function lineCost(line, ins) {
    if (!ins) return { cost: 0, err: "Insumo removido" };
    const lu = UN[line.unidade], iu = UN[ins.unidade];
    if (!lu || !iu) return { cost: 0, err: "Unidade inválida" };
    if (lu.fam !== iu.fam) return { cost: 0, err: "Unidade incompatível" };
    const q = (+line.qtd || 0) * lu.x * ((+line.fc) || 1);
    return { cost: q * costPerBase(ins), err: null };
  }

  // rec: { itens:[{insumoId,qtd,unidade,fc}], rendimento, cmvAlvo, precoVenda }
  // insMap: { [id]: {id,nome,qtd,unidade,preco} }
  function calcRecipe(rec, insMap) {
    let total = 0, errs = 0;
    const lines = (rec.itens || []).map((l) => {
      const ins = insMap[l.insumoId];
      const r = lineCost(l, ins);
      if (r.err) errs++;
      total += r.cost || 0;
      return Object.assign({}, l, { ins, cost: r.cost, err: r.err });
    });
    const rend = +rec.rendimento > 0 ? +rec.rendimento : 1;
    const porcao = total / rend;
    const cmv = (+rec.cmvAlvo > 0 ? +rec.cmvAlvo : 30) / 100;
    const venda = +rec.precoVenda || 0;
    return { lines, total, porcao, sugerido: porcao / cmv, cmvReal: venda > 0 ? porcao / venda : NaN, venda, errs, rend };
  }

  // "Arroz, 1kg, R$3,60" -> {nome, qtd, unidade, preco}
  function parseLinha(line) {
    const m = String(line).trim().match(/^(.+?)\s*[,;\t]\s*([\d.,]+)\s*(kg|g|l|ml|un|und|unid|dz)\.?\s*[,;\t]?\s*(?:r\$)?\s*([\d.,]+)\s*$/i);
    if (!m) return null;
    let u = m[3].toLowerCase();
    if (u.startsWith("un")) u = "un";
    if (u === "l") u = "L";
    const qtd = parseNum(m[2]), preco = parseNum(m[4]);
    if (!(qtd > 0) || !(preco >= 0)) return null;
    return { nome: m[1].trim(), qtd, unidade: u, preco };
  }

  const api = { UN, FAM_UNITS, BASE_LABEL, BASE_MULT, parseNum, costPerBase, pricePerDisplayUnit, lineCost, calcRecipe, parseLinha };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== "undefined" ? self : this);
