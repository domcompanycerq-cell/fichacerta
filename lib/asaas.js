"use strict";
// Cobrança do plano Pro pelo Asaas (Pix e cartão).
// Sem ASAAS_API_KEY o pagamento online fica desligado e o app continua com a assinatura pelo WhatsApp.
// ASAAS_AMBIENTE=producao usa a API real; qualquer outro valor usa o sandbox (testes sem dinheiro).
// ASAAS_URL troca o endereço da API (usado pelos testes automáticos com um Asaas simulado).

const URL_PADRAO = { producao: "https://api.asaas.com/v3", sandbox: "https://api-sandbox.asaas.com/v3" };

const chave = () => process.env.ASAAS_API_KEY || "";
const ativo = () => !!chave();
const baseUrl = () => (process.env.ASAAS_URL || URL_PADRAO[process.env.ASAAS_AMBIENTE === "producao" ? "producao" : "sandbox"]).replace(/\/$/, "");
const tokenWebhook = () => process.env.ASAAS_WEBHOOK_TOKEN || "";

class ErroAsaas extends Error {
  constructor(status, corpo) {
    const detalhe = corpo && Array.isArray(corpo.errors) && corpo.errors.length ? corpo.errors.map((e) => e.description).join(" ") : "";
    super(detalhe || `O Asaas recusou a requisição (${status}).`);
    this.status = status;
    this.corpo = corpo;
  }
}

async function chamar(metodo, caminho, corpo) {
  const r = await fetch(baseUrl() + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", "User-Agent": "cmv-certo", access_token: chave() },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroAsaas(r.status, dados);
  return dados;
}

const criarCliente = (dados) => chamar("POST", "/customers", dados);
const atualizarCliente = (id, dados) => chamar("PUT", `/customers/${encodeURIComponent(id)}`, dados);
const criarCobranca = (dados) => chamar("POST", "/payments", dados);
const buscarCobranca = (id) => chamar("GET", `/payments/${encodeURIComponent(id)}`);
const pixDaCobranca = (id) => chamar("GET", `/payments/${encodeURIComponent(id)}/pixQrCode`);
const criarAssinatura = (dados) => chamar("POST", "/subscriptions", dados);
const cancelarAssinatura = (id) => chamar("DELETE", `/subscriptions/${encodeURIComponent(id)}`);

// Situações do Asaas em que o dinheiro já entrou (ou o cartão foi aprovado).
const PAGO = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);
const DEVOLVIDO = new Set(["REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"]);

module.exports = {
  ativo, baseUrl, tokenWebhook, ErroAsaas, PAGO, DEVOLVIDO,
  criarCliente, atualizarCliente, criarCobranca, buscarCobranca, pixDaCobranca, criarAssinatura, cancelarAssinatura,
};
