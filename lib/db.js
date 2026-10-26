"use strict";
// Banco Postgres. Em produção (Vercel) usa DATABASE_URL (Neon, Supabase ou qualquer Postgres).
// Sem DATABASE_URL, usa o PGlite (Postgres embutido) gravando em ./data/pg — só para rodar no computador e nos testes.
const path = require("node:path");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,                 -- sempre em minúsculas
  telefone TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- user | admin
  plano TEXT NOT NULL DEFAULT 'free',         -- free | pro
  pro_ate TEXT,                               -- ISO (UTC): fim do período pago
  status TEXT NOT NULL DEFAULT 'ativo',       -- ativo | bloqueado
  motivo_bloqueio TEXT,
  criado_em TEXT NOT NULL,
  ultimo_acesso TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  criado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expira_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS insumos (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  qtd DOUBLE PRECISION NOT NULL,
  unidade TEXT NOT NULL,
  preco DOUBLE PRECISION NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_insumos_user ON insumos(user_id);

-- Toda alteração de preço é gravada, mesmo no plano Free (só o Pro enxerga).
CREATE TABLE IF NOT EXISTS insumo_historico (
  id SERIAL PRIMARY KEY,
  insumo_id INTEGER NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preco_anterior DOUBLE PRECISION,
  preco DOUBLE PRECISION NOT NULL,
  qtd DOUBLE PRECISION NOT NULL,
  unidade TEXT NOT NULL,
  impacto_json TEXT NOT NULL DEFAULT '[]',
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hist_user ON insumo_historico(user_id, data);

CREATE TABLE IF NOT EXISTS receitas (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT '',
  rendimento DOUBLE PRECISION NOT NULL DEFAULT 1,
  unidade_rend TEXT NOT NULL DEFAULT 'porções',
  cmv_alvo DOUBLE PRECISION NOT NULL DEFAULT 30,
  preco_venda DOUBLE PRECISION NOT NULL DEFAULT 0,
  preparo TEXT NOT NULL DEFAULT '',
  itens_json TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receitas_user ON receitas(user_id);

CREATE TABLE IF NOT EXISTS notificacoes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'admin',          -- admin | renovacao | sistema
  lida BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notificacoes(user_id, lida);

-- Evita mandar o mesmo lembrete automático duas vezes no mesmo ciclo.
CREATE TABLE IF NOT EXISTS lembretes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  ref TEXT NOT NULL,
  enviado_em TEXT NOT NULL,
  PRIMARY KEY (user_id, tipo, ref)
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  valor DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,                         -- manual (confirmado pelo admin)
  provider TEXT NOT NULL,                       -- whatsapp
  dias INTEGER NOT NULL DEFAULT 30,
  criado_em TEXT NOT NULL,
  aprovado_em TEXT
);

CREATE TABLE IF NOT EXISTS admin_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER,
  user_id INTEGER,
  acao TEXT NOT NULL,
  detalhe TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL
);

-- Oferta do primeiro mês: marcada quando o usuário recebe o Pro pela primeira vez.
ALTER TABLE users ADD COLUMN IF NOT EXISTS oferta_usada BOOLEAN NOT NULL DEFAULT FALSE;

-- Limite de tentativas (login, cadastro) compartilhado entre as instâncias serverless.
CREATE TABLE IF NOT EXISTS tentativas (
  chave TEXT NOT NULL,
  em BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tentativas ON tentativas(chave, em);
`;

const now = () => new Date().toISOString();

// Cada driver é adaptado para a mesma interface: query(texto, parâmetros) -> { rows, count }.
function driverPostgres(url) {
  const postgres = require("postgres");
  const sql = postgres(url, {
    max: Number(process.env.DB_POOL_MAX || 5),
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // compatível com poolers (Neon pooled, Supabase pgbouncer)
    onnotice: () => {},
  });
  const wrap = (s) => ({
    async query(text, params = []) { const r = await s.unsafe(text, params); return { rows: r, count: r.count }; },
  });
  return {
    ...wrap(sql),
    // executa um comando por vez (o protocolo com parâmetros não aceita vários juntos)
    exec: async (text) => { for (const st of text.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await sql.unsafe(st); },
    tx: (fn) => sql.begin((t) => fn(wrap(t))),
    end: () => sql.end({ timeout: 5 }),
  };
}
function driverPGlite(dir) {
  const { PGlite } = require("@electric-sql/pglite");
  if (dir !== "memory") require("node:fs").mkdirSync(path.dirname(dir), { recursive: true });
  const pg = dir === "memory" ? new PGlite() : new PGlite(dir);
  const wrap = (s) => ({
    async query(text, params = []) { const r = await s.query(text, params); return { rows: r.rows, count: r.affectedRows ?? r.rows.length }; },
  });
  return {
    ...wrap(pg),
    exec: (text) => pg.exec(text),
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
    end: () => pg.close(),
  };
}

let driver = null;
let pronto = null;
function conectar() {
  if (driver) return driver;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) driver = driverPostgres(url);
  else if (process.env.VERCEL) throw new Error("DATABASE_URL não configurada. Conecte um banco Postgres (Neon) ao projeto na Vercel.");
  else driver = driverPGlite(process.env.PGLITE_DIR || path.join(__dirname, "..", "data", "pg"));
  return driver;
}
// Cria as tabelas uma vez por instância (idempotente).
function ready() {
  if (!pronto) pronto = (async () => { await conectar().exec(SCHEMA); })().catch((e) => { pronto = null; throw e; });
  return pronto;
}

function api(q) {
  return {
    get: async (text, ...p) => (await q.query(text, p)).rows[0],
    all: async (text, ...p) => (await q.query(text, p)).rows,
    run: async (text, ...p) => q.query(text, p),
  };
}
const raiz = {
  get: async (t, ...p) => { await ready(); return api(conectar()).get(t, ...p); },
  all: async (t, ...p) => { await ready(); return api(conectar()).all(t, ...p); },
  run: async (t, ...p) => { await ready(); return api(conectar()).run(t, ...p); },
};
// Transação: fn recebe { get, all, run } ligados à mesma conexão.
async function tx(fn) { await ready(); return conectar().tx((t) => fn(api(t))); }
async function fechar() { if (driver) { await driver.end(); driver = null; pronto = null; } }
const usandoPGlite = () => !(process.env.DATABASE_URL || process.env.POSTGRES_URL);

module.exports = { ...raiz, tx, ready, fechar, now, usandoPGlite };
