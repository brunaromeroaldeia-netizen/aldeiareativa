import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Link2, Copy, Database, FlaskConical, Trash2, ShieldCheck, Pencil } from 'lucide-react';
import { api, download, copyText } from '../lib/api.js';
import { useAuth } from '../lib/context.jsx';
import { fmtDateTime } from '../lib/format.js';
import { Card, CardHeader, PageHeader, Tabs, Button, Input, Field, Select, Modal, Alert, Badge, Loading, useToast, useConfirm } from '../components/ui.jsx';
import { ChangePassword } from './Auth.jsx';

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || (isAdmin ? 'usuarias' : 'conta');
  const tabs = [
    ...(isAdmin ? [{ value: 'usuarias', label: 'Usuárias' }, { value: 'parametros', label: 'Parâmetros' }, { value: 'dados', label: 'Dados e backup' }, { value: 'auditoria', label: 'LGPD e auditoria' }] : []),
    { value: 'conta', label: 'Minha conta' },
  ];
  return (
    <div>
      <PageHeader title="Configurações" />
      <Tabs tabs={tabs} value={tab} onChange={(v) => setSp({ tab: v })} className="mb-5" />
      {tab === 'conta' && <Card className="p-5 max-w-md"><p className="font-semibold mb-4">Alterar senha</p><ChangePassword /></Card>}
      {tab === 'usuarias' && isAdmin && <UsersTab />}
      {tab === 'parametros' && isAdmin && <ParamsTab />}
      {tab === 'dados' && isAdmin && <DataTab />}
      {tab === 'auditoria' && isAdmin && <AuditTab />}
    </div>
  );
}

function LinkBox({ link, onClose, title }) {
  const toast = useToast();
  const nav = useNavigate();
  const token = (link.match(/token=([^&]+)/) || [])[1];
  return (
    <Modal open onClose={onClose} title={title} footer={<Button variant="primary" onClick={onClose}>Concluir</Button>}>
      <p className="text-sm text-muted mb-3">Envie este link diretamente à usuária (válido por 2 horas, uso único). Ele não será exibido novamente.</p>
      <div className="flex gap-2"><Input readOnly value={link} onFocus={(e) => e.target.select()} /><Button icon={Copy} onClick={async () => { await copyText(link); toast('Link copiado'); }}>Copiar</Button></div>
      {window.__ALDEIA_TESTE__ && token && (
        <p className="text-[12px] text-muted mt-3">Na versão de testes o link não abre fora desta página. <button className="underline text-brand-700" onClick={() => { onClose(); nav(`/redefinir-senha?token=${token}`); }}>Abrir a tela de definição de senha aqui</button>.</p>
      )}
    </Modal>
  );
}

function UsersTab() {
  const { user: me, refresh: refreshMe } = useAuth();
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, confirmDialog] = useConfirm();
  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  const { data: requests = [] } = useQuery({ queryKey: ['access-requests'], queryFn: () => api.get('/users/access-requests') });
  const [newOpen, setNewOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'vendedora' });
  const [link, setLink] = useState(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['access-requests'] }); };
  const resetLink = async (u) => {
    try { const r = await api.post(`/users/${u.id}/reset-link`); setLink({ link: r.link, title: `Link de redefinição — ${u.name}` }); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const create = async () => {
    try { const r = await api.post('/users', f); setNewOpen(false); setLink({ link: r.link, title: `Convite — ${f.name}` }); setF({ name: '', email: '', role: 'vendedora' }); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const toggle = async (u) => {
    if (!(await confirm({ title: u.active ? 'Desativar acesso' : 'Reativar acesso', message: u.active ? `${u.name} perderá o acesso imediatamente. Histórico preservado.` : `${u.name} voltará a acessar.`, danger: u.active }))) return;
    try { await api.patch(`/users/${u.id}`, { active: !u.active }); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-4">
      {confirmDialog}
      {requests.map((r) => (
        <Alert key={r.id} tone="warning" title="Pedido de recuperação de acesso">
          {r.name} ({r.email}) pediu redefinição de senha em {fmtDateTime(r.created_at)}.{' '}
          <button className="underline font-medium" onClick={() => resetLink({ id: r.user_id, name: r.name })}>Gerar link seguro</button>
        </Alert>
      ))}
      <Card>
        <CardHeader title="Usuárias" subtitle="Cada pessoa tem login individual. Senhas são armazenadas com hash (bcrypt)." actions={<Button variant="primary" icon={UserPlus} onClick={() => setNewOpen(true)}>Nova usuária</Button>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[12px] text-muted border-y border-line text-left"><th className="font-medium px-5 py-2">Nome</th><th className="font-medium px-2">E-mail</th><th className="font-medium px-2">Perfil</th><th className="font-medium px-2">Último acesso</th><th className="font-medium px-5 text-right">Ações</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2.5 font-medium">{u.name} {!u.active && <Badge className="bg-stone-100 text-muted ring-line">inativa</Badge>} {u.must_change_password && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">senha temporária</Badge>}</td>
                  <td className="px-2">{u.email}</td>
                  <td className="px-2">{u.role === 'admin' ? 'Administradora' : 'Vendedora'}</td>
                  <td className="px-2 text-muted">{fmtDateTime(u.last_login_at)}</td>
                  <td className="px-5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing({ id: u.id, name: u.name, email: u.email })}>Editar</Button>
                    <Button size="sm" variant="ghost" icon={Link2} onClick={() => resetLink(u)}>Link de senha</Button>
                    {u.id !== me.id && <Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.active ? 'Desativar' : 'Reativar'}</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nova usuária" footer={<><Button onClick={() => setNewOpen(false)}>Cancelar</Button><Button variant="primary" onClick={create} disabled={!f.name || !f.email}>Criar e gerar convite</Button></>}>
        <div className="space-y-3">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="E-mail (login)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Perfil"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="vendedora">Vendedora</option><option value="admin">Administradora</option></Select></Field>
          <p className="text-[12px] text-muted">Nenhuma senha é definida por você: a usuária cria a própria senha pelo link de convite.</p>
        </div>
      </Modal>
      {link && <LinkBox {...link} onClose={() => setLink(null)} />}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar usuária"
        footer={<><Button onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" disabled={!editing?.name?.trim() || !editing?.email?.trim()} onClick={async () => {
          try { await api.patch(`/users/${editing.id}`, { name: editing.name, email: editing.email }); toast('Usuária atualizada'); if (editing.id === me.id) await refreshMe(); setEditing(null); refresh(); } catch (e) { toast(e.message, 'error'); }
        }}>Salvar</Button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label="Nome" hint="O primeiro nome aparece nas mensagens ({{vendedora}}) de quem abrir o contato."><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="E-mail (login)"><Input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ParamsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') });
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading />;
  const save = async () => {
    try {
      await api.put('/settings', { unidade_padrao: f.unidade_padrao, janela_abordagem_recente_dias: Number(f.janela_abordagem_recente_dias), followup_dias_padrao: Number(f.followup_dias_padrao), max_tentativas_padrao: Number(f.max_tentativas_padrao), retencao_meses: Number(f.retencao_meses) });
      toast('Parâmetros salvos'); qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Card className="p-5 max-w-2xl space-y-4">
      <Field label="Unidade padrão — variável {{unidade}}" hint="Usada quando a oportunidade não informa a unidade."><Input value={f.unidade_padrao} onChange={(e) => setF({ ...f, unidade_padrao: e.target.value })} /></Field>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Follow-up padrão (dias)"><Input type="number" value={f.followup_dias_padrao} onChange={(e) => setF({ ...f, followup_dias_padrao: e.target.value })} /></Field>
        <Field label="Limite de abordagens padrão"><Input type="number" value={f.max_tentativas_padrao} onChange={(e) => setF({ ...f, max_tentativas_padrao: e.target.value })} /></Field>
        <Field label="Abordagem recente (dias)" hint="Alerta e filtro de repetição"><Input type="number" value={f.janela_abordagem_recente_dias} onChange={(e) => setF({ ...f, janela_abordagem_recente_dias: e.target.value })} /></Field>
      </div>
      <Field label="Retenção de dados de contatos inativos (meses)" hint="Referência da política interna de LGPD — revise e anonimize contatos sem relacionamento após este prazo."><Input type="number" value={f.retencao_meses} onChange={(e) => setF({ ...f, retencao_meses: e.target.value })} /></Field>
      <Button variant="primary" onClick={save}>Salvar</Button>
    </Card>
  );
}

function DataTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, confirmDialog] = useConfirm();
  const { data: demo, refetch } = useQuery({ queryKey: ['demo'], queryFn: () => api.get('/admin/demo') });
  const [busy, setBusy] = useState('');
  const run = async (key, fn, msg) => { setBusy(key); try { await fn(); toast(msg); refetch(); qc.invalidateQueries(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); } };
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      {confirmDialog}
      <Card>
        <CardHeader title="Dados de demonstração" subtitle="Contatos e campanhas fictícios (telefones com DDD 00, e-mails @exemplo.com.br), marcados como “Exemplo”." />
        <div className="px-5 pb-5 space-y-3">
          <p className="text-sm">{demo?.contacts ? <>Carregados: <b>{demo.contacts}</b> contatos, <b>{demo.opportunities}</b> oportunidades e <b>{demo.campaigns}</b> campanhas.</> : 'Nenhum dado de demonstração carregado.'}</p>
          {demo?.contacts ? (
            <Button variant="danger" icon={Trash2} loading={busy === 'rm'} onClick={async () => {
              if (await confirm({ title: 'Remover dados de demonstração', message: 'Remove todos os contatos, campanhas, envios e importações de exemplo. Dados reais não são afetados.', danger: true, confirmLabel: 'Remover' })) run('rm', () => api.del('/admin/demo'), 'Dados de demonstração removidos');
            }}>Remover dados de demonstração</Button>
          ) : demo?.allowLoad === false ? (
            <p className="text-[12.5px] text-muted">No site oficial a base começa vazia; dados de demonstração ficam desativados.</p>
          ) : (
            <Button icon={FlaskConical} loading={busy === 'load'} onClick={() => run('load', () => api.post('/admin/demo'), 'Dados de demonstração carregados')}>Carregar dados de demonstração</Button>
          )}
        </div>
      </Card>
      {window.__ALDEIA_TESTE__ ? (
      <Card>
        <CardHeader title="Reiniciar ambiente de testes" subtitle="Apaga tudo o que foi feito nesta versão de testes (neste navegador) e recria a base de demonstração. Backups ficam disponíveis na versão oficial." />
        <div className="px-5 pb-5">
          <Button variant="danger" loading={busy === 'reset'} onClick={async () => {
            if (await confirm({ title: 'Reiniciar ambiente de testes', message: 'Importações, campanhas, envios e alterações do teste serão apagados.', danger: true, confirmLabel: 'Reiniciar' })) { setBusy('reset'); await window.__ALDEIA_TESTE__.reset(); }
          }}>Reiniciar ambiente</Button>
        </div>
      </Card>
      ) : (
      <Card>
        <CardHeader title="Backup do banco de dados" subtitle="Cópia completa de todos os dados (contatos, campanhas, mensagens, históricos e planilhas importadas). Guarde o arquivo em local seguro: ele contém dados pessoais." />
        <div className="px-5 pb-5 space-y-3">
          <Button icon={Database} loading={busy === 'bk'} onClick={() => run('bk', () => download('/admin/backup'), 'Backup gerado')}>Baixar backup agora</Button>
        </div>
      </Card>
      )}
    </div>
  );
}

const ACTION_LABEL = {
  login: 'Login', login_falhou: 'Login falhou', senha_alterada: 'Senha alterada', senha_redefinida: 'Senha redefinida', recuperacao_solicitada: 'Recuperação solicitada',
  importacao_enviada: 'Planilha enviada', importacao_concluida: 'Importação concluída', importacao_cancelada: 'Importação cancelada', contato_visualizado: 'Contato visualizado',
  opt_out: 'Opt-out registrado', opt_out_revogado: 'Opt-out revogado', contato_anonimizado: 'Contato anonimizado', dados_titular_exportados: 'Dados do titular exportados',
  relatorio_exportado: 'Relatório exportado', backup_baixado: 'Backup baixado', campanha_criada: 'Campanha criada', campanha_encerrar: 'Campanha encerrada', campanha_ativar: 'Campanha ativada',
  distribuicao: 'Distribuição', reatribuicao: 'Reatribuição', oportunidade_ajustada: 'Oportunidade ajustada',
};

function AuditTab() {
  const { data = [], isLoading } = useQuery({ queryKey: ['audit'], queryFn: () => api.get('/settings/audit') });
  return (
    <div className="space-y-4">
      <Card className="p-5 text-sm space-y-2">
        <p className="font-semibold flex items-center gap-2"><ShieldCheck className="size-4 text-brand-600" />Proteção de dados (LGPD)</p>
        <ul className="list-disc pl-5 text-ink/80 space-y-1">
          <li>Finalidade: reativação comercial de pessoas que já mantiveram relacionamento com a Aldeia (legítimo interesse), com registro de todas as abordagens.</li>
          <li>Acesso por perfil: vendedoras veem apenas contatos atribuídos a elas; exportações e visualizações são auditadas.</li>
          <li>Pedidos de não contato (opt-out) bloqueiam o contato em todas as campanhas, atuais e futuras.</li>
          <li>Direitos do titular: exportação dos dados e anonimização disponíveis na ficha do contato.</li>
          <li>Nenhuma mensagem é enviada automaticamente; o envio é manual pelo CowPilot.</li>
        </ul>
      </Card>
      <Card>
        <CardHeader title="Registro de atividades" subtitle="Últimos 200 eventos" />
        {isLoading ? <Loading /> : (
          <div className="overflow-x-auto max-h-[60vh] scroll-thin">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-white"><tr className="text-[12px] text-muted border-y border-line text-left"><th className="font-medium px-5 py-2">Quando</th><th className="font-medium px-2">Quem</th><th className="font-medium px-2">Ação</th><th className="font-medium px-5">Detalhes</th></tr></thead>
              <tbody>{data.map((a) => (
                <tr key={a.id} className="border-b border-line/60">
                  <td className="px-5 py-1.5 whitespace-nowrap text-muted">{fmtDateTime(a.created_at)}</td><td className="px-2">{a.user_name || '—'}</td>
                  <td className="px-2">{ACTION_LABEL[a.action] || a.action.replaceAll('_', ' ')}{a.entity_id ? <span className="text-muted"> #{a.entity_id}</span> : ''}</td>
                  <td className="px-5 text-muted truncate max-w-md">{Object.keys(a.details || {}).length ? JSON.stringify(a.details).slice(0, 140) : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
