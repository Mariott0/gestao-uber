import { fechamento, PASSE, FAIXA } from './calculos.js';
import './modo-app.js';

const el = id => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formato = new Intl.NumberFormat('pt-BR', { useGrouping: false, maximumFractionDigits: 6 });
const dinheiro = valor => brl.format(valor / 100);
const dataBR = data => data.split('-').reverse().join('/');
const diaForm = el('dia-form');
const abastecimentoForm = el('abastecimento-form');
const totalAbastecido = el('total-abastecido');
const passeForm = el('passe-form');
const configForm = el('config-form');
let estado;
let editando;
let abastecimentoEditando;

function no(tag, texto, classe) {
  const elemento = document.createElement(tag);
  elemento.textContent = texto;
  if (classe) elemento.className = classe;
  return elemento;
}

async function api(caminho, metodo = 'GET', dados) {
  const resposta = await fetch(caminho, metodo === 'GET' ? { cache: 'no-store' } : {
    method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
  });
  if (resposta.status === 401) {
    voltarParaLogin();
    throw new Error('Sua sessão terminou.');
  }
  if (resposta.status === 204) return;
  const resultado = await resposta.json();
  if (!resposta.ok) throw new Error(resultado.erro || 'Erro ao acessar o painel.');
  return resultado;
}

function voltarParaLogin() {
  el('painel').hidden = true;
  location.replace('/login');
}

function renderizar(novoEstado) {
  estado = novoEstado;
  el('liquido').textContent = dinheiro(estado.totais.liquido);
  el('faturamento').textContent = dinheiro(estado.totais.faturamento);
  if (totalAbastecido) totalAbastecido.textContent = dinheiro(estado.totais.abastecido ?? 0);
  el('progresso').textContent = dinheiro(estado.progresso);
  el('barra').value = estado.progresso;
  el('faixas').textContent = `${estado.faixas} faixa(s) atingida(s) · faltam ${dinheiro(FAIXA - estado.progresso)} para a próxima`;
  el('metas').replaceChildren(...[['semanal', 'Semana'], ['mensal', 'Mês']].map(([chave, nome]) => {
    const meta = estado.metas[chave];
    const card = no('div', '', 'goal');
    const alvo = estado.config[chave];
    const restante = meta.restantes === 1 ? '1 dia planejado restante' : `${meta.restantes} dias planejados restantes`;
    card.append(no('strong', `${nome} · ${dinheiro(meta.liquido)} de líquido`));
    if (alvo) {
      card.append(no('p', `Meta ${dinheiro(alvo)} · faltam ${dinheiro(meta.falta)}`, 'muted'));
      card.append(no('p', meta.porDia === null ? 'Nenhum dia planejado restante' :
        `${dinheiro(meta.porDia)} por dia · ${restante}`, 'muted'));
    } else {
      card.append(no('p', 'Meta a definir nas configurações', 'muted'));
    }
    return card;
  }));

  const abastecimentos = abastecimentoForm ? (estado.abastecimentos ?? []) : [];
  const itens = [
    ...estado.dias.map(dia => ({ ...dia, tipo: 'dia' })),
    ...abastecimentos.map(abastecimento => ({ ...abastecimento, tipo: 'abastecimento' })),
    ...estado.pagamentos.map(pagamento => ({ ...pagamento, tipo: 'pagamento' }))
  ].sort((a, b) => b.data.localeCompare(a.data));
  el('historico').replaceChildren(...itens.map(item => {
    const linha = no('div', '', 'entry');
    const detalhes = no('div', '');
    const valores = no('div', '', 'entry-actions');
    if (item.tipo === 'dia') {
      detalhes.append(no('strong', dataBR(item.data)),
        no('p', `${dinheiro(item.faturamento)} bruto · ${formato.format(item.km)} km`, 'muted'));
      if (item.observacao) detalhes.append(no('p', item.observacao, 'muted'));
      const editar = no('button', 'Editar', 'secondary');
      editar.setAttribute('aria-label', `Editar fechamento de ${dataBR(item.data)}`);
      editar.addEventListener('click', async () => {
        if (await carregar()) abrirDia(estado.dias.find(dia => dia.id === item.id));
      });
      valores.append(no('strong', dinheiro(item.liquido), item.liquido < 0 ? 'negative' : 'net'), editar);
    } else if (item.tipo === 'abastecimento') {
      const volume = item.litros === null ? '' : ` · ${formato.format(item.litros)} L`;
      detalhes.append(no('strong', dataBR(item.data)), no('p', `Abastecimento${volume}`, 'muted'));
      const editar = no('button', 'Editar', 'secondary');
      editar.setAttribute('aria-label', `Editar abastecimento de ${dataBR(item.data)}, ${dinheiro(item.valor)}`);
      editar.addEventListener('click', async () => {
        if (await carregar() && !el('abastecimento-dialog').open) {
          const abastecimento = estado.abastecimentos?.find(registro => registro.id === item.id);
          if (abastecimento) abrirAbastecimento(abastecimento);
        }
      });
      valores.append(no('strong', dinheiro(item.valor)), editar);
    } else {
      detalhes.append(no('strong', dataBR(item.data)), no('p', 'Pagamento do passe', 'muted'));
      valores.append(no('strong', dinheiro(item.valor)));
    }
    linha.append(detalhes, valores);
    return linha;
  }));
  el('painel').hidden = false;
  el('registrar').disabled = false;
  el('abrir-config').disabled = false;
}

function abrir(form, campos) {
  form.reset();
  form.querySelector('.erro').hidden = true;
  for (const [campo, valor] of Object.entries(campos)) form.elements[campo].value = valor;
  if (form.elements.data) form.elements.data.max = estado.hoje;
  form.closest('dialog').showModal();
}

function abrirDia(dia) {
  editando = dia;
  el('dia-titulo').textContent = dia ? 'Editar fechamento' : 'Registrar dia';
  abrir(diaForm, dia ? {
    data: dia.data, faturamento: formato.format(dia.faturamento / 100), km: formato.format(dia.km),
    consumo: formato.format(dia.consumo), unidade: dia.unidade, preco: formato.format(dia.preco),
    despesas: formato.format(dia.despesas / 100), observacao: dia.observacao
  } : { data: estado.hoje, preco: formato.format(estado.config.preco) });
  atualizarEstimativa();
}

function abrirAbastecimento(abastecimento) {
  abastecimentoEditando = abastecimento;
  el('abastecimento-titulo').textContent = abastecimento ? 'Editar abastecimento' : 'Registrar abastecimento';
  abrir(abastecimentoForm, abastecimento ? {
    data: abastecimento.data,
    valor: formato.format(abastecimento.valor / 100),
    litros: abastecimento.litros === null ? '' : formato.format(abastecimento.litros)
  } : { data: estado.hoje });
}

function atualizarEstimativa() {
  const saida = el('estimativa');
  try {
    const dados = Object.fromEntries(new FormData(diaForm));
    const estimativa = fechamento(dados, editando?.passe, editando?.faixa);
    saida.replaceChildren(no('strong', `Líquido estimado · ${dinheiro(estimativa.liquido)}`),
      no('small', `Gasolina ${dinheiro(estimativa.gasolina)} · Passe ${dinheiro(estimativa.reserva)} · Despesas ${dinheiro(estimativa.despesas)}`));
  } catch {
    saida.textContent = 'Preencha os valores para ver a estimativa.';
  }
}

function salvar(form, enviar, mensagem) {
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    const erro = form.querySelector('.erro');
    const botao = form.querySelector('.submit');
    erro.hidden = true;
    botao.disabled = true;
    try {
      renderizar(await enviar(new FormData(form)));
      form.closest('dialog').close();
      el('status').textContent = mensagem;
    } catch (falha) {
      erro.textContent = falha.message === 'Failed to fetch' ? 'Conexão indisponível. Tente novamente.' : falha.message;
      erro.hidden = false;
    } finally {
      botao.disabled = false;
    }
  });
}

el('registrar').addEventListener('click', async () => {
  if (await carregar() && !el('dia-dialog').open) abrirDia();
});
el('registrar-abastecimento')?.addEventListener('click', async () => {
  if (await carregar() && !el('abastecimento-dialog').open) abrirAbastecimento();
});
el('anotar').addEventListener('click', async () => {
  if (await carregar() && !el('passe-dialog').open) abrir(passeForm, { data: estado.hoje, valor: formato.format(PASSE / 100) });
});
el('abrir-config').addEventListener('click', () => {
  const { preco, semanal, mensal, dias } = estado.config;
  abrir(configForm, { preco: formato.format(preco), semanal: formato.format(semanal / 100), mensal: formato.format(mensal / 100) });
  for (const caixa of configForm.elements.dias) caixa.checked = dias.includes(Number(caixa.value));
});
el('sair')?.addEventListener('click', async evento => {
  const botao = evento.currentTarget;
  botao.disabled = true;
  try {
    await api('/api/logout', 'POST', {});
    voltarParaLogin();
  } catch {
    el('status').textContent = 'Não foi possível sair. Tente novamente.';
    botao.disabled = false;
  }
});
document.querySelectorAll('[data-close]').forEach(botao => botao.addEventListener('click', () => botao.closest('dialog').close()));
document.querySelectorAll('input[inputmode="decimal"]').forEach(campo => {
  campo.addEventListener('focus', () => {
    if (campo.value) campo.select();
  });
  if (campo.enterKeyHint === 'next') {
    campo.addEventListener('keydown', evento => {
      if (evento.key !== 'Enter' || evento.isComposing) return;
      const controles = [...campo.form.elements];
      const proximo = controles.slice(controles.indexOf(campo) + 1)
        .find(controle => controle.matches('input, select, textarea') && !controle.disabled);
      if (proximo) {
        evento.preventDefault();
        proximo.focus();
      }
    });
  }
});
diaForm.addEventListener('input', atualizarEstimativa);
salvar(diaForm, dados => api(editando ? `/api/dias/${editando.id}` : '/api/dias',
  editando ? 'PUT' : 'POST', Object.fromEntries(dados)), 'Fechamento salvo.');
if (abastecimentoForm) {
  salvar(abastecimentoForm, dados => api(
    abastecimentoEditando ? `/api/abastecimentos/${abastecimentoEditando.id}` : '/api/abastecimentos',
    abastecimentoEditando ? 'PUT' : 'POST', Object.fromEntries(dados)), 'Abastecimento salvo.');
}
salvar(passeForm, dados => api('/api/pagamentos', 'POST', Object.fromEntries(dados)), 'Pagamento registrado.');
salvar(configForm, dados => api('/api/config', 'PUT', {
  ...Object.fromEntries(dados), dias: dados.getAll('dias').map(Number)
}), 'Configurações salvas.');

async function carregar() {
  try {
    renderizar(await api('/api/painel'));
    el('status').textContent = '';
    return true;
  } catch {
    el('status').textContent = 'Painel indisponível. Confira a conexão e recarregue a página.';
    return false;
  }
}
carregar();
window.addEventListener('pagehide', () => { el('painel').hidden = true; });
window.addEventListener('pageshow', evento => {
  if (evento.persisted) carregar();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !document.querySelector('dialog[open]')) carregar();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(console.error);
