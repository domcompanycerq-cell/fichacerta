"use strict";
const { get, all, run, now } = require("./db");
const { PRECO_PRO, PRECO_ANUAL, DIAS_TOLERANCIA } = require("./planos");
const asaas = require("./asaas");

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
    if (u) enviouEmail = await enviarEmail(u.email, `${APP_NAME}: ${titulo}`, `Olá, ${u.nome.split(" ")[0]}!\n\n${mensagem}\n\nAcesse: ${APP_URL}\n\nEquipe ${APP_NAME}`);
  }
  return enviouEmail;
}

// Link de WhatsApp com a mensagem pronta (o admin clica e envia pelo próprio WhatsApp).
function linkWhatsApp(telefone, mensagem) {
  let d = String(telefone || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(mensagem)}`;
}

const reais = (n) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;
// Onde renovar: pelo app quando o pagamento online está ligado; senão, pelo WhatsApp do suporte.
const ondeRenovar = () => (asaas.ativo() ? "na página Plano e assinatura do app" : "falando com o suporte no WhatsApp");
const opcoes = () => `Renove por ${reais(PRECO_PRO)}/mês ou garanta o ano por ${reais(PRECO_ANUAL)}`;
const MSG = {
  d7: (dias) => ({ titulo: "Seu plano Pro vence em breve", mensagem: `Seu plano Pro vence em ${dias} dias. ${opcoes()} ${ondeRenovar()} para manter insumos e fichas ilimitados e o histórico de preços.` }),
  d1: () => ({ titulo: "Seu plano Pro vence amanhã", mensagem: `Seu plano Pro vence amanhã. ${opcoes()} ${ondeRenovar()} e não perca o acesso ilimitado e o histórico de preços.` }),
  vencido: () => ({ titulo: "Seu plano Pro venceu", mensagem: `Seu plano Pro venceu e sua conta voltou ao Free. Nada foi apagado: os insumos e fichas além do limite do Free ficam bloqueados até a renovação. ${opcoes()} ${ondeRenovar()} para desbloquear tudo.` }),
  // Assinatura mensal automática: a cobrança chega sozinha; o aviso só lembra de pagar.
  renovaD7: (dias) => ({ titulo: "Sua assinatura renova em breve", mensagem: `Sua assinatura Pro renova em ${dias} dias, por ${reais(PRECO_PRO)}. A cobrança chega no seu e-mail e também aparece na página Plano e assinatura do app.` }),
  renovaD1: () => ({ titulo: "Sua assinatura renova amanhã", mensagem: `Sua assinatura Pro renova amanhã, por ${reais(PRECO_PRO)}. Pague pelo link da cobrança ou pela página Plano e assinatura para não perder o acesso ilimitado.` }),
  atrasada: () => ({ titulo: "Sua renovação está em aberto", mensagem: `Ainda não recebemos a renovação do seu Pro. Você continua com acesso por até ${DIAS_TOLERANCIA} dias. Pague pela página Plano e assinatura para não voltar ao Free.` }),
};

// Rotina de lembretes: chamada uma vez por dia pelo Vercel Cron (/api/cron/lembretes) ou pelo painel.
async function rodarLembretes() {
  const agora = Date.now();
  const pros = await all("SELECT id, pro_ate, asaas_assinatura_id FROM users WHERE plano = 'pro' AND pro_ate IS NOT NULL AND status = 'ativo'");
  let enviados = 0;
  for (const u of pros) {
    const dias = Math.ceil((Date.parse(u.pro_ate) - agora) / 864e5);
    const ref = u.pro_ate.slice(0, 10);
    let tipo = null, msg = null;
    if (u.asaas_assinatura_id) {
      // Com renovação automática, só volta ao Free depois da tolerância.
      if (dias <= -DIAS_TOLERANCIA) { tipo = "vencido"; msg = MSG.vencido(); }
      else if (dias <= 0) { tipo = "atrasada"; msg = MSG.atrasada(); }
      else if (dias <= 1) { tipo = "d1"; msg = MSG.renovaD1(); }
      else if (dias <= 7) { tipo = "d7"; msg = MSG.renovaD7(dias); }
    } else if (dias <= 0) { tipo = "vencido"; msg = MSG.vencido(); }
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
