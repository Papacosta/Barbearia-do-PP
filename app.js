/* ══ Barbearia do PP — agendamento ══════════════════════════════════════
   Tudo roda no navegador: contas e histórico ficam em localStorage.
   ════════════════════════════════════════════════════════════════════ */
'use strict';

const SERVICOS = {
  corte:   { nome: 'Cortar cabelo',  dur: 45, preco: 70,  nota: 'Degradê, social ou à máquina.' },
  barba:   { nome: 'Fazer a barba',   dur: 30, preco: 45,  nota: 'Toalha quente, navalha e bálsamo.' },
  combo:   { nome: 'Cabelo e barba', dur: 60, preco: 100, nota: 'O mais pedido. Sai R$ 15 mais barato que separado.' },
  pintura: { nome: 'Pintar cabelo',  dur: 90, preco: 180, nota: 'Cor, balayage ou cobre na raiz.' },
};

// 0 = domingo … 6 = sábado
const HORARIOS = {
  0: ['09:00', '16:00'],
  1: ['09:00', '20:00'],
  2: ['09:00', '20:00'],
  3: ['09:00', '20:00'],
  4: ['09:00', '20:00'],
  5: ['09:00', '20:00'],
  6: ['08:00', '18:00'],
};
const NOMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const NOMES_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PASSO = 30;
const CHAVE = 'barbearia-do-pp:v1';

const $ = (id) => document.getElementById(id);

/* ── estado ─────────────────────────────────────────────────────────────── */
const estado = {
  servico: null,
  diaISO: null,
  hora: null,
  conta: null,
  diaHero: null,
  editando: null,
  ultimo: null,
};

/* ── persistência ───────────────────────────────────────────────────────── */
const banco = {
  ler(chave, padrao) {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto ? JSON.parse(bruto) : padrao;
    } catch { return padrao; }
  },
  gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* navegação privada */ }
  },
};
const contas = () => banco.ler(CHAVE + ':contas', []);
const cortes = () => banco.ler(CHAVE + ':cortes', []);
const salvarContas = (v) => banco.gravar(CHAVE + ':contas', v);
const salvarCortes = (v) => banco.gravar(CHAVE + ':cortes', v);

// resumo simples: não é criptografia, só evita senha em texto puro no storage
function digerir(txt) {
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) >>> 0;
  return 'c' + h.toString(36);
}

/* ── validação ──────────────────────────────────────────────────────────── */
const soDigitos = (v) => v.replace(/\D/g, '');
const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim());
const telefoneValido = (v) => {
  const d = soDigitos(v);
  return (d.length === 10 || d.length === 11) && d[0] !== '0';
};
const nomeValido = (v) => v.trim().length >= 3 && /\s/.test(v.trim());
const chaveEmail = (v) => v.trim().toLowerCase();
const buscarConta = (email) => contas().find((c) => c.email === chaveEmail(email)) || null;
const donoDoTelefone = (tel) => {
  const d = soDigitos(tel);
  return contas().find((c) => soDigitos(c.telefone) === d) || null;
};

function mascararTel(v) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/* ── agenda ─────────────────────────────────────────────────────────────── */
const minutosDe = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const horaDe = (mins) => String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
const diaDaSemanaDe = (iso) => new Date(iso + 'T12:00:00').getDay();
const isoDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hojeISO = () => isoDe(new Date());

function rotuloDia(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  });
}
function proximosDias(n) {
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return isoDe(d);
  });
}
function jaPassou(iso, hhmm) {
  const hoje = hojeISO();
  if (iso < hoje) return true;
  if (iso > hoje) return false;
  return minutosDe(hhmm) <= new Date().getHours() * 60 + new Date().getMinutes();
}
// o horário vale só se o serviço inteiro couber antes do fechamento
function cabe(iso, hhmm) {
  const servico = SERVICOS[estado.servico];
  if (!servico) return true;
  return minutosDe(hhmm) + servico.dur <= minutosDe(HORARIOS[diaDaSemanaDe(iso)][1]);
}
function ocupado(iso, hhmm) {
  const servico = SERVICOS[estado.servico];
  if (!servico) return false;
  const ini = minutosDe(hhmm);
  const fim = ini + servico.dur;
  return cortes().some((c) => {
    if (c.cancelado || c.id === estado.editando) return false;
    if (c.diaISO !== iso) return false;
    const cIni = minutosDe(c.hora);
    return cIni < fim && cIni + SERVICOS[c.servicoId].dur > ini;
  });
}
function horarioLivre(iso, hhmm) {
  return cabe(iso, hhmm) && !ocupado(iso, hhmm) && !jaPassou(iso, hhmm);
}
function slotsDoDia(iso) {
  const [abre, fecha] = HORARIOS[diaDaSemanaDe(iso)];
  const saida = [];
  for (let m = minutosDe(abre); m + PASSO <= minutosDe(fecha); m += PASSO) saida.push(horaDe(m));
  return saida;
}
const livresDoDia = (iso) => slotsDoDia(iso).filter((h) => horarioLivre(iso, h));
function primeiroDiaComVaga() {
  return proximosDias(21).find((iso) => livresDoDia(iso).length) || proximosDias(1)[0];
}
function quandoTexto(iso) {
  if (iso === hojeISO()) return 'hoje';
  if (iso === proximosDias(2)[1]) return 'amanhã';
  return 'na ' + NOMES[diaDaSemanaDe(iso)].toLowerCase();
}
function rotuloAgenda(iso) {
  const data = new Date(iso + 'T12:00:00');
  const perto = iso === hojeISO() || iso === proximosDias(2)[1];
  const campos = perto ? { weekday: 'long', day: 'numeric' } : { weekday: 'long', day: 'numeric', month: 'long' };
  const prefixo = iso === hojeISO() ? 'Hoje, ' : iso === proximosDias(2)[1] ? 'Amanhã, ' : '';
  return prefixo + data.toLocaleDateString('pt-BR', campos);
}

/* ── texto ──────────────────────────────────────────────────────────────── */
const brl = (v) => 'R$ ' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const duracaoTexto = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`);

/* ── teclado dos grupos de escolha (setas, Home, End) ──────────────────── */
function tecladoDeRadio(alvo) {
  alvo.addEventListener('keydown', (ev) => {
    const teclas = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!teclas.includes(ev.key)) return;
    const itens = [...alvo.querySelectorAll('[role="radio"]')];
    const atual = itens.indexOf(document.activeElement);
    if (atual < 0) return;
    ev.preventDefault();
    const passo = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 1;
    const ultimo = itens.length - 1;
    const proximo = ev.key === 'Home' ? 0 : ev.key === 'End' ? ultimo : (atual + passo + itens.length) % itens.length;
    itens[proximo].focus();
    itens[proximo].click();
  });
}

/* ══ lousa de preços ══════════════════════════════════════════════════════ */
function montarLousa() {
  $('lousa').innerHTML = Object.entries(SERVICOS).map(([id, s]) => `
    <li>
      <button class="lousa__linha" type="button" role="radio" data-servico="${id}" aria-checked="false">
        <span class="lousa__nome">${s.nome} <span class="lousa__dur">${s.dur} min</span></span>
        <span class="lousa__guia"></span>
        <span class="lousa__preco">${brl(s.preco)}</span>
      </button>
    </li>`).join('');

  $('lousa').addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-servico]');
    if (!botao) return;
    escolherServico(botao.dataset.servico);
    irParaAgendamento();
  });
}

function montarEscolhas() {
  $('escolhasServico').innerHTML = Object.entries(SERVICOS).map(([id, s]) => `
    <button class="escolha" type="button" role="radio" data-servico="${id}" aria-checked="false">
      <span class="escolha__nome">${s.nome}</span>
      <span class="escolha__linha">
        <span class="escolha__meta">${s.dur} min</span>
        <span class="escolha__preco">${brl(s.preco)}</span>
      </span>
    </button>`).join('');

  $('escolhasServico').addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-servico]');
    if (botao) escolherServico(botao.dataset.servico);
  });
}

function escolherServico(id) {
  estado.servico = id;
  // o serviço mudou: o horário guardado pode não caber mais no dia
  if (estado.diaISO && estado.hora && !horarioLivre(estado.diaISO, estado.hora)) estado.hora = null;
  atualizarTudo();
}

/* ══ vitrine: a agenda do dia é a capa ════════════════════════════════════ */
function montarHoje() {
  const hoje = hojeISO();
  const temHoje = livresDoDia(hoje).length > 0;
  const iso = temHoje ? hoje : primeiroDiaComVaga();
  const [abre, fecha] = HORARIOS[diaDaSemanaDe(iso)];
  const slots = slotsDoDia(iso);
  const livres = livresDoDia(iso);
  const visiveis = slots.slice(0, 12);

  $('hojeDia').textContent = rotuloAgenda(iso);
  $('hojeJanela').textContent = `${abre} às ${fecha}`;
  $('hojeSlots').innerHTML = visiveis.map((h) => `
    <button class="chip" type="button" role="radio" data-hojehora="${h}" aria-checked="false"
      ${horarioLivre(iso, h) ? '' : 'disabled'}>${h}</button>`).join('');

  $('hojeNota').textContent = !livres.length
    ? 'Sem horário livre nos próximos dias. Ligue para a gente: (62) 4002-8922.'
    : temHoje
      ? `${livres.length} horários livres hoje${slots.length > visiveis.length ? ', mostrando os primeiros' : ''}. Toque num para começar por ele.`
      : `Hoje não sobrou vaga. Estes ${livres.length} horários são ${quandoTexto(iso)}. Toque num para marcar.`;

  estado.diaHero = iso;
}

function clicarHero(ev) {
  const chip = ev.target.closest('[data-hojehora]');
  if (!chip) return;
  estado.diaISO = estado.diaHero;
  estado.hora = chip.dataset.hojehora;
  atualizarTudo();
  irParaAgendamento();
}

/* ══ dias e horários ═════════════════════════════════════════════════════ */
function montarDias() {
  $('dias').innerHTML = proximosDias(14).map((iso) => {
    const d = new Date(iso + 'T12:00:00');
    const [abre, fecha] = HORARIOS[d.getDay()];
    const livres = livresDoDia(iso).length;
    return `
      <button class="dia" type="button" role="radio" data-dia="${iso}" aria-checked="false">
        <span class="dia__sem">${NOMES_CURTO[d.getDay()]}</span>
        <span class="dia__num">${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}</span>
        <span class="dia__janela">${abre}–${fecha}</span>
        <span class="dia__livre">${livres ? `${livres} livres` : 'esgotado'}</span>
      </button>`;
  }).join('');
}

function clicarDia(ev) {
  const botao = ev.target.closest('[data-dia]');
  if (!botao) return;
  estado.diaISO = botao.dataset.dia;
  if (estado.hora && !horarioLivre(estado.diaISO, estado.hora)) estado.hora = null;
  atualizarTudo();
}

function montarSlots() {
  const iso = estado.diaISO;
  const alvo = $('slots');

  if (!iso) {
    alvo.innerHTML = '<p class="passo__ajuda">Escolha um dia acima para ver os horários.</p>';
    $('ajudaDia').textContent = 'Horários livres de domingo a sábado.';
    return;
  }

  const d = new Date(iso + 'T12:00:00');
  const [abre, fecha] = HORARIOS[d.getDay()];
  const slots = slotsDoDia(iso);
  const livres = slots.filter((h) => horarioLivre(iso, h));

  $('ajudaDia').textContent = `${rotuloDia(iso)}, aberto das ${abre} às ${fecha}.`;

  if (!livres.length) {
    alvo.innerHTML = `<p class="passo__ajuda">Dia cheio: os ${slots.length} horários já passaram ou estão tomados. Tente o dia seguinte.</p>`;
    return;
  }

  alvo.innerHTML = slots.map((h) => {
    const ok = horarioLivre(iso, h);
    const motivo = !cabe(iso, h) ? 'Não sobra tempo para o serviço antes de fechar'
      : ocupado(iso, h) ? 'Já reservado'
        : jaPassou(iso, h) ? 'Horário que já passou' : '';
    return `<button class="horario" type="button" role="radio" data-hora="${h}" aria-checked="false" ${ok ? '' : 'disabled'} title="${motivo}">${h}</button>`;
  }).join('');
}

function clicarHorario(ev) {
  const botao = ev.target.closest('[data-hora]');
  if (!botao || botao.disabled) return;
  estado.hora = botao.dataset.hora;
  atualizarTudo();
}

/* ══ trilha, resumo e sincronia ═══════════════════════════════════════════ */
function atualizarTudo() {
  const servico = estado.servico ? SERVICOS[estado.servico] : null;
  const temHora = !!(estado.diaISO && estado.hora);

  document.querySelectorAll('[data-servico]').forEach((el) =>
    el.setAttribute('aria-checked', String(el.dataset.servico === estado.servico)));
  document.querySelectorAll('[data-dia]').forEach((el) =>
    el.setAttribute('aria-checked', String(el.dataset.dia === estado.diaISO)));

  // o chip da capa fica marcado quando o horário escolhido é o do dia que ela mostra
  const marcadoHero = estado.diaISO === estado.diaHero && !!estado.hora;
  document.querySelectorAll('[data-hojehora]').forEach((el) =>
    el.setAttribute('aria-checked', String(marcadoHero && el.dataset.hojehora === estado.hora)));

  montarSlots();
  document.querySelectorAll('[data-hora]').forEach((el) =>
    el.setAttribute('aria-checked', String(!!estado.hora && el.dataset.hora === estado.hora)));

  const rotDia = estado.diaISO ? rotuloDia(estado.diaISO) : '';
  $('trilhaServico').textContent = servico ? `${servico.nome}, ${brl(servico.preco)}` : '—';
  $('trilhaHorario').textContent = temHora ? `${rotDia}, ${estado.hora}` : '—';
  $('trilhaDados').textContent = estado.conta ? estado.conta.nome : ($('fNome').value.trim() || '—');
  $('trilha1').classList.toggle('trilha__item--feito', !!servico);
  $('trilha2').classList.toggle('trilha__item--feito', temHora);
  $('trilha3').classList.toggle('trilha__item--feito', !!estado.conta);

  $('rServico').textContent = servico ? servico.nome : 'Escolha acima';
  $('rDia').textContent = rotDia || '—';
  $('rHora').textContent = estado.hora || '—';
  $('rDuracao').textContent = servico ? duracaoTexto(servico.dur) : '—';
  $('rTotal').textContent = brl(servico ? servico.preco : 0);
  $('resumoNota').textContent = !servico
    ? 'Escolha um serviço para ver o total.'
    : !temHora
      ? 'Escolha o horário para fechar a reserva.'
      : servico.nota;

  const pronto = !!(servico && temHora);
  $('btnConfirmar').disabled = !pronto;
  $('btnConfirmar').textContent = pronto ? `Confirmar ${estado.hora}` : 'Confirmar horário';
}

function irParaAgendamento(focarEm) {
  limparAvisoConta();
  const topo = $('agendar').getBoundingClientRect().top + window.scrollY - 16;
  window.scrollTo({ top: topo, behavior: 'smooth' });
  const alvo = focarEm || (estado.servico && estado.diaISO && estado.hora ? $('fNome') : $('dias'));
  setTimeout(() => alvo.focus({ preventScroll: true }), 420);
}

/* ══ conta em uso no agendamento ═════════════════════════════════════════ */
function avisar(titulo, texto, acao, aoClicar) {
  $('avisos').innerHTML = `
    <div class="aviso">
      <strong class="aviso__tit">${titulo}</strong>
      ${acao ? `<button class="linkbotao aviso__acao" type="button" id="btnAvisoAcao">${acao}</button>` : ''}
      <p class="aviso__txt">${texto}</p>
    </div>`;
  $('btnAvisoAcao').onclick = aoClicar || irParaConta;
}
const limparAviso = () => { $('avisos').innerHTML = ''; };

// com conta, os campos somem e mostramos para quem é a reserva
function mostrarQuem() {
  const logado = !!estado.conta;
  $('campos').hidden = logado;
  $('quem').hidden = !logado;
  // a confirmacao pendente era de outra pessoa: volta para o formulario
  $('formDados').hidden = false;
  $('confirmacao').hidden = true;
  $('cancela').hidden = true;
  if (logado) {
    $('quemTexto').textContent = `${estado.conta.nome} · ${mascararTel(estado.conta.telefone)} · ${estado.conta.email}`;
  } else {
    $('fNome').value = '';
    $('fTel').value = '';
    $('fEmail').value = '';
  }
  atualizarTudo();
}

function trocarPessoa() {
  estado.conta = null;
  mostrarQuem();
  desenharConta();
  $('fNome').focus();
}

// e-mail já cadastrado: em vez de pedir senha aqui, mandamos para a conta
function checarEmail() {
  const email = $('fEmail').value;
  if (!emailValido(email)) return;
  if (!buscarConta(email)) { limparAviso(); return; }

  avisar('Esse e-mail já tem conta aqui', 'Entre com a senha para reservar com os seus dados e guardar o corte no histórico.',
    'Entrar na conta');
}

const limparAvisoConta = () => { $('avisoContaCriada').innerHTML = ''; };

function irParaConta() {
  const topo = $('conta').getBoundingClientRect().top + window.scrollY - 16;
  window.scrollTo({ top: topo, behavior: 'smooth' });
  setTimeout(() => {
    const alvo = $('areaVisitante').hidden ? $('btnSair') : $('eEmail');
    alvo.focus({ preventScroll: true });
  }, 420);
}

/* ── erros ──────────────────────────────────────────────────────────────── */
function erro(id, mensagem) {
  const alvo = $(id);
  if (!alvo) return;
  alvo.textContent = mensagem || '';
  const entrada = alvo.parentElement.querySelector('.campo__entrada');
  if (entrada) entrada.classList.toggle('campo__entrada--ruim', !!mensagem);
}
const limparErros = () => ['erroNome', 'erroTel', 'erroEmail', 'erroGeral'].forEach((id) => erro(id, ''));

/* ══ confirmar ═════════════════════════════════════════════════════════════ */
$('formDados').addEventListener('submit', (ev) => {
  ev.preventDefault();
  limparErros();
  limparAviso();

  if (!estado.servico || !estado.diaISO || !estado.hora) {
    $('erroGeral').textContent = 'Escolha o serviço, o dia e a hora antes de confirmar.';
    return;
  }

  // com conta: os dados já estão guardados
  if (estado.conta) {
    registrarCorte({ nome: estado.conta.nome, telefone: estado.conta.telefone, email: estado.conta.email });
    return;
  }

  const nome = $('fNome').value.trim();
  const telefone = $('fTel').value.trim();
  const email = $('fEmail').value.trim();

  let ok = true;
  if (!nomeValido(nome)) { erro('erroNome', 'Escreva nome e sobrenome, como você pede no salão.'); ok = false; }
  if (!telefoneValido(telefone)) { erro('erroTel', 'Com DDD e 10 ou 11 dígitos. Ex.: (62) 91234-5678.'); ok = false; }
  if (!emailValido(email)) { erro('erroEmail', 'Esse e-mail não parece completo. Ex.: voce@email.com'); ok = false; }
  if (!ok) return;

  const contaExistente = buscarConta(email);
  if (contaExistente) {
    erro('erroEmail', `${email} já tem conta aqui. Entre com a senha para reservar.`);
    irParaConta();
    return;
  }
  const dono = donoDoTelefone(telefone);
  if (dono) {
    erro('erroTel', `Esse telefone já é da conta ${dono.email}. Entre por ela para não duplicar.`);
    irParaConta();
    return;
  }

  registrarCorte({ nome, telefone, email });
});

function registrarCorte({ nome, telefone, email }) {
  const servico = SERVICOS[estado.servico];
  const edicao = estado.editando ? cortes().find((c) => c.id === estado.editando) : null;

  let corte;
  if (edicao) {
    corte = { ...edicao, diaISO: estado.diaISO, hora: estado.hora, preco: servico.preco,
      nome, telefone, email: chaveEmail(email),
      conta: estado.conta ? estado.conta.email : edicao.conta,
      cancelado: false, remarcadoEm: new Date().toISOString() };
    salvarCortes(cortes().map((c) => (c.id === corte.id ? corte : c)));
  } else {
    corte = {
      id: 'c' + Date.now().toString(36),
      diaISO: estado.diaISO,
      hora: estado.hora,
      servicoId: estado.servico,
      preco: servico.preco,
      nome,
      telefone,
      email: chaveEmail(email),
      conta: estado.conta ? estado.conta.email : null,
      criadoEm: new Date().toISOString(),
    };
    salvarCortes([...cortes(), corte]);
  }

  estado.editando = null;
  estado.ultimo = corte.id;

  mostrarConfirmacao(corte, { remarcado: !!edicao, contato: { nome, email } });

  montarDias();
  montarHoje();
  atualizarTudo();
  desenharConta();
  $('confirmacao').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ══ remarcar e cancelar ══════════════════════════════════════════════════ */
const seloConfere = 'M14 25l7 7 14-16';
const seloCancela = 'M17 17l14 14M31 17L17 31';

function limparAjuste() {
  $('cancela').hidden = true;
  $('confirmacao').classList.remove('confirmacao--cancelado');
  $('seloMarca').setAttribute('d', seloConfere);
  $('confirmacaoTitulo').textContent = 'Cadeira guardada';
}

function mostrarConfirmacao(corte, { remarcado = false, contato } = {}) {
  const s = SERVICOS[corte.servicoId];
  const quem = contato || { nome: corte.nome, email: corte.email };
  const primeiro = String(quem.nome).split(' ')[0];

  limparAjuste();
  $('formDados').hidden = true;
  $('confirmacao').hidden = false;

  $('confirmacaoTitulo').textContent = remarcado ? 'Horário remarcado' : 'Cadeira guardada';
  $('confirmacaoTexto').textContent = remarcado
    ? `${primeiro}, a cadeira mudou de horário e continua no seu histórico.`
    : corte.conta
      ? `${primeiro}, a cadeira está guardada e o corte já entrou no seu histórico. A confirmação vai para ${quem.email}.`
      : `${primeiro}, a cadeira está guardada. Crie sua conta no topo da página para guardar o histórico e repetir seus cortes em um clique.`;

  $('confirmacaoLista').innerHTML = `
    <div class="confirmacao__par"><dt>Serviço</dt><dd>${s.nome}, ${duracaoTexto(s.dur)}</dd><dd><b>${brl(corte.preco)}</b></dd></div>
    <div class="confirmacao__par"><dt>Quando</dt><dd>${rotuloDia(corte.diaISO)} às ${corte.hora}</dd><dd></dd></div>
    <div class="confirmacao__par"><dt>Onde</dt><dd>Av. T-9, 1418, Jardim América, Goiânia</dd><dd></dd></div>
    <div class="confirmacao__par"><dt>Contato</dt><dd>${mascararTel(corte.telefone)}, ${quem.email}</dd><dd></dd></div>`;

  $('grupoAjustes').hidden = false;
}

// abre o formulário com o serviço já escolhido para trocar só o dia e a hora
function remarcar(corte) {
  if (!corte) return;
  estado.editando = corte.id;
  estado.ultimo = corte.id;
  estado.servico = corte.servicoId;
  estado.diaISO = corte.diaISO;
  estado.hora = horarioLivre(corte.diaISO, corte.hora) ? corte.hora : null;

  $('confirmacao').hidden = true;
  $('formDados').hidden = false;
  $('cancela').hidden = true;

  avisar('Remarcando', 'Escolha o novo dia e horário abaixo. Nada muda até você confirmar, e o horário antigo continua reservado para você.',
    'Desfazer', desfazerEdicao);

  montarDias();
  montarHoje();
  atualizarTudo();
  irParaAgendamento();
}

function desfazerEdicao() {
  const corte = cortes().find((c) => c.id === estado.editando);
  estado.editando = null;
  limparAviso();
  if (!corte) return;
  estado.servico = corte.servicoId;
  estado.diaISO = corte.diaISO;
  estado.hora = corte.hora;
  estado.ultimo = corte.id;
  mostrarConfirmacao(corte);
  montarDias();
  montarHoje();
  atualizarTudo();
}

function perguntarCancelamento(corte) {
  if (!corte) return;
  const s = SERVICOS[corte.servicoId];
  $('cancelaTexto').innerHTML =
    `Cancelar <b>${s.nome}</b> de <b>${rotuloDia(corte.diaISO)} às ${corte.hora}</b>? O horário volta a ficar livre e o corte fica riscado no histórico.`;
  $('cancela').hidden = false;
  $('btnCancelaSim').focus();
}

function cancelarCorte(corte) {
  if (!corte) return;
  salvarCortes(cortes().map((c) => (c.id === corte.id ? { ...c, cancelado: true, canceladoEm: new Date().toISOString() } : c)));

  $('cancela').hidden = true;
  $('grupoAjustes').hidden = true;
  $('confirmacao').classList.add('confirmacao--cancelado');
  $('confirmacaoTitulo').textContent = 'Horário cancelado';
  $('confirmacaoTexto').textContent = `${rotuloDia(corte.diaISO)} às ${corte.hora} voltou a ficar livre. Mudou de ideia? É só remarcar.`;

  montarDias();
  montarHoje();
  atualizarTudo();
  desenharConta();
}

$('btnRemarcar').addEventListener('click', () => remarcar(cortes().find((c) => c.id === estado.ultimo)));
$('btnCancelar').addEventListener('click', () => perguntarCancelamento(cortes().find((c) => c.id === estado.ultimo)));
$('btnCancelaNao').addEventListener('click', () => { $('cancela').hidden = true; $('btnCancelar').focus(); });
$('btnCancelaSim').addEventListener('click', () => cancelarCorte(cortes().find((c) => c.id === estado.ultimo)));

$('btnOutro').addEventListener('click', () => {
  estado.editando = null;
  $('confirmacao').hidden = true;
  $('formDados').hidden = false;
  estado.hora = null;
  estado.diaISO = primeiroDiaComVaga();
  limparAjuste();
  atualizarTudo();
  irParaAgendamento();
});
$('btnVerHistorico').addEventListener('click', () => irParaConta());

/* ══ conta e histórico ════════════════════════════════════════════════════ */
function desenharConta() {
  const logado = !!estado.conta;
  $('areaVisitante').hidden = logado;
  $('areaLogado').hidden = !logado;
  if (!logado) { $('historico').innerHTML = ''; return; }

  $('logadoNome').textContent = estado.conta.nome;

  const meus = cortes()
    .filter((c) => c.conta === estado.conta.email)
    .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1))
    .slice(0, 6);

  if (!meus.length) {
    $('historico').innerHTML = `
      <div class="vazio">
        <p class="vazio__tit">Nenhum corte ainda</p>
        <p>Quando você confirmar um horário com a conta ${estado.conta.email}, ele aparece aqui para repetir.</p>
        <button class="botao botao--linha" type="button" id="btnPrimeiroCorte">Marcar meu primeiro corte</button>
      </div>`;
    $('btnPrimeiroCorte').onclick = () => irParaAgendamento();
    return;
  }

  $('historico').innerHTML = meus.map((c) => {
    const s = SERVICOS[c.servicoId];
    const [, mes, dia] = c.diaISO.split('-');
    const quando = `${NOMES_CURTO[diaDaSemanaDe(c.diaISO)]}, ${dia}/${mes}, ${c.hora}`;
    const acoes = c.cancelado
      ? `<span class="corte__tag">Cancelado</span>`
      : `<div class="corte__acoes">
           <button class="botao botao--linha" type="button" data-repetir="${c.id}">Repetir este corte</button>
           <button class="botao botao--linha botao--perigo" type="button" data-cancelar="${c.id}">Cancelar</button>
           <button class="botao botao--linha" type="button" data-remarcar="${c.id}">Remarcar</button>
         </div>`;
    return `
      <article class="corte${c.cancelado ? ' corte--cancelado' : ''}">
        <div>
          <p class="corte__quando">${quando}</p>
          <p class="corte__que">${s.nome}, ${duracaoTexto(s.dur)}</p>
        </div>
        <span class="corte__preco">${brl(c.preco)}</span>
        ${acoes}
      </article>`;
  }).join('');

  $('historico').onclick = (ev) => {
    const achar = (attr) => {
      const botao = ev.target.closest(`[${attr}]`);
      return botao ? cortes().find((c) => c.id === botao.getAttribute(attr)) : null;
    };
    if (ev.target.closest('[data-repetir]')) repetirCorte(achar('data-repetir'));
    else if (ev.target.closest('[data-remarcar]')) remarcar(achar('data-remarcar'));
    else if (ev.target.closest('[data-cancelar]')) {
      const corte = achar('data-cancelar');
      estado.ultimo = corte.id;
      mostrarConfirmacao(corte);
      perguntarCancelamento(corte);
      $('confirmacao').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
}

// mesmo serviço, mesmo dia da semana, na próxima ocorrência desse dia à frente
function repetirCorte(corte) {
  if (!corte) return;
  const diaIgual = proximosDias(30).find((iso) => iso > corte.diaISO && diaDaSemanaDe(iso) === diaDaSemanaDe(corte.diaISO));

  estado.editando = null;
  estado.servico = corte.servicoId;
  estado.diaISO = diaIgual;
  estado.hora = horarioLivre(diaIgual, corte.hora) ? corte.hora : null;

  $('confirmacao').hidden = true;
  $('formDados').hidden = false;

  montarDias();
  montarHoje();
  atualizarTudo();

  // vem depois de atualizarTudo, que reescreve esse mesmo texto
  $('ajudaDia').textContent = estado.hora
    ? `${rotuloDia(diaIgual)}: mesmo dia da semana e mesmo horário de sempre.`
    : `${rotuloDia(diaIgual)}: mesmo dia da semana, mas ${corte.hora} já está tomado. Escolha outro horário.`;

  irParaAgendamento();
}

/* ── entrar e criar conta ───────────────────────────────────────────────── */
$('formEntrar').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const email = $('eEmail').value.trim();
  const senha = $('eSenha').value;

  if (!emailValido(email)) { $('erroEntrar').textContent = 'Confira o e-mail antes de entrar.'; return; }
  const conta = buscarConta(email);
  if (!conta) {
    $('erroEntrar').textContent = 'Não existe conta com esse e-mail. Você pode criar uma no formulário ao lado.';
    return;
  }
  if (digerir(senha) !== conta.senha) { $('erroEntrar').textContent = 'Senha incorreta. Tente de novo.'; return; }

  estado.conta = conta;
  $('eSenha').value = '';
  $('erroEntrar').textContent = '';
  desenharConta();
  mostrarQuem();
});

$('formCriar').addEventListener('submit', (ev) => {
  ev.preventDefault();
  ['erroCNome', 'erroCTel', 'erroCEmail', 'erroCSenha'].forEach((id) => ($(id).textContent = ''));

  const nome = $('cNome').value.trim();
  const telefone = $('cTel').value.trim();
  const email = $('cEmail').value.trim();
  const senha = $('cSenha').value;

  if (!nomeValido(nome)) { $('erroCNome').textContent = 'Escreva nome e sobrenome.'; return; }
  if (!telefoneValido(telefone)) { $('erroCTel').textContent = 'Telefone com DDD, 10 ou 11 dígitos.'; return; }
  if (!emailValido(email)) { $('erroCEmail').textContent = 'E-mail incompleto.'; return; }
  if (buscarConta(email)) { $('erroCEmail').textContent = 'Já existe conta com esse e-mail. Entre com ela no formulário acima.'; return; }
  const dono = donoDoTelefone(telefone);
  if (dono) { $('erroCTel').textContent = `Esse telefone já é da conta ${dono.email}.`; return; }
  if (senha.length < 4) { $('erroCSenha').textContent = 'Use pelo menos 4 caracteres.'; return; }

  estado.conta = { email: chaveEmail(email), nome, telefone, senha: digerir(senha), criadoEm: new Date().toISOString() };
  salvarContas([...contas(), estado.conta]);
  ['cNome', 'cTel', 'cEmail', 'cSenha'].forEach((id) => ($(id).value = ''));
  desenharConta();
  mostrarQuem();
  if (!$('confirmacao').hidden) return;
  $('avisoContaCriada').innerHTML = `
    <div class="aviso">
      <strong class="aviso__tit">Conta criada</strong>
      <p class="aviso__txt">Pronto, ${estado.conta.nome.split(' ')[0]}. Da próxima vez é só entrar pelo e-mail, e o histórico aparece aqui.</p>
    </div>`;
});

$('btnSair').addEventListener('click', () => {
  estado.conta = null;
  mostrarQuem();
  desenharConta();
});

/* ══ wiring ═══════════════════════════════════════════════════════════════ */
$('fTel').addEventListener('input', (ev) => {
  const fim = ev.target.selectionStart === ev.target.value.length;
  ev.target.value = mascararTel(ev.target.value);
  if (!fim) ev.target.setSelectionRange(ev.target.value.length, ev.target.value.length);
});
$('cTel').addEventListener('input', (ev) => { ev.target.value = mascararTel(ev.target.value); });
$('fNome').addEventListener('input', atualizarTudo);
$('fEmail').addEventListener('blur', checarEmail);
$('btnTrocarPessoa').addEventListener('click', trocarPessoa);

(function iniciar() {
  montarLousa();
  montarEscolhas();
  $('slots').addEventListener('click', clicarHorario);
  $('dias').addEventListener('click', clicarDia);
  $('hojeSlots').addEventListener('click', clicarHero);
  tecladoDeRadio($('lousa'));
  tecladoDeRadio($('escolhasServico'));
  tecladoDeRadio($('dias'));
  tecladoDeRadio($('slots'));
  estado.diaISO = primeiroDiaComVaga();
  montarDias();
  montarHoje();
  mostrarQuem();

  const hoje = diaDaSemanaDe(hojeISO());
  $('tabelaHoras').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const [abre, fecha] = HORARIOS[d];
    const marca = d === hoje ? ' class="rodape__hoje"' : '';
    return `<tr${marca}><td>${NOMES[d]}</td><td>${abre} às ${fecha}</td></tr>`;
  }).join('');
})();
