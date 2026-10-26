"use strict";
// Por padrão usa Postgres embutido em memória. Para testar contra um Postgres real: TEST_DATABASE_URL=postgres://...
delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else process.env.PGLITE_DIR = "memory";
process.env.CRON_SECRET = "segredo-de-teste";
process.env.ADMIN_EMAIL = "admin@teste.com";
process.env.ADMIN_PASSWORD = "admin-senha-123";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../server");
const { run, fechar } = require("../lib/db");
const { rodarLembretes } = require("../lib/notificacoes");

let server, base;
before(async () => {
  await app.iniciar();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await fechar(); });

// Cliente com cookie de sessão próprio.
let ipSeq = 1;
function cliente() {
  let cookie = "";
  const ip = `10.0.0.${ipSeq++}`; // cada cliente simula uma rede diferente (o limite de cadastros é por IP)
  const fn = async (method, url, body, extra = {}) => {
    const r = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", "X-Forwarded-For": ip, ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) };
  };
  fn.cookie = () => cookie;
  return fn;
}
const novoUsuario = async (email) => {
  const c = cliente();
  const r = await c("POST", "/api/auth/cadastro", { nome: "Maria Souza", telefone: "(15) 99876-5432", email, senha: "senha-forte-1" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { c, id: r.body.user.id };
};

test("cadastro valida campos e começa no Free", async () => {
  const c = cliente();
  assert.equal((await c("POST", "/api/auth/cadastro", { nome: "A", telefone: "1599", email: "x", senha: "1" })).status, 400);
  assert.equal((await c("POST", "/api/auth/cadastro", { nome: "Ana", telefone: "15998765432", email: "ana@x.com", senha: "curta" })).status, 400);
  const r = await c("POST", "/api/auth/cadastro", { nome: "Ana Lima", telefone: "15998765432", email: "ana@x.com", senha: "senha-forte-1" });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.plano, "free");
  assert.deepEqual(r.body.user.limites, { insumos: 10, receitas: 2, historico: false });
  assert.equal((await c("POST", "/api/auth/cadastro", { nome: "Ana", telefone: "15998765432", email: "ANA@x.com", senha: "senha-forte-1" })).status, 409);
  // dados persistem: novo login enxerga a mesma conta
  const c2 = cliente();
  assert.equal((await c2("POST", "/api/auth/login", { email: "ana@x.com", senha: "errada-123" })).status, 401);
  const l = await c2("POST", "/api/auth/login", { email: "ana@x.com", senha: "senha-forte-1" });
  assert.equal(l.status, 200);
  assert.equal(l.body.user.nome, "Ana Lima");
});

test("escrita sem cabeçalho do app é recusada (CSRF)", async () => {
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403);
});

test("limites do Free, recálculo e liberação do Pro", async () => {
  const { c, id } = await novoUsuario("free@x.com");
  const arroz = (await c("POST", "/api/insumos", { nome: "Arroz", qtd: "1", unidade: "kg", preco: "3,60" })).body.insumo;
  assert.equal(arroz.preco, 3.6);
  for (let i = 2; i <= 10; i++) assert.equal((await c("POST", "/api/insumos", { nome: `Item ${i}`, qtd: 1, unidade: "kg", preco: 1 })).status, 201);
  const onze = await c("POST", "/api/insumos", { nome: "Item 11", qtd: 1, unidade: "kg", preco: 1 });
  assert.equal(onze.status, 402);
  assert.equal(onze.body.code, "limite");

  const ficha = { nome: "Arroz branco", rendimento: 10, cmvAlvo: 30, itens: [{ insumoId: arroz.id, qtd: 200, unidade: "g", fc: 1 }] };
  const r1 = await c("POST", "/api/receitas", ficha);
  assert.equal(r1.status, 201);
  assert.equal((await c("POST", "/api/receitas", { ...ficha, nome: "Segunda" })).status, 201);
  assert.equal((await c("POST", "/api/receitas", { ...ficha, nome: "Terceira" })).status, 402);
  // unidade incompatível
  assert.equal((await c("PUT", `/api/receitas/${r1.body.receita.id}`, { ...ficha, itens: [{ insumoId: arroz.id, qtd: 1, unidade: "ml" }] })).status, 400);

  // mudança de preço recalcula: 200 g de 1 kg a R$3,60 = R$0,72 → a R$5,00 = R$1,00 (por porção: /10)
  const up = await c("PUT", `/api/insumos/${arroz.id}`, { nome: "Arroz", qtd: 1, unidade: "kg", preco: "5,00" });
  assert.equal(up.status, 200);
  assert.equal(up.body.mudouPreco, true);
  assert.equal(up.body.impacto.length, 2);
  assert.ok(Math.abs(up.body.impacto[0].antes - 0.072) < 1e-9);
  assert.ok(Math.abs(up.body.impacto[0].depois - 0.1) < 1e-9);
  // não exclui insumo em uso; não troca para unidade de outro tipo
  assert.equal((await c("DELETE", `/api/insumos/${arroz.id}`)).status, 409);
  assert.equal((await c("PUT", `/api/insumos/${arroz.id}`, { nome: "Arroz", qtd: 1, unidade: "L", preco: 5 })).status, 409);

  assert.equal((await c("GET", "/api/historico")).status, 402);

  // admin libera Pro
  const a = cliente();
  assert.equal((await a("POST", "/api/auth/login", { email: "admin@teste.com", senha: "admin-senha-123" })).status, 200);
  const pro = await a("POST", `/api/admin/usuarios/${id}/pro`, { dias: 30, registrarPagamento: true });
  assert.equal(pro.status, 200);
  const me = (await c("GET", "/api/me")).body.user;
  assert.equal(me.plano, "pro");
  assert.equal(me.limites.insumos, null);
  assert.ok(me.naoLidas >= 1);
  assert.equal((await c("POST", "/api/insumos", { nome: "Item 11", qtd: 1, unidade: "kg", preco: 1 })).status, 201);
  assert.equal((await c("POST", "/api/receitas", { ...ficha, nome: "Terceira" })).status, 201);
  const h = await c("GET", "/api/historico");
  assert.equal(h.status, 200);
  const mud = h.body.historico.find((x) => x.nome === "Arroz" && x.precoAnterior === 3.6);
  assert.ok(mud, "histórico registra a mudança feita ainda no Free");
  assert.equal(mud.impacto.length, 2);

  // vencimento: volta a ser Free, dados permanecem
  await run("UPDATE users SET pro_ate = $1 WHERE id = $2", new Date(Date.now() - 864e5).toISOString(), id);
  const venc = (await c("GET", "/api/me")).body.user;
  assert.equal(venc.plano, "free");
  assert.equal(venc.vencido, true);
  assert.equal(venc.uso.insumos, 11);
  assert.equal((await c("GET", "/api/historico")).status, 402);
  assert.equal((await c("POST", "/api/insumos", { nome: "Item 12", qtd: 1, unidade: "kg", preco: 1 })).status, 402);
  // edição de preço de item existente continua permitida
  assert.equal((await c("PUT", `/api/insumos/${arroz.id}`, { nome: "Arroz", qtd: 1, unidade: "kg", preco: 5.5 })).status, 200);
});

test("bloqueio e liberação pelo painel", async () => {
  const { c, id } = await novoUsuario("bloq@x.com");
  const a = cliente();
  await a("POST", "/api/auth/login", { email: "admin@teste.com", senha: "admin-senha-123" });
  assert.equal((await c("GET", "/api/admin/resumo")).status, 403, "usuário comum não acessa o painel");
  assert.equal((await a("POST", `/api/admin/usuarios/${id}/bloquear`, { motivo: "Pagamento em aberto" })).status, 200);
  assert.equal((await c("GET", "/api/insumos")).status, 401, "sessões encerradas");
  const l = await cliente()("POST", "/api/auth/login", { email: "bloq@x.com", senha: "senha-forte-1" });
  assert.equal(l.status, 403);
  assert.match(l.body.erro, /Pagamento em aberto/);
  assert.equal((await a("POST", `/api/admin/usuarios/${id}/liberar`)).status, 200);
  assert.equal((await cliente()("POST", "/api/auth/login", { email: "bloq@x.com", senha: "senha-forte-1" })).status, 200);
  const resumo = (await a("GET", "/api/admin/resumo")).body;
  assert.ok(resumo.total >= 3);
  assert.equal(resumo.cadastrosPorDia.length, 30);
});

test("usuários não enxergam dados uns dos outros", async () => {
  const A = await novoUsuario("a@x.com"), B = await novoUsuario("b@x.com");
  const ins = (await A.c("POST", "/api/insumos", { nome: "Sal", qtd: 1, unidade: "kg", preco: 2 })).body.insumo;
  assert.equal((await B.c("GET", "/api/insumos")).body.insumos.length, 0);
  assert.equal((await B.c("PUT", `/api/insumos/${ins.id}`, { nome: "X", qtd: 1, unidade: "kg", preco: 0 })).status, 404);
  assert.equal((await B.c("DELETE", `/api/insumos/${ins.id}`)).status, 404);
  assert.equal((await B.c("POST", "/api/receitas", { nome: "Roubo", rendimento: 1, cmvAlvo: 30, itens: [{ insumoId: ins.id, qtd: 1, unidade: "g" }] })).status, 400);
});

test("importação por lista respeita o limite do Free", async () => {
  const { c } = await novoUsuario("imp@x.com");
  const linhas = Array.from({ length: 12 }, (_, i) => `Item ${i + 1}, 1kg, R$${i + 1},50`);
  linhas.push("linha sem formato");
  const r = await c("POST", "/api/insumos/importar", { linhas });
  assert.equal(r.body.criados, 10);
  assert.equal(r.body.limite, true);
  assert.equal(r.body.rejeitadas.length, 3);
});

test("lembretes de renovação saem uma vez por ciclo", async () => {
  const { c, id } = await novoUsuario("renova@x.com");
  await run("UPDATE users SET plano = 'pro', pro_ate = $1 WHERE id = $2", new Date(Date.now() + 3 * 864e5).toISOString(), id);
  assert.ok((await rodarLembretes()) >= 1);
  const antes = (await c("GET", "/api/notificacoes")).body.notificacoes.filter((n) => n.tipo === "renovacao").length;
  await rodarLembretes();
  const depois = (await c("GET", "/api/notificacoes")).body.notificacoes.filter((n) => n.tipo === "renovacao").length;
  assert.equal(antes, 1);
  assert.equal(depois, 1);
});

test("sem pagamento online: rotas removidas e WhatsApp do suporte exposto", async () => {
  // usa uma conta existente: o limite de 10 cadastros por hora por rede já foi atingido nos testes acima
  const c = cliente();
  assert.equal((await c("POST", "/api/auth/login", { email: "ana@x.com", senha: "senha-forte-1" })).status, 200);
  assert.equal((await c("POST", "/api/assinatura/checkout")).status, 404);
  assert.equal((await c("POST", "/api/webhooks/mercadopago", { type: "payment", data: { id: 1 } })).status, 404);
  const cfg = await cliente()("GET", "/api/config");
  assert.equal(cfg.body.suporteWhatsApp, "5515988305442");
  assert.equal((await c("GET", "/api/me")).body.suporteWhatsApp, "5515988305442");
});

test("cron diário exige o segredo e envia lembretes", async () => {
  const sem = await fetch(base + "/api/cron/lembretes");
  assert.equal(sem.status, 401);
  const errado = await fetch(base + "/api/cron/lembretes", { headers: { Authorization: "Bearer outro" } });
  assert.equal(errado.status, 401);
  const ok = await fetch(base + "/api/cron/lembretes", { headers: { Authorization: "Bearer segredo-de-teste" } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
  const hc = await fetch(base + "/api/health");
  assert.equal(hc.status, 200);
});

test("Pro vencido: itens além do Free ficam bloqueados, nunca apagados", async () => {
  const { c, id } = await novoUsuario("bloqueio-plano@x.com");
  const a = cliente();
  await a("POST", "/api/auth/login", { email: "admin@teste.com", senha: "admin-senha-123" });
  await a("POST", `/api/admin/usuarios/${id}/pro`, { dias: 30 });
  const ids = [];
  for (let i = 1; i <= 12; i++) ids.push((await c("POST", "/api/insumos", { nome: `Insumo ${i}`, qtd: 1, unidade: "kg", preco: i })).body.insumo.id);
  const ficha = (n, insumoId) => ({ nome: n, rendimento: 1, cmvAlvo: 30, itens: [{ insumoId, qtd: 100, unidade: "g" }] });
  const f1 = (await c("POST", "/api/receitas", ficha("F1", ids[0]))).body.receita;
  await c("POST", "/api/receitas", ficha("F2", ids[1]));
  const f3 = (await c("POST", "/api/receitas", ficha("F3", ids[11]))).body.receita;

  // vence o Pro
  await run("UPDATE users SET pro_ate = $1 WHERE id = $2", new Date(Date.now() - 864e5).toISOString(), id);
  const me = (await c("GET", "/api/me")).body.user;
  assert.deepEqual(me.bloqueados, { insumos: 2, receitas: 1 });
  const lista = (await c("GET", "/api/insumos")).body.insumos;
  assert.equal(lista.length, 12, "nada foi apagado");
  assert.deepEqual(lista.filter((i) => i.bloqueado).map((i) => i.id).sort(), [ids[10], ids[11]].sort(), "bloqueia os mais novos");
  // insumo bloqueado: não edita, não exclui
  const ed = await c("PUT", `/api/insumos/${ids[11]}`, { nome: "X", qtd: 1, unidade: "kg", preco: 99 });
  assert.equal(ed.status, 402); assert.equal(ed.body.code, "item_bloqueado");
  assert.equal((await c("DELETE", `/api/insumos/${ids[10]}`)).body.code, "item_bloqueado");
  // insumo liberado continua editável
  assert.equal((await c("PUT", `/api/insumos/${ids[0]}`, { nome: "Insumo 1", qtd: 1, unidade: "kg", preco: 2 })).status, 200);
  // fichas: a mais nova fica bloqueada e sem conteúdo exposto
  const rec = (await c("GET", "/api/receitas")).body.receitas;
  assert.equal(rec.length, 3);
  const r3 = rec.find((r) => r.id === f3.id);
  assert.equal(r3.bloqueado, true); assert.deepEqual(r3.itens, []);
  assert.equal((await c("GET", `/api/receitas/${f3.id}`)).body.code, "item_bloqueado");
  assert.equal((await c("PUT", `/api/receitas/${f3.id}`, ficha("F3b", ids[0]))).body.code, "item_bloqueado");
  assert.equal((await c("DELETE", `/api/receitas/${f3.id}`)).body.code, "item_bloqueado");
  // ficha liberada não pode receber insumo bloqueado novo
  assert.equal((await c("PUT", `/api/receitas/${f1.id}`, ficha("F1", ids[10]))).status, 400);
  // renovou: tudo volta
  await a("POST", `/api/admin/usuarios/${id}/pro`, { dias: 30 });
  const me2 = (await c("GET", "/api/me")).body.user;
  assert.deepEqual(me2.bloqueados, { insumos: 0, receitas: 0 });
  const r3b = (await c("GET", `/api/receitas/${f3.id}`)).body.receita;
  assert.equal(r3b.itens.length, 1, "conteúdo da ficha preservado");
});

test("segurança: cookie, cache, origem e troca de senha", async () => {
  const c1 = cliente();
  const r = await c1("POST", "/api/auth/cadastro", { nome: "Sec", telefone: "15998765432", email: "sec@x.com", senha: "senha-forte-1" });
  const sc = r.headers.get("set-cookie");
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/); assert.match(sc, /Path=\//);
  assert.equal((await c1("GET", "/api/me")).headers.get("cache-control"), "no-store");
  // escrita vinda de outro site
  assert.equal((await c1("PUT", "/api/me", { nome: "X", telefone: "15998765432" }, { Origin: "https://site-malicioso.com" })).status, 403);
  // segunda sessão é encerrada ao trocar a senha
  const c2 = cliente();
  assert.equal((await c2("POST", "/api/auth/login", { email: "sec@x.com", senha: "senha-forte-1" })).status, 200);
  assert.equal((await c1("PUT", "/api/me/senha", { atual: "senha-forte-1", nova: "senha-nova-22" })).status, 200);
  assert.equal((await c1("GET", "/api/me")).status, 200, "sessão atual continua");
  assert.equal((await c2("GET", "/api/me")).status, 401, "outra sessão encerrada");
  // cabeçalhos de segurança
  const h = (await c1("GET", "/api/config")).headers;
  assert.match(h.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(h.get("x-frame-options"), "DENY");
});

test("oferta: primeiro mês do Pro por R$ 10, só na primeira assinatura", async () => {
  const { c, id } = await novoUsuario("oferta@x.com");
  const cfg = (await cliente()("GET", "/api/config")).body;
  assert.equal(cfg.precoOferta, 10);
  assert.deepEqual((await c("GET", "/api/me")).body.user.oferta, { disponivel: true, preco: 10, dias: 30 });
  const a = cliente();
  await a("POST", "/api/auth/login", { email: "admin@teste.com", senha: "admin-senha-123" });
  const det0 = (await a("GET", `/api/admin/usuarios/${id}`)).body;
  assert.equal(det0.usuario.ofertaDisponivel, true);
  await a("POST", `/api/admin/usuarios/${id}/pro`, { dias: 30, registrarPagamento: true });
  assert.equal((await c("GET", "/api/me")).body.user.oferta.disponivel, false);
  // vence e renova: preço normal
  await run("UPDATE users SET pro_ate = $1 WHERE id = $2", new Date(Date.now() - 864e5).toISOString(), id);
  assert.equal((await c("GET", "/api/me")).body.user.oferta.disponivel, false, "oferta não volta após vencer");
  await a("POST", `/api/admin/usuarios/${id}/pro`, { dias: 30, registrarPagamento: true });
  const pags = (await c("GET", "/api/assinatura")).body.pagamentos.map((p) => p.valor).sort((x, y) => x - y);
  assert.deepEqual(pags, [10, 25]);
  // primeira assinatura de 90 dias: R$ 10 + 2 × R$ 25
  const u2 = await novoUsuario("oferta90@x.com");
  await a("POST", `/api/admin/usuarios/${u2.id}/pro`, { dias: 90, registrarPagamento: true });
  assert.deepEqual((await u2.c("GET", "/api/assinatura")).body.pagamentos.map((p) => p.valor), [60]);
});
