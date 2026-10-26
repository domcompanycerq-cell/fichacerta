"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../public/calc");

test("parseNum entende números no formato brasileiro", () => {
  assert.equal(C.parseNum("1.000"), 1000, "milhar com ponto");
  assert.equal(C.parseNum("12.500"), 12500);
  assert.equal(C.parseNum("1.234,56"), 1234.56);
  assert.equal(C.parseNum("3,60"), 3.6);
  assert.equal(C.parseNum("R$ 3,60"), 3.6);
  assert.equal(C.parseNum("1000"), 1000);
  assert.equal(C.parseNum("3.6"), 3.6, "decimal com ponto continua valendo");
  assert.equal(C.parseNum("0.5"), 0.5);
});

test("custo da ficha: 1 kg de arroz a R$ 3,60 + cebola com perda", () => {
  const ins = { 1: { id: 1, qtd: 1, unidade: "kg", preco: 3.6 }, 2: { id: 2, qtd: 1, unidade: "kg", preco: 5.99 } };
  const c = C.calcRecipe({ rendimento: 10, cmvAlvo: 30, itens: [{ insumoId: 1, qtd: C.parseNum("1.000"), unidade: "g", fc: 1 }, { insumoId: 2, qtd: 80, unidade: "g", fc: 1.15 }] }, ins);
  assert.ok(Math.abs(c.total - (3.6 + 0.092 * 5.99)) < 1e-9);
  assert.ok(Math.abs(c.sugerido - c.porcao / 0.3) < 1e-9);
});
