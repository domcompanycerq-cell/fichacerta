"use strict";
const { get, all, run, now } = require("./db");
const { PRECO_PRO } = require("./planos");

const APP_NAME = process.env.APP_NAME || "CMV Certo";
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
// WhatsApp do suporte: é por ele que o usuário paga e renova o plano Pro.
const SUPORTE_WHATSAPP = String(process.env.SUPORTE_WHATSAPP || "5515988305442").replace(/\D/g, "");

let transporter = null;
const emailAtivo = !!process.env.SMTP_HOST;
if (emailAtivo) {
  const nodemailer = require("nodemailer");
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

async function enviarEmail(para, assunto, texto) {
  if (!transporter) { console.log(`[email desativado] para=${para} assunto="${assunto}"`); return false; }
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: para, subject: assunto, text: texto });
    return true;
  } catch (e) {
    console.error("[email] falhou:", e.message);
    return false;
  }
}

// Notificação dentro do app; com email=true também envia por e-mail (se SMTP configurado).
async function notificar(userId, titulo, mensagem, { tipo = "admin", email = false } = {}) {
  await run("INSERT INTO notificacoes (user_id, titulo, mensagem, tipo, criado_em) VALUES ($1,$2,$3,$4,$5)", userId, titulo, mensagem, tipo, now());
  let enviouEmail = false;
  if (email) {
    const u = await get("SELECT email, nome FROM users WHERE id = $1", userId);
    if (u) enviouEmail = await enviarEmail(u.email, `${APP_NAME}: ${titulo}`, `Olá, ${u.nome.split(" ")[0]}!\n\n${mensagem}\n\nAcesse: ${APP_URL}\n\n— Equipe ${APP_NAME}`);
  }
  return enviouEmail;
}

// Link de WhatsApp com a mensagem pronta (o admin clica e envia pelo próprio WhatsApp).
function linkWhatsApp(telefone, mensagem) {
  let d = String(telefone || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(mensagem)}`;
}

const MSG = {
  d7: (dias) => ({ titulo: "Seu plano Pro vence em breve", mensagem: `Seu plano Pro vence em ${dias} dias. Renove por R$ ${PRECO_PRO.toFixed(2).replace(".", ",")} falando com o suporte no WhatsApp para manter insumos e fichas ilimitados e o histórico de preços.` }),
  d1: () => ({ titulo: "Seu plano Pro vence amanhã", mensagem: `Seu plano Pro vence amanhã. Fale com o suporte no WhatsApp para renovar e não perder o acesso ilimitado e o histórico de preços.` }),
  vencido: () => ({ titulo: "Seu plano Pro venceu", mensagem: `Seu plano Pro venceu e sua conta voltou ao Free. Nada foi apagado: os insumos e fichas além do limite do Free ficam bloqueados até a renovação. Fale com o suporte no WhatsApp para renovar e desbloquear tudo.` }),
};

// Rotina de lembretes: chamada uma vez por dia pelo Vercel Cron (/api/cron/lembretes) ou pelo painel.
async function rodarLembretes() {
  const agora = Date.now();
  const pros = await all("SELECT id, pro_ate FROM users WHERE plano = 'pro' AND pro_ate IS NOT NULL AND status = 'ativo'");
  let enviados = 0;
  for (const u of pros) {
    const dias = Math.ceil((Date.parse(u.pro_ate) - agora) / 864e5);
    const ref = u.pro_ate.slice(0, 10);
    let tipo = null, msg = null;
    if (dias <= 0) { tipo = "vencido"; msg = MSG.vencido(); }
    else if (dias <= 1) { tipo = "d1"; msg = MSG.d1(); }
    else if (dias <= 7) { tipo = "d7"; msg = MSG.d7(dias); }
    if (!tipo) continue;
    // Vencido há mais de 30 dias: não insiste.
    if (tipo === "vencido" && dias < -30) continue;
    // Grava o lembrete antes de enviar; se já existia (outra execução), não envia de novo.
    const r = await run("INSERT INTO lembretes (user_id, tipo, ref, enviado_em) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", u.id, tipo, ref, now());
    if (!r.count) continue;
    await notificar(u.id, msg.titulo, msg.mensagem, { tipo: "renovacao", email: true });
    enviados++;
  }
  if (enviados) console.log(`[lembretes] ${enviados} lembrete(s) de renovação enviados`);
  return enviados;
}

module.exports = { APP_NAME, APP_URL, SUPORTE_WHATSAPP, emailAtivo, enviarEmail, notificar, linkWhatsApp, rodarLembretes };
