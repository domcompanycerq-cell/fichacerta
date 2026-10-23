# Ficha Certa

App web (instalável no celular) para cozinhas: o usuário cadastra insumos (nome, embalagem, preço), monta fichas técnicas, e o custo de cada receita se recalcula sozinho quando um preço muda. Tem planos Free e Pro (pagos pelo WhatsApp do suporte) e um painel administrativo.

> "Ficha Certa" é um nome provisório. Troque em `APP_NAME` e em `public/manifest.webmanifest`.

## Funcionalidades

**App do usuário** (`/`)
- Cadastro com nome, DDD + telefone e e-mail. Login com e-mail e senha (sessão de 60 dias).
- Insumos em tabela: preço editável direto na célula, importação por lista (`Arroz, 1kg, R$3,60`).
- Fichas técnicas: quantidade, unidade (g, kg, ml, L, un, dz) e fator de correção. Mostra custo total, custo por porção, preço sugerido pelo CMV alvo e CMV praticado.
- Mudou um preço: todas as fichas que usam o insumo são recalculadas, e o app mostra o antes e depois.
- Histórico de preços (Pro). As alterações são gravadas também no Free.
- Notificações, página de plano com botão para assinar ou renovar pelo WhatsApp, "Meus dados" e troca de senha.
- Instalável no celular (PWA): ícone na tela inicial, abre em tela cheia.

**Planos**

| | Free | Pro (R$ 25/mês) |
|---|---|---|
| Insumos | até 10 | ilimitados |
| Fichas técnicas | até 2 | ilimitadas |
| Histórico de preços | não | sim |

Os limites valem no servidor. Se o Pro vence, a conta volta ao Free sem perder nada.

**Painel admin** (`/admin`)
- Indicadores: usuários, assinantes, receita mensal, vencendo, vencidos, bloqueados, gráfico de cadastros.
- Por usuário: liberar Pro (+30/+90/+365 dias ou até uma data), voltar ao Free, bloquear com motivo e liberar, senha temporária, lembrete de renovação, link de WhatsApp.
- Notificações em massa (app, e-mail e links de WhatsApp prontos).
- Lembretes automáticos de renovação: 7 dias antes, 1 dia antes e no vencimento (tarefa diária da Vercel).

**Pagamento:** não há pagamento online. "Assinar" e "Renovar" abrem o WhatsApp do suporte (`SUPORTE_WHATSAPP`) com a mensagem pronta e o e-mail do usuário. Depois de confirmar o pagamento, o admin clica em **+30 dias** no painel.

## Estrutura

```
server.js            API (Express). Na Vercel vira a função; no computador, npm start
lib/db.js            Postgres (DATABASE_URL) ou Postgres embutido (PGlite) no computador e nos testes
lib/auth.js          senhas (scrypt), sessões em cookie, bloqueio, limite de tentativas
lib/planos.js        limites Free/Pro e vencimento
lib/notificacoes.js  notificações, e-mail, WhatsApp, lembretes de renovação
public/              telas (servidas pela CDN da Vercel)
  index.html, app.js   app do usuário
  admin.html, admin.js painel administrativo
  calc.js              cálculo das fichas (usado no navegador e no servidor)
  manifest.webmanifest, sw.js, icons/   instalação no celular
vercel.json          tarefa diária, rota /admin e cabeçalhos de segurança
test/api.test.js     testes automáticos
```

## Rodar no computador

Precisa do Node.js 22 ou mais novo. Não precisa instalar banco: sem `DATABASE_URL`, o app usa um Postgres embutido que grava em `./data/pg`.

```bash
npm install
```

```bash
cp .env.example .env
```

Edite o `.env` e defina `ADMIN_EMAIL` e `ADMIN_PASSWORD`. Depois:

```bash
npm start
```

Abra http://localhost:3000 (painel em http://localhost:3000/admin).

Testes:

```bash
npm test
```

## Publicar: GitHub + Vercel

### 1. Subir o código para o GitHub

1. Crie um repositório **privado** vazio em https://github.com/new (sem README, sem .gitignore). Ex.: `ficha-certa`.
2. Na pasta do projeto (o repositório Git já está criado, com o primeiro commit):

```bash
git remote add origin https://github.com/SEU-USUARIO/ficha-certa.git
```

```bash
git push -u origin main
```

O `.env` (com senhas) não vai para o GitHub: está no `.gitignore`.

### 2. Criar o projeto na Vercel

1. Em https://vercel.com/new, clique em **Import** no repositório `ficha-certa`.
2. Framework Preset: deixe **Other** (a Vercel reconhece o `server.js` com Express). Não precisa mudar Build nem Output.
3. **Antes de clicar em Deploy**, abra **Environment Variables** e cadastre:

| Variável | Valor |
|---|---|
| `ADMIN_EMAIL` | seu e-mail de administrador |
| `ADMIN_PASSWORD` | uma senha forte |
| `CRON_SECRET` | um texto aleatório longo (ex.: gere em https://1password.com/password-generator) |
| `APP_URL` | `https://SEU-PROJETO.vercel.app` (ajuste depois se usar domínio próprio) |
| `SUPORTE_WHATSAPP` | `5515988305442` |
| `PRO_PRICE` | `25` |

4. Clique em **Deploy**. O primeiro deploy vai abrir com erro de banco: é esperado, o banco vem no próximo passo.

### 3. Conectar o banco (Neon Postgres, plano grátis)

1. No projeto da Vercel: **Storage › Create Database › Neon (Postgres)**, escolha a região **São Paulo (gru1)** se disponível, e conecte ao projeto marcando os ambientes Production e Preview.
2. Isso cria a variável `DATABASE_URL` sozinha.
3. Vá em **Deployments**, abra o último e clique em **Redeploy**.

As tabelas são criadas automaticamente no primeiro acesso. Confira em `https://SEU-PROJETO.vercel.app/api/health` (deve mostrar `{"ok":true}`).

> Também funciona com Supabase ou outro Postgres: basta cadastrar `DATABASE_URL` com a URL de conexão (use a URL com pooler).

### 4. Primeiro acesso

- App: `https://SEU-PROJETO.vercel.app`
- Painel: `https://SEU-PROJETO.vercel.app/admin`, entrando com `ADMIN_EMAIL` e `ADMIN_PASSWORD`.

### 5. Lembretes automáticos

O `vercel.json` agenda `/api/cron/lembretes` todo dia às 9h (horário de Brasília). A Vercel envia o `CRON_SECRET` sozinha. Para testar na hora: painel admin › Enviar notificação › **Verificar agora**.

### 6. Domínio próprio (opcional)

Registre o domínio no registro.br e adicione em **Vercel › Settings › Domains**. A Vercel mostra os registros DNS para configurar no registro.br. Depois atualize `APP_URL`.

### Atualizações

Cada `git push` para a branch `main` publica uma nova versão automaticamente. Pull requests geram uma prévia com endereço próprio.

## Instalar no celular

- **Android (Chrome):** abra o link › menu ⋮ › **Instalar app** (ou "Adicionar à tela inicial").
- **iPhone (Safari):** abra o link › botão Compartilhar › **Adicionar à Tela de Início**.

O app abre em tela cheia com ícone próprio. Os dados ficam no servidor, então o usuário vê as mesmas informações no celular e no computador.

## E-mail (opcional)

Cadastre `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` (Gmail com senha de app, Brevo, Resend, Amazon SES...). Com e-mail ativo, lembretes e avisos também vão por e-mail e "Esqueci minha senha" envia um link. Sem e-mail, o admin gera uma senha temporária pelo painel.
