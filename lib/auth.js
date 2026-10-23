"use strict";
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { get, run, now } = require("./db");

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 60;
const COOKIE = "sid";

async function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scrypt(String(senha), salt, 64)).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
async function conferirSenha(senha, armazenado) {
  const [alg, salt, hash] = String(armazenado || "").split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = await scrypt(String(senha), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const token = () => crypto.randomBytes(32).toString("base64url");

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* cookie malformado */ }
    }
  });
  return out;
}
// Cookie "Secure" quando a requisição chegou por HTTPS (Vercel sempre usa HTTPS).
const seguro = (req) => req.secure || /^https:/i.test(process.env.APP_URL || "");

async function criarSessao(req, res, userId) {
  const t = token();
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5);
  await run("INSERT INTO sessions (token_hash, user_id, criado_em, expira_em) VALUES ($1,$2,$3,$4)", sha(t), userId, now(), exp.toISOString());
  res.setHeader("Set-Cookie", `${COOKIE}=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${seguro(req) ? "; Secure" : ""}`);
}
async function encerrarSessao(req, res) {
  const t = parseCookies(req.headers.cookie)[COOKIE];
  if (t) await run("DELETE FROM sessions WHERE token_hash = $1", sha(t));
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${seguro(req) ? "; Secure" : ""}`);
}

const msgBloqueio = (u) => (u.motivo_bloqueio ? `Conta bloqueada: ${u.motivo_bloqueio}` : "Sua conta está bloqueada. Fale com o suporte.");

// Anexa req.user quando há sessão válida.
async function carregarUsuario(req, _res, next) {
  try {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (t) {
      const row = await get(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expira_em > $2`, sha(t), now());
      if (row) {
        req.user = row;
        if (Date.now() - Date.parse(row.ultimo_acesso || 0) > 5 * 60e3) await run("UPDATE users SET ultimo_acesso = $1 WHERE id = $2", now(), row.id);
      }
    }
    next();
  } catch (e) { next(e); }
}
function exigirLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ erro: "Faça login para continuar.", code: "nao_autenticado" });
  if (req.user.status === "bloqueado") return res.status(403).json({ erro: msgBloqueio(req.user), code: "bloqueado" });
  next();
}
function exigirAdmin(req, res, next) {
  exigirLogin(req, res, () => {
    if (req.user.role !== "admin") return res.status(403).json({ erro: "Acesso restrito ao administrador.", code: "proibido" });
    next();
  });
}

// Limite de tentativas guardado no banco, para valer entre todas as instâncias da Vercel.
async function limitarTentativas(chave, max = 8, janelaMs = 15 * 60e3) {
  const desde = Date.now() - janelaMs;
  const { n } = await get("SELECT COUNT(*)::int AS n FROM tentativas WHERE chave = $1 AND em > $2", chave, desde);
  await run("INSERT INTO tentativas (chave, em) VALUES ($1, $2)", chave, Date.now());
  return n + 1 > max;
}

module.exports = { hashSenha, conferirSenha, sha, token, criarSessao, encerrarSessao, carregarUsuario, exigirLogin, exigirAdmin, limitarTentativas, msgBloqueio };
