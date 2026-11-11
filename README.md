# Aldeia Reativa

Plataforma permanente de **reativação comercial** da Aldeia Coworking: base central de leads históricos (por produto, ano e resultado), campanhas recorrentes criadas sobre essa base, mensagens personalizadas, distribuição entre vendedoras, follow-ups organizados, dashboards e relatórios.

> A plataforma **não envia mensagens**. As vendedoras copiam a mensagem pronta, enviam manualmente pelo CowPilot e confirmam o envio no sistema. Nenhuma sincronização com o CowPilot é simulada.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 20+ · Express · PostgreSQL 14+ (SQL puro, migrações versionadas) |
| Frontend | React 18 · Vite · Tailwind CSS 4 · TanStack Query · Recharts |
| Planilhas | SheetJS (`.xlsx`, `.xls`, `.csv`, várias abas) |
| Segurança | bcrypt (custo 12), sessão em cookie `httpOnly` com token aleatório guardado só como hash, bloqueio após 8 tentativas, limite de requisições no login, proteção CSRF por cabeçalho, Helmet/CSP, permissões verificadas no servidor |

## Instalação (desenvolvimento)

```bash
npm install
cp .env.example .env        # ajuste DATABASE_URL e os e-mails das usuárias
npm run migrate             # cria as tabelas
npm run setup               # cria Administradora, Letícia e Giovana e mostra senhas temporárias (uma única vez)
npm run demo:load           # opcional: dados fictícios para testar
npm run dev                 # http://localhost:3000
```

No primeiro acesso, cada usuária precisa trocar a senha temporária. Não existe senha fixa no código.

## Produção

**Com Docker (recomendado):**

```bash
cp .env.example .env        # defina POSTGRES_PASSWORD, APP_URL e os e-mails
docker compose up -d --build
docker compose exec app npm run setup
```

Publique a porta 3000 atrás de um proxy HTTPS (Caddy, Nginx ou o do provedor). O serviço `backup` gera um `pg_dump` diário às 03h em `./backups` e mantém 30 dias.

**Sem Docker:** PostgreSQL gerenciado + `npm ci && npm run build && npm start` (com `NODE_ENV=production`). As migrações rodam automaticamente na inicialização. Agende `npm run backup` diariamente (cron).

**Restaurar um backup:**

```bash
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/arquivo.dump
```

A administradora também pode baixar um backup completo em *Configurações › Dados e backup*.

## Como o sistema funciona

### Base permanente
- **Contato** (pessoa) ↔ várias **oportunidades históricas** (produto, ano, ganho/perdido/aberto/revisão). Importações nunca apagam nada: só adicionam oportunidades e, se a regra escolhida permitir, completam cadastros (com prévia das alterações).
- **Classificação:** ganho = só data de ganho; perdido = só data de perda; aberto = nenhuma; **revisão necessária** = as duas datas, datas ilegíveis, datas anteriores à criação ou coluna de status contraditória. Registros contraditórios nunca são descartados nem corrigidos automaticamente; a administradora pode ajustá-los manualmente (com justificativa registrada na auditoria).
- **Ano de referência:** data de entrada → (inferido) data de ganho/perda → (inferido) ano do lote informado na importação → manual.
- **Duplicidades:** telefones (padrão BR) e e-mails são normalizados. Linhas da mesma pessoa no arquivo viram um único contato; coincidências com contatos existentes são vinculadas; casos ambíguos (mesmo telefone, nome diferente etc.) precisam de decisão antes de confirmar; oportunidades idênticas já importadas são ignoradas por padrão. Arquivo de origem, aba, linha e colunas extras são preservados.

### Campanhas
- Criadas a qualquer momento sobre a base: produtos, anos, status históricos, motivos de perda, exclusão de quem foi abordado recentemente, de quem está em outra campanha ativa, de quem já converteu, e filtro por histórico de campanhas anteriores. Opt-out é sempre excluído.
- Ciclo: rascunho → ativa ⇄ pausada → encerrada. Encerrar suspende os follow-ups pendentes e preserva tudo. Qualquer campanha pode ser reutilizada como modelo.
- **Mensagens por segmento**, com versões: o sistema escolhe a mais específica (produto + ano + status). Variáveis: `{{primeiro_nome}}`, `{{nome_completo}}`, `{{empresa}}`, `{{produto}}`, `{{unidade}}`, `{{vendedora}}`, `{{campanha}}`, `{{ano}}`; texto alternativo com `{{empresa|sua empresa}}`. Sem nome, “Oi, {{primeiro_nome}}!” vira “Oi!”, e a vendedora recebe um alerta.
- **Distribuição:** 50/50, proporcional, por segmento ou manual. Quem já recebeu mensagem nunca é redistribuído automaticamente.

### Operação e follow-up
1. A vendedora abre o contato e vê a mensagem já personalizada.
2. **Copiar mensagem** não conta como envio.
3. Depois de enviar pelo CowPilot, **Confirmar envio** registra data, hora e responsável e agenda o follow-up (padrão: 3 dias; configurável por campanha). Um segundo clique concorrente é bloqueado.
4. No vencimento, o contato entra em *Follow-ups de hoje* ou *Atrasados*, já com a mensagem de follow-up.
5. Ao atingir o limite de abordagens sem resposta, o contato é encerrado como *sem resposta* após o prazo.
6. Resposta, interesse, negociação, retorno futuro (com data), conversão (valor, data, produto), sem interesse e opt-out cancelam os follow-ups pendentes. **Opt-out** bloqueia o contato em todas as campanhas, atuais e futuras.

O agendamento fica todo no banco. Uma rotina idempotente roda a cada 10 minutos e também a cada acesso, então nada se perde se o servidor ficar parado.

### Indicadores
- Taxa de resposta = respondeu ÷ contatos com envio confirmado × 100.
- Taxa de conversão = convertidos ÷ contatos com envio confirmado × 100 (também sobre respondentes e sobre interessados).
- Mensagens enviadas (todas as abordagens) ≠ contatos trabalhados.
- Com período selecionado, os resultados consideram os contatos cujo **primeiro envio** caiu no período (coorte); as mensagens contam pela data de cada envio.
- Todo indicador abre a lista de contatos correspondente.

## Permissões

| | Administradora | Vendedora |
|---|---|---|
| Importar, produtos, campanhas, mensagens, distribuição, usuárias | ✔ | — |
| Operação, envio, resultados, follow-ups | todos os contatos | só os atribuídos a ela |
| Base de contatos | completa | contatos já atribuídos a ela |
| Dashboard de gestão | ✔ | ✔ (números gerais + filtro próprio) |
| Relatórios | todos | com os próprios contatos |

## LGPD
Acesso por perfil; registro de auditoria (logins, exportações, visualizações, alterações); registro de opt-out com data, autora e motivo; exportação dos dados do titular e anonimização na ficha do contato; parâmetro de retenção. Uploads ficam em disco com permissão restrita e só a administradora pode baixá-los.

## Dados de demonstração
`npm run demo:load` ou *Configurações › Dados e backup* cria cerca de 260 contatos fictícios (telefone com DDD 00, e-mails `@exemplo.com.br`) e 3 campanhas marcadas como “Exemplo”. **Remova-os antes da importação real** (`npm run demo:remove` ou o botão correspondente). Dados reais não são afetados.

## Testes

```bash
npm test                                                      # testes unitários
TEST_DATABASE_URL=postgres://.../aldeia_reativa_test npm test # + fluxo completo em um banco de TESTE (é apagado)
```

## Recuperação de acesso
Em “Esqueci minha senha”: com SMTP configurado, a usuária recebe um link de uso único (válido por 2 h). Sem SMTP, o pedido aparece para a administradora, que gera o link em *Configurações › Usuárias*. Novas usuárias recebem um link de convite e definem a própria senha.

## Observação sobre a biblioteca de planilhas
O pacote `xlsx` do npm (0.18.5) é a última versão publicada no registro público. Como só a administradora importa arquivos, o risco é baixo, mas recomenda-se trocar pela versão oficial mais recente no deploy:
`npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
