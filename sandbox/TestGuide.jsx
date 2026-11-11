import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, RotateCcw, LogOut, Info } from 'lucide-react';
import { useAuth } from '../client/src/lib/context.jsx';
import { Card, CardHeader, PageHeader, Button, Alert, Modal, cx } from '../client/src/components/ui.jsx';

const STEPS = [
  {
    title: '1. Base de demonstração e produtos',
    who: 'Administradora',
    items: [
      ['Ver a base: Produtos › Mesa / Plano Full (matriz ano × ganho/perdido/aberto)', '/produtos/1'],
      ['Filtrar a Base de Contatos por produto, ano e status histórico', '/contatos'],
      ['Abrir um contato e ver as oportunidades históricas e campanhas anteriores', '/contatos'],
    ],
  },
  {
    title: '2. Importar um Excel',
    who: 'Administradora',
    items: [
      ['Importações › enviar um .xlsx/.csv (pode ser a planilha de exemplo ou um arquivo seu)', '/importacoes'],
      ['Conferir o mapeamento das colunas e o produto/ano de cada aba', '/importacoes'],
      ['Na validação: conferir ganhos, perdidos, abertos, revisão, sem telefone e duplicidades', '/importacoes'],
      ['Confirmar e encontrar os novos contatos na Base de Contatos', '/contatos'],
      ['Importar de novo com um lead que mudou de situação (ex.: aberto → perdido) e ver “Atualização de situação” na prévia', '/importacoes'],
    ],
  },
  {
    title: '3. Criar uma campanha',
    who: 'Administradora',
    items: [
      ['Campanhas › Nova campanha: escolher produto, anos e status (prévia de elegíveis ao lado)', '/campanhas/nova'],
      ['Participantes: adicionar segmentos e distribuir 50/50 entre Letícia e Giovana', '/campanhas'],
      ['Mensagens: cadastrar mensagem inicial e follow-up com {{primeiro_nome}} e pré-visualizar', '/campanhas'],
      ['Ativar a campanha', '/campanhas'],
    ],
  },
  {
    title: '4. Operação da vendedora',
    who: 'Letícia ou Giovana',
    items: [
      ['Sair e entrar como Letícia (botões na tela de login)', null],
      ['Minha Operação › abrir um contato › Copiar mensagem (o nome já vem preenchido)', '/operacao'],
      ['Confirmar envio e ver o follow-up agendado para 3 dias', '/operacao'],
      ['Aba “Atrasados”: enviar um follow-up já vencido', '/operacao?queue=atrasados'],
      ['Registrar resultados: interesse, negociação, conversão com valor, sem interesse, não contatar', '/operacao'],
      ['Tentar abrir um contato da Giovana: não aparece para a Letícia', null],
    ],
  },
  {
    title: '5. Acompanhar os números',
    who: 'Qualquer perfil',
    items: [
      ['Dashboard de Gestão: ver mensagens, respostas e conversões atualizadas', '/dashboard'],
      ['Clicar em um indicador e abrir a lista de contatos correspondente', '/dashboard'],
      ['Comparativo Letícia × Giovana', '/dashboard'],
      ['Relatórios: exportar um relatório em Excel ou CSV', '/relatorios'],
      ['Follow-ups: agenda de próximos dias e atrasados', '/followups'],
    ],
  },
  {
    title: '6. Encerrar e limpar',
    who: 'Administradora',
    items: [
      ['Encerrar uma campanha e consultá-la em Campanhas › Encerradas', '/campanhas?tab=encerradas'],
      ['Reutilizar uma campanha encerrada como modelo', '/campanhas?tab=encerradas'],
      ['Configurações › Dados: remover os dados de demonstração (seus testes ficam)', '/configuracoes?tab=dados'],
    ],
  },
];

const KEY = 'aldeia-reativa-teste:roteiro';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

export default function TestGuide() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [done, setDone] = useState(load);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const toggle = (k) => {
    const n = { ...done, [k]: !done[k] };
    setDone(n);
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* sem armazenamento */ }
  };
  const total = STEPS.reduce((a, s) => a + s.items.length, 0);
  const count = Object.values(done).filter(Boolean).length;
  const persistent = window.__ALDEIA_TESTE__?.persistent;
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Guia de testes" subtitle={`Roteiro para validar a plataforma. ${count} de ${total} passos marcados.`}
        actions={<Button icon={LogOut} onClick={logout}>Trocar de usuária</Button>} />
      <Alert tone="info" title="Como esta versão funciona">
        Ambiente isolado, com dados fictícios. Nenhuma mensagem é enviada e não há conexão com o CowPilot ou com o CRM.
        {persistent
          ? ' Os dados do teste ficam salvos neste navegador e continuam aqui quando você voltar.'
          : ' Este navegador não permitiu salvar os dados: eles serão perdidos ao fechar a página.'}
        {' '}Você está como <b>{user.name}</b>.
      </Alert>
      {STEPS.map((s) => (
        <Card key={s.title}>
          <CardHeader title={s.title} subtitle={`Perfil: ${s.who}`} />
          <ul className="px-3 pb-3">
            {s.items.map(([text, to]) => {
              const k = `${s.title}|${text}`;
              return (
                <li key={k} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-stone-50">
                  <button onClick={() => toggle(k)} className="mt-0.5 shrink-0" aria-label="Marcar passo">
                    {done[k] ? <CheckCircle2 className="size-5 text-brand-600" /> : <Circle className="size-5 text-stone-300" />}
                  </button>
                  <span className={cx('text-sm flex-1', done[k] && 'text-muted line-through')}>{text}</span>
                  {to && <button onClick={() => nav(to)} className="text-[13px] text-brand-700 hover:underline shrink-0">Abrir</button>}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      <Card className="p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm"><p className="font-medium">Recomeçar do zero</p><p className="text-muted">Apaga tudo o que foi feito neste navegador e recria a base de demonstração.</p></div>
        <Button variant="danger" icon={RotateCcw} onClick={() => setResetOpen(true)}>Reiniciar ambiente de testes</Button>
      </Card>
      <p className="text-[12px] text-muted flex items-center gap-1"><Info className="size-3.5" />A versão oficial roda em servidor próprio, com banco de dados central, backups e acesso real de cada usuária.</p>
      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reiniciar ambiente de testes" size="sm"
        footer={<><Button onClick={() => setResetOpen(false)}>Cancelar</Button><Button variant="danger" loading={resetting} onClick={async () => { setResetting(true); try { localStorage.removeItem(KEY); } catch { /* ok */ } await window.__ALDEIA_TESTE__.reset(); }}>Reiniciar</Button></>}>
        <p className="text-sm">Importações, campanhas, envios e alterações feitas no teste serão apagados. A base de demonstração será criada de novo.</p>
      </Modal>
    </div>
  );
}
