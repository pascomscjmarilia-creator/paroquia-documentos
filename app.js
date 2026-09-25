// ============================================================
// CONFIGURAÇÃO — preencha estes valores antes de publicar
// ============================================================
const CONFIG = {
  // Client ID OAuth criado no Google Cloud Console (tela "Credenciais")
  CLIENT_ID: '172692599350-9ssc0ir4r4j4rtn3v7ksd5i6un41damc.apps.googleusercontent.com',

  // Planilha "Pascom_Controle" — usada pelas duas abas (Índice de Documentos e Recados)
  SHEET_ID: '1-9ZRasNVZK3qX3j51QffsZjOzI59axMkh4pCZxxhFws',
  DOCS_RANGE: 'Índice de Documentos!A2:F',
  RECADOS_RANGE: 'Recados!A2:G',
  RECADOS_ABA: 'Recados', // nome exato da aba, usado ao gravar o status de volta

  RESERVAS_RANGE: 'Reservas_Salas!A2:I',
  RESERVAS_ABA: 'Reservas_Salas',
  WEBHOOK_RESERVA: 'https://paroquia-scjm-n8n-paroquia.ndjgby.easypanel.host/webhook/reserva-sala',

  // Planilha "PascomSCJ_Marilia_Dados_Paroquia" (base de conhecimento do bot) — aba Informacoes_Extras
  SHEET_ID_DADOS: '1ac6la9wQEMkt_Q4MuazNeLNEAchLlOL9zwKGUuhdMFQ',
  EXTRAS_RANGE: 'Informacoes_Extras!A2:C',
  EXTRAS_ABA: 'Informacoes_Extras',

  // Inscrições da catequese (planilha Pascom_Controle) — gravadas pelo formulário catequese.html via n8n
  CATEQUESE_RANGE: 'Catequese_Inscricoes!A2:L',
  CATEQUESE_ABA: 'Catequese_Inscricoes',

  // E-mails autorizados a usar o app (checagem de UX — a segurança
  // de verdade é a permissão de compartilhamento da planilha no Google)
  ALLOWED_EMAILS: ['pascomscjmarilia@gmail.com'],
};
// ============================================================

let accessToken = null;
let linhasDocs = [];
let linhasRecados = [];
let linhasReservas = [];
let linhasExtras = [];
let linhasCatequese = [];
let extraEditandoLinha = null;

const el = (id) => document.getElementById(id);

function mostrarErroLogin(msg) {
  const erro = el('loginErro');
  erro.textContent = msg;
  erro.hidden = false;
}

function iniciarBotaoGoogle(tentativas) {
  tentativas = tentativas || 0;
  if (!window.google || !window.google.accounts) {
    // O script do Google carrega em paralelo (async) e pode ainda não
    // ter chegado quando a página termina de montar — tenta de novo por alguns segundos.
    if (tentativas < 20) {
      setTimeout(() => iniciarBotaoGoogle(tentativas + 1), 200);
      return;
    }
    mostrarErroLogin('Não foi possível carregar o login do Google. Verifique sua conexão com a internet e recarregue a página.');
    return;
  }

  try {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      // spreadsheets (não .readonly): precisamos gravar o Status ao marcar um recado como Resolvido.
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email',
      callback: async (resp) => {
        if (resp.error) {
          mostrarErroLogin('Não foi possível entrar com essa conta Google (' + resp.error + ').');
          return;
        }
        accessToken = resp.access_token;
        await handleLoginSucesso();
      },
    });

    // Botão próprio (mais confiável em GitHub Pages do que o widget padrão do GIS)
    const btn = document.createElement('button');
    btn.textContent = 'Entrar com Google';
    btn.className = 'btn-google';
    btn.style.cssText = 'background:#fff;border:1px solid #ccc;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:0.95rem;font-weight:600;color:#3c4043;';
    btn.onclick = () => {
      el('loginErro').hidden = true;
      tokenClient.requestAccessToken();
    };
    el('googleBtn').appendChild(btn);
  } catch (e) {
    mostrarErroLogin('Erro ao iniciar o login do Google: ' + e.message);
  }
}

async function handleLoginSucesso() {
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    const perfil = await resp.json();
    const email = (perfil.email || '').toLowerCase();

    if (!CONFIG.ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(email)) {
      mostrarErroLogin('Conta "' + email + '" não autorizada para este app.');
      accessToken = null;
      return;
    }

    el('userEmail').textContent = email;
    el('userBox').hidden = false;
    el('loginScreen').hidden = true;
    el('appScreen').hidden = false;

    await carregarDocumentos();
    await carregarRecados();
    await carregarReservas();
    await carregarExtras();
    await carregarCatequese();
  } catch (e) {
    mostrarErroLogin('Erro ao verificar sua conta. Tente novamente.');
  }
}

async function buscarValoresSheet(range, sheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId || CONFIG.SHEET_ID}/values/${encodeURIComponent(range)}`;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (resp.status === 403) throw new Error('SEM_PERMISSAO');
  if (!resp.ok) throw new Error('STATUS_' + resp.status);
  const data = await resp.json();
  return data.values || [];
}

async function carregarDocumentos() {
  const statusMsg = el('statusMsg');
  statusMsg.textContent = 'Carregando documentos...';

  try {
    const valores = await buscarValoresSheet(CONFIG.DOCS_RANGE);
    linhasDocs = valores
      .filter(row => row && row.length > 0)
      .map((row, idx) => ({
        ordem: idx, // posição original na planilha (desempate quando a data é igual)
        data: row[0] || '',
        nome: row[1] || '',
        numero: limparNumero(row[2]),
        tipo: row[3] || '',
        arquivo: row[4] || '',
        link: row[5] || '',
      }));

    statusMsg.textContent = linhasDocs.length + ' documento(s) encontrado(s).';
    renderizarTabela();
  } catch (e) {
    statusMsg.textContent = e.message === 'SEM_PERMISSAO'
      ? 'Sua conta Google não tem permissão de acesso a esta planilha. Peça para compartilhá-la com você.'
      : 'Erro ao carregar documentos.';
  }
}

async function carregarRecados() {
  const statusMsg = el('statusMsgRecados');
  statusMsg.textContent = 'Carregando recados...';

  try {
    const valores = await buscarValoresSheet(CONFIG.RECADOS_RANGE);
    // Mantém o número da linha real da planilha (RECADOS_RANGE começa em A2 → primeira linha = 2)
    // mesmo depois de filtrar linhas em branco, pra gravar o status de volta na célula certa.
    linhasRecados = valores
      .map((row, idx) => ({
        linha: idx + 2,
        data: row[1] || '',
        hora: row[2] || '',
        nome: row[3] || '',
        whatsapp: limparNumero(row[4]),
        assunto: row[5] || '',
        status: row[6] || '',
      }))
      .filter(l => l.nome || l.whatsapp || l.assunto);

    statusMsg.textContent = linhasRecados.length + ' recado(s) encontrado(s).';
    renderizarRecados();
  } catch (e) {
    statusMsg.textContent = e.message === 'SEM_PERMISSAO'
      ? 'Sua conta Google não tem permissão de acesso a esta planilha. Peça para compartilhá-la com você.'
      : 'Erro ao carregar recados.';
  }
}

function parseDataBR(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function dataBRparaISO(s) {
  const d = parseDataBR(s);
  if (!d) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Mesma regra do bot: sem data = vale sempre; data ilegível = não descarta; data passada = vencido.
function situacaoExtra(validoAte) {
  if (!validoAte) return 'semprazo';
  const d = parseDataBR(validoAte);
  if (!d) return 'ativo';
  const hoje = new Date();
  const hojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return d >= hojeZero ? 'ativo' : 'vencido';
}

async function carregarExtras() {
  const statusMsg = el('statusMsgExtras');
  statusMsg.textContent = 'Carregando informações extras...';

  try {
    const valores = await buscarValoresSheet(CONFIG.EXTRAS_RANGE, CONFIG.SHEET_ID_DADOS);
    // EXTRAS_RANGE começa em A2 → primeira linha = 2; guarda o número real da linha pra editar/excluir a célula certa.
    linhasExtras = valores
      .map((row, idx) => ({
        linha: idx + 2,
        assunto: row[0] || '',
        informacao: row[1] || '',
        validoAte: row[2] || '',
      }))
      .filter(l => l.assunto || l.informacao);

    statusMsg.textContent = linhasExtras.length + ' aviso(s) cadastrado(s).';
    renderizarExtras();
  } catch (e) {
    statusMsg.textContent = e.message === 'SEM_PERMISSAO'
      ? 'Sua conta Google não tem permissão de acesso à planilha de dados da paróquia. Peça para compartilhá-la com você (como editor).'
      : 'Erro ao carregar informações extras.';
  }
}

function renderizarExtras() {
  const termo = norm(el('buscaExtras').value.trim());
  const validadeFiltro = el('filtroValidade').value;

  const filtradas = linhasExtras.filter(l => {
    const situacao = situacaoExtra(l.validoAte);
    const bateTexto = !termo || norm(l.assunto + ' ' + l.informacao).includes(termo);
    const bateValidade = !validadeFiltro
      || (validadeFiltro === 'vencido' && situacao === 'vencido')
      || (validadeFiltro === 'ativo' && situacao !== 'vencido');
    return bateTexto && bateValidade;
  });

  const corpo = el('tabelaExtrasCorpo');
  corpo.innerHTML = '';

  if (filtradas.length === 0) {
    corpo.innerHTML = '<tr><td colspan="5">Nenhum aviso encontrado.</td></tr>';
    return;
  }

  filtradas.forEach(l => {
    const situacao = situacaoExtra(l.validoAte);
    const rotulo = situacao === 'vencido' ? 'Vencido' : (situacao === 'semprazo' ? 'Sem prazo' : 'Valendo');
    const classe = situacao === 'vencido' ? 'pendente' : 'resolvido';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Assunto">${escapeHtml(l.assunto)}</td>
      <td data-label="Informação" class="texto-longo">${escapeHtml(l.informacao)}</td>
      <td data-label="Válido até">${escapeHtml(l.validoAte || '—')}</td>
      <td data-label="Situação"><span class="status-pill ${classe}" title="A situação depende do 'Válido até'. Para mudar, clique em Editar.">${rotulo}</span></td>
      <td data-label="Ação" class="no-print acoes-recado">
        <button class="btn-acao btn-editar" data-linha="${l.linha}">✏️ Editar</button>
        <button class="btn-acao btn-excluir" data-linha="${l.linha}">🗑️ Excluir</button>
      </td>
    `;
    corpo.appendChild(tr);
  });
}

function abrirModalExtra(linhaNumero) {
  extraEditandoLinha = linhaNumero || null;
  el('formExtra').reset();
  document.querySelectorAll('#formExtra .ajuda-texto').forEach(d => { d.hidden = true; });
  document.querySelectorAll('#formExtra .btn-ajuda').forEach(b => b.setAttribute('aria-expanded', 'false'));
  el('modalExtraResultado').textContent = '';
  el('modalExtraResultado').className = '';

  if (extraEditandoLinha) {
    const l = linhasExtras.find(x => x.linha === extraEditandoLinha);
    if (l) {
      el('extraAssunto').value = l.assunto;
      el('extraInformacao').value = l.informacao;
      el('extraValidoAte').value = dataBRparaISO(l.validoAte);
    }
    el('modalExtraTitulo').textContent = 'Editar aviso';
  } else {
    el('modalExtraTitulo').textContent = 'Novo aviso';
  }
  el('modalExtra').hidden = false;
}

function fecharModalExtra() {
  el('modalExtra').hidden = true;
  extraEditandoLinha = null;
}

async function salvarExtra(e) {
  e.preventDefault();
  const resultado = el('modalExtraResultado');
  const btn = el('btnSalvarExtra');
  resultado.textContent = '';
  resultado.className = '';
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const validoIso = el('extraValidoAte').value;
  const valores = [[
    el('extraAssunto').value.trim(),
    el('extraInformacao').value.trim(),
    validoIso ? formatarDataBR(validoIso) : '',
  ]];

  const base = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID_DADOS}/values/`;
  const cabecalhos = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };

  try {
    let resp;
    if (extraEditandoLinha) {
      const range = `${CONFIG.EXTRAS_ABA}!A${extraEditandoLinha}:C${extraEditandoLinha}`;
      resp = await fetch(base + encodeURIComponent(range) + '?valueInputOption=RAW', {
        method: 'PUT', headers: cabecalhos, body: JSON.stringify({ values: valores }),
      });
    } else {
      const range = `${CONFIG.EXTRAS_ABA}!A:C`;
      resp = await fetch(base + encodeURIComponent(range) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
        method: 'POST', headers: cabecalhos, body: JSON.stringify({ values: valores }),
      });
    }
    if (!resp.ok) { const e = new Error('status ' + resp.status); e.status = resp.status; throw e; }

    resultado.className = 'sucesso';
    resultado.textContent = '✅ Aviso salvo.';
    await carregarExtras();
    setTimeout(fecharModalExtra, 900);
  } catch (err) {
    console.error('Erro ao salvar aviso:', err);
    resultado.className = 'erro';
    resultado.textContent = '⚠️ ' + mensagemErroGravacao(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

// Traduz o erro do Google Sheets numa mensagem que diz o que fazer (em vez de um "tente novamente" genérico).
function mensagemErroGravacao(err, aba, planilha) {
  aba = aba || CONFIG.EXTRAS_ABA;
  planilha = planilha || 'planilha de dados da paróquia';
  const s = err && err.status;
  if (s === 401) return 'Sua sessão do Google expirou. Clique em "Sair" (canto superior direito), entre de novo e tente outra vez.';
  if (s === 403) return 'Sua conta Google não tem permissão para EDITAR a ' + planilha + ' (só para ver). Peça para compartilhá-la com você como Editor e tente de novo.';
  if (s === 400 || s === 404) return 'Não encontrei a aba "' + aba + '" na ' + planilha + '. Confira se o nome da aba está exatamente assim.';
  if (s === 429) return 'O Google está limitando os acessos neste momento. Aguarde 1 minuto e tente de novo.';
  if (s) return 'O Google recusou a gravação (código ' + s + '). Tente novamente em instantes; se continuar, avise a equipe técnica.';
  return 'Sem conexão com o Google. Confira a internet e tente novamente.';
}

async function excluirExtra(linhaNumero) {
  const l = linhasExtras.find(x => x.linha === linhaNumero);
  const nome = l ? ' "' + l.assunto + '"' : '';
  if (!confirm('Confirma que quer excluir o aviso' + nome + '? Essa ação não pode ser desfeita.')) return;

  const range = `${CONFIG.EXTRAS_ABA}!A${linhaNumero}:C${linhaNumero}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID_DADOS}/values/${encodeURIComponent(range)}:clear`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!resp.ok) { const e = new Error('status ' + resp.status); e.status = resp.status; throw e; }
    await carregarExtras();
  } catch (e) {
    console.error('Erro ao excluir aviso:', e);
    alert(mensagemErroGravacao(e));
  }
}


async function carregarReservas() {
  const statusMsg = el('statusMsgReservas');
  statusMsg.textContent = 'Carregando reservas...';

  try {
    const valores = await buscarValoresSheet(CONFIG.RESERVAS_RANGE);
    linhasReservas = valores
      .map((row, idx) => ({
        linha: idx + 2,
        data: row[0] || '',
        horaInicio: row[1] || '',
        horaFim: row[2] || '',
        sala: row[3] || '',
        nome: row[4] || '',
        whatsapp: limparNumero(row[5]),
        atividade: row[6] || '',
        status: row[7] || '',
      }))
      .filter(l => l.sala || l.nome);

    statusMsg.textContent = linhasReservas.length + ' reserva(s) encontrada(s).';
    renderizarReservas();
  } catch (e) {
    statusMsg.textContent = e.message === 'SEM_PERMISSAO'
      ? 'Sua conta Google não tem permissão de acesso a esta planilha. Peça para compartilhá-la com você.'
      : 'Erro ao carregar reservas.';
  }
}

async function cancelarReserva(linhaNumero) {
  const confirmado = confirm('Confirma que quer cancelar essa reserva?');
  if (!confirmado) return;

  const range = `${CONFIG.RESERVAS_ABA}!H${linhaNumero}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;

  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [['Cancelado']] }),
    });
    if (!resp.ok) throw new Error('status ' + resp.status);
    await carregarReservas();
  } catch (e) {
    alert('Não foi possível cancelar a reserva agora. Tente novamente em instantes.');
  }
}

function abrirModalReserva() {
  el('formNovaReserva').reset();
  el('modalResultado').textContent = '';
  el('modalResultado').className = '';
  el('modalReserva').hidden = false;
}

function fecharModalReserva() {
  el('modalReserva').hidden = true;
}

function formatarDataBR(isoDate) {
  const [ano, mes, dia] = isoDate.split('-');
  return dia + '/' + mes + '/' + ano;
}

async function enviarNovaReserva(e) {
  e.preventDefault();
  const resultado = el('modalResultado');
  const btn = el('btnConfirmarReserva');
  resultado.textContent = '';
  resultado.className = '';
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  const payload = {
    sala: el('modalSala').value,
    data: formatarDataBR(el('modalData').value),
    horaInicio: el('modalHoraInicio').value,
    horaFim: el('modalHoraFim').value,
    nome: el('modalNome').value.trim(),
    numero: el('modalWhatsapp').value.trim(),
    atividade: el('modalAtividade').value.trim(),
  };

  try {
    const resp = await fetch(CONFIG.WEBHOOK_RESERVA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const dados = await resp.json();

    if (dados.sucesso) {
      resultado.className = 'sucesso';
      resultado.textContent = '✅ ' + dados.mensagem;
      await carregarReservas();
      setTimeout(fecharModalReserva, 1200);
    } else {
      resultado.className = 'erro';
      resultado.textContent = '⚠️ ' + dados.mensagem;
    }
  } catch (err) {
    resultado.className = 'erro';
    resultado.textContent = '⚠️ Não foi possível enviar a reserva agora. Tente novamente em instantes.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar reserva';
  }
}

async function marcarComoResolvido(linhaNumero) {
  const confirmado = confirm('Confirma que já entrou em contato e quer marcar este recado como Resolvido?');
  if (!confirmado) return;

  const range = `${CONFIG.RECADOS_ABA}!G${linhaNumero}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;

  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [['Resolvido']] }),
    });
    if (!resp.ok) throw new Error('status ' + resp.status);
    await carregarRecados();
  } catch (e) {
    alert('Não foi possível atualizar o status agora. Tente novamente em instantes.');
  }
}

async function marcarResolvidoAutomatico(linhaNumero) {
  const range = `${CONFIG.RECADOS_ABA}!G${linhaNumero}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;

  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [['Resolvido']] }),
    });
    if (!resp.ok) throw new Error('status ' + resp.status);
    await carregarRecados();
  } catch (e) {
    // Falha silenciosa: o WhatsApp já abriu numa aba própria; só não deu pra atualizar o status agora.
  }
}

// Deixa só os dígitos: "5514997222096@s.whatsapp.net" ou "(14) 99722-2096" -> só números.
// Usado em todas as abas, então a exibição e a busca por número ficam iguais.
function limparNumero(numero) {
  return String(numero || '').replace('@s.whatsapp.net', '').replace(/\D/g, '');
}

function linkWhatsApp(numero) {
  const digits = limparNumero(numero);
  // Número digitado sem o código do país (10 ou 11 dígitos, ex.: 14997222096) -> acrescenta 55 para o link abrir
  const comPais = (digits.length === 10 || digits.length === 11) ? '55' + digits : digits;
  return comPais ? `https://wa.me/${comPais}` : '';
}

// "23/09/2026 18:05" -> número para ordenar. Sem data legível, vai para o fim da lista.
function valorDataHora(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (!m) return -Infinity;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0)).getTime();
}

function renderizarTabela() {
  const termo = el('busca').value.trim().toLowerCase();
  const tipoFiltro = el('filtroTipo').value;

  const filtradas = linhasDocs.filter(l => {
    const bateTexto = !termo || (l.nome + ' ' + l.tipo + ' ' + l.arquivo + ' ' + l.numero).toLowerCase().includes(termo);
    const bateTipo = !tipoFiltro || l.tipo === tipoFiltro;
    return bateTexto && bateTipo;
  }).sort((a, b) => (valorDataHora(b.data) - valorDataHora(a.data)) || (b.ordem - a.ordem)); // mais novos no topo (só na tela)

  const corpo = el('tabelaCorpo');
  corpo.innerHTML = '';

  if (filtradas.length === 0) {
    corpo.innerHTML = '<tr><td colspan="6">Nenhum documento encontrado.</td></tr>';
    return;
  }

  filtradas.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Data/Hora">${escapeHtml(l.data)}</td>
      <td data-label="Contato">${escapeHtml(l.nome)}</td>
      <td data-label="Número">${escapeHtml(l.numero)}</td>
      <td data-label="Tipo">${escapeHtml(l.tipo)}</td>
      <td data-label="Arquivo">${escapeHtml(l.arquivo)}</td>
      <td data-label="Ação" class="no-print">${l.link ? `<a href="${escapeAttr(l.link)}" target="_blank" rel="noopener">Abrir</a>` : ''}</td>
    `;
    corpo.appendChild(tr);
  });
}

function renderizarRecados() {
  const termo = el('buscaRecados').value.trim().toLowerCase();
  const statusFiltro = el('filtroStatus').value;

  const filtradas = linhasRecados.filter(l => {
    const bateTexto = !termo || (l.nome + ' ' + l.whatsapp + ' ' + l.assunto).toLowerCase().includes(termo);
    const bateStatus = !statusFiltro || l.status.trim().toLowerCase() === statusFiltro.toLowerCase();
    return bateTexto && bateStatus;
  });

  const corpo = el('tabelaRecadosCorpo');
  corpo.innerHTML = '';

  if (filtradas.length === 0) {
    corpo.innerHTML = '<tr><td colspan="7">Nenhum recado encontrado.</td></tr>';
    return;
  }

  filtradas.forEach(l => {
    const statusNorm = norm(l.status);
    const jaResolvido = statusNorm.includes('resolvid');
    const statusClasse = jaResolvido ? 'resolvido' : 'pendente';
    const wa = linkWhatsApp(l.whatsapp);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Data">${escapeHtml(l.data)}</td>
      <td data-label="Hora">${escapeHtml(l.hora)}</td>
      <td data-label="Nome">${escapeHtml(l.nome)}</td>
      <td data-label="WhatsApp">${escapeHtml(l.whatsapp)}</td>
      <td data-label="Assunto">${escapeHtml(l.assunto)}</td>
      <td data-label="Status"><span class="status-pill ${statusClasse}">${escapeHtml(l.status || 'Pendente')}</span></td>
      <td data-label="Ação" class="no-print acoes-recado">
        ${wa ? `<a href="${escapeAttr(wa)}" target="_blank" rel="noopener" class="btn-acao${jaResolvido ? '' : ' btn-whatsapp-auto'}" data-linha="${l.linha}">💬 WhatsApp</a>` : ''}
        ${jaResolvido ? '' : `<button class="btn-acao btn-resolver" data-linha="${l.linha}">✅ Marcar Resolvido</button>`}
      </td>
    `;
    corpo.appendChild(tr);
  });
}

function renderizarReservas() {
  const termo = el('buscaReservas').value.trim().toLowerCase();
  const salaFiltro = el('filtroSala').value;
  const statusFiltro = el('filtroStatusReserva').value;

  const filtradas = linhasReservas.filter(l => {
    const bateTexto = !termo || (l.sala + ' ' + l.nome + ' ' + l.atividade).toLowerCase().includes(termo);
    const bateSala = !salaFiltro || l.sala === salaFiltro;
    const bateStatus = !statusFiltro || l.status.trim().toLowerCase() === statusFiltro.toLowerCase();
    return bateTexto && bateSala && bateStatus;
  });

  const corpo = el('tabelaReservasCorpo');
  corpo.innerHTML = '';

  if (filtradas.length === 0) {
    corpo.innerHTML = '<tr><td colspan="9">Nenhuma reserva encontrada.</td></tr>';
    return;
  }

  filtradas.forEach(l => {
    const cancelado = norm(l.status).includes('cancelado');
    const statusClasse = cancelado ? 'pendente' : 'resolvido';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Data">${escapeHtml(l.data)}</td>
      <td data-label="Hora Início">${escapeHtml(l.horaInicio)}</td>
      <td data-label="Hora Fim">${escapeHtml(l.horaFim)}</td>
      <td data-label="Sala">${escapeHtml(l.sala)}</td>
      <td data-label="Nome">${escapeHtml(l.nome)}</td>
      <td data-label="WhatsApp">${escapeHtml(l.whatsapp)}</td>
      <td data-label="Atividade">${escapeHtml(l.atividade)}</td>
      <td data-label="Status"><span class="status-pill ${statusClasse}">${escapeHtml(l.status || 'Confirmado')}</span></td>
      <td data-label="Ação" class="no-print">
        ${cancelado ? '' : `<button class="btn-acao btn-resolver" data-linha="${l.linha}">✖ Cancelar</button>`}
      </td>
    `;
    corpo.appendChild(tr);
  });
}

// ---------- Catequese (inscrições feitas pelo formulário catequese.html) ----------
// Colunas da aba: A Data/Hora · B Catequizando · C Nascimento · D Responsável · E WhatsApp · F Etapa ·
// G Batizado · H Paróquia do Batismo · I Observações · J Situação dos Documentos · K Links dos Documentos · L Status

async function carregarCatequese() {
  const statusMsg = el('statusMsgCatequese');
  statusMsg.textContent = 'Carregando inscrições...';

  try {
    const valores = await buscarValoresSheet(CONFIG.CATEQUESE_RANGE);
    // Guarda a linha real da planilha (o range começa em A2) para gravar o status na célula certa.
    linhasCatequese = valores
      .map((row, idx) => ({
        linha: idx + 2,
        ordem: idx,
        data: row[0] || '',
        catequizando: row[1] || '',
        nascimento: row[2] || '',
        responsavel: row[3] || '',
        whatsapp: limparNumero(row[4]),
        etapa: row[5] || '',
        batizado: row[6] || '',
        paroquiaBatismo: row[7] || '',
        observacoes: row[8] || '',
        situacao: row[9] || '',
        links: row[10] || '',
        status: (row[11] || '').trim() || 'Nova',
      }))
      .filter(l => l.catequizando || l.responsavel);

    statusMsg.textContent = linhasCatequese.length + ' inscrição(ões) encontrada(s).';
    renderizarCatequese();
  } catch (e) {
    statusMsg.textContent = e.message === 'SEM_PERMISSAO'
      ? 'Sua conta Google não tem permissão de acesso a esta planilha. Peça para compartilhá-la com você.'
      : e.message === 'STATUS_400'
        ? 'A aba "' + CONFIG.CATEQUESE_ABA + '" ainda não existe na planilha Pascom_Controle. Crie a aba (veja as instruções) e clique em Atualizar.'
        : 'Erro ao carregar as inscrições.';
  }
}

// "Certidão de nascimento: https://..." (uma por linha) -> [{ rotulo, url }]; só aceita links https
function linksDaCatequese(texto) {
  return String(texto || '').split('\n').map(t => t.trim()).filter(Boolean).map(t => {
    const i = t.indexOf(': ');
    return i > 0 ? { rotulo: t.slice(0, i), url: t.slice(i + 2).trim() } : { rotulo: 'Documento', url: t };
  }).filter(x => /^https:\/\//i.test(x.url));
}

function renderizarCatequese() {
  const termo = norm(el('buscaCatequese').value.trim());
  const docsFiltro = el('filtroDocsCatequese').value;
  const statusFiltro = norm(el('filtroStatusCatequese').value);

  const filtradas = linhasCatequese.filter(l => {
    const completos = norm(l.situacao).startsWith('completo');
    const bateTexto = !termo || norm(l.catequizando + ' ' + l.responsavel + ' ' + l.whatsapp + ' ' + l.etapa).includes(termo);
    const bateDocs = !docsFiltro || (docsFiltro === 'completos' ? completos : !completos);
    const bateStatus = !statusFiltro || norm(l.status) === statusFiltro;
    return bateTexto && bateDocs && bateStatus;
  }).sort((a, b) => (valorDataHora(b.data) - valorDataHora(a.data)) || (b.ordem - a.ordem)); // mais novas no topo

  const corpo = el('tabelaCatequeseCorpo');
  corpo.innerHTML = '';

  if (filtradas.length === 0) {
    corpo.innerHTML = '<tr><td colspan="8">Nenhuma inscrição encontrada.</td></tr>';
    return;
  }

  filtradas.forEach(l => {
    const completos = norm(l.situacao).startsWith('completo');
    const concluida = norm(l.status).startsWith('conclu');
    const emAtendimento = norm(l.status).startsWith('em atend');
    const statusClasse = concluida ? 'resolvido' : (emAtendimento ? 'andamento' : 'pendente');
    const wa = linkWhatsApp(l.whatsapp);
    const links = linksDaCatequese(l.links);

    const detalhes = `
      <details class="detalhes-cat">
        <summary>Ver dados e documentos</summary>
        <p><strong>Nascimento:</strong> ${escapeHtml(l.nascimento || '—')}</p>
        <p><strong>Batizado(a):</strong> ${escapeHtml(l.batizado || '—')}${l.paroquiaBatismo ? ' — ' + escapeHtml(l.paroquiaBatismo) : ''}</p>
        ${l.observacoes ? `<p><strong>Observações:</strong> ${escapeHtml(l.observacoes)}</p>` : ''}
        <p><strong>Documentos:</strong></p>
        ${links.length
          ? `<ul>${links.map(x => `<li><a href="${escapeAttr(x.url)}" target="_blank" rel="noopener">${escapeHtml(x.rotulo)}</a></li>`).join('')}</ul>`
          : '<p>Nenhum arquivo encontrado.</p>'}
      </details>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Data">${escapeHtml(l.data)}</td>
      <td data-label="Catequizando"><strong>${escapeHtml(l.catequizando)}</strong>${detalhes}</td>
      <td data-label="Responsável">${escapeHtml(l.responsavel)}</td>
      <td data-label="WhatsApp">${escapeHtml(l.whatsapp)}</td>
      <td data-label="Etapa">${escapeHtml(l.etapa)}</td>
      <td data-label="Documentos"><span class="status-pill ${completos ? 'resolvido' : 'pendente'}">${escapeHtml(l.situacao || 'Sem informação')}</span></td>
      <td data-label="Status"><span class="status-pill ${statusClasse}">${escapeHtml(l.status)}</span></td>
      <td data-label="Ação" class="no-print acoes-recado">
        ${wa ? `<a href="${escapeAttr(wa)}" target="_blank" rel="noopener" class="btn-acao">💬 WhatsApp</a>` : ''}
        <button class="btn-acao btn-editar btn-cat" data-acao="ficha" data-linha="${l.linha}" title="Imprimir a ficha já preenchida">🖨️ Ficha</button>
        ${!concluida && !emAtendimento ? `<button class="btn-acao btn-editar btn-cat" data-acao="atendimento" data-linha="${l.linha}">▶ Em atendimento</button>` : ''}
        ${!concluida ? `<button class="btn-acao btn-resolver btn-cat" data-acao="concluir" data-linha="${l.linha}">✅ Concluir</button>` : `<button class="btn-acao btn-editar btn-cat" data-acao="reabrir" data-linha="${l.linha}">↩ Reabrir</button>`}
      </td>
    `;
    corpo.appendChild(tr);
  });
}

// Ficha de inscrição já preenchida com o que o fiel informou no formulário (o resto fica em branco para a catequista).
// Devolve um documento HTML completo, pronto para abrir numa janela e imprimir em A4.
function htmlFichaCatequese(l, autoImprimir) {
  const e = escapeHtml;
  const campo = (rot, val, cls) => `<div class="campo ${cls || ''}"><span class="l">${rot}</span><span class="v">${e(val || '')}</span></div>`;
  const cx = (marcado, texto) => `<span><i class="cx">${marcado ? '✕' : ''}</i>${texto}</span>`;

  const rotulosDocs = linksDaCatequese(l.links).map(x => norm(x.rotulo));
  const tem = (parte) => rotulosDocs.some(r => r.includes(parte));
  const outros = linksDaCatequese(l.links).map(x => x.rotulo)
    .filter(r => !/nascimento|batismo|resid/.test(norm(r))).join(', ');
  const batizado = norm(l.batizado) === 'sim';
  // 5514997222096 -> (14) 99722-2096 (só quando tem o formato de número brasileiro; senão mostra como está)
  const telBonito = (t) => {
    const m = String(t || '').match(/^55(\d{2})(9?\d{4})(\d{4})$/);
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (t || '');
  };
  const dataInscricao = String(l.data || '').split(' ')[0];
  const brasao = new URL('brasao.png', location.href).href;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Ficha de inscrição — ${e(l.catequizando)}</title>
<style>
  @page { size: A4; margin: 0; }
  :root { --vinho:#7a1f2b; --vinho-escuro:#591622; --dourado:#c9a24a; --creme:#faf7f0; --texto:#2b2420; --linha:#8f847a; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin:0; width:210mm; height:297mm; overflow:hidden; font-family:"Segoe UI", Arial, sans-serif; font-size:9.5pt; line-height:1.3; color:var(--texto); position:relative; }
  .topo { background: radial-gradient(circle at 25% 30%, #8a2b32 0%, var(--vinho-escuro) 80%); color:#fff; padding:6mm 14mm; display:flex; align-items:center; gap:6mm; border-bottom:2.2mm solid var(--dourado); }
  .topo img { height:17mm; }
  .topo .sup { color:#e3c88a; font-size:8pt; letter-spacing:1.4px; text-transform:uppercase; }
  .topo .nome { font-family:Georgia, serif; font-size:15pt; font-weight:700; line-height:1.15; margin:0.5mm 0 1mm; color:#f1dfae; }
  .topo .contato { font-size:8pt; color:#eadfd2; }
  .conteudo { padding:5mm 14mm 0; }
  h1 { font-family:Georgia, serif; color:var(--vinho); font-size:16pt; margin:0; line-height:1.15; text-align:center; }
  .subtitulo { text-align:center; color:#6b6055; font-size:8.5pt; margin:0.5mm 0 2.5mm; }
  h2 { font-size:9.5pt; color:#fff; background:var(--vinho); margin:3mm 0 0.5mm; padding:1mm 3mm; border-radius:2px; letter-spacing:0.3px; }
  .linha { display:flex; gap:4mm; }
  .campo { flex:1; min-height:11.5mm; border-bottom:1px solid var(--linha); padding-top:1mm; }
  .campo .l { display:block; font-size:7pt; color:#7a6f66; text-transform:uppercase; letter-spacing:0.3px; }
  .campo .v { display:block; font-size:10.5pt; font-weight:600; color:#1d1a17; margin-top:0.6mm; }
  .campo.p2 { flex:2; } .campo.p3 { flex:3; }
  .opcoes { display:flex; flex-wrap:wrap; gap:1.5mm 6mm; align-items:center; padding:1.6mm 0 1mm; font-size:9pt; }
  .opcoes .rot { font-size:7pt; color:#7a6f66; text-transform:uppercase; letter-spacing:0.3px; margin-right:1mm; }
  .cx { display:inline-block; width:3.6mm; height:3.6mm; border:1px solid #4a4038; margin-right:1.5mm; vertical-align:-0.7mm; font-style:normal; font-size:9pt; line-height:3.3mm; text-align:center; font-weight:700; }
  .obs { min-height:18mm; border-bottom:1px solid var(--linha); padding-top:1mm; }
  .obs .l { display:block; font-size:7pt; color:#7a6f66; text-transform:uppercase; letter-spacing:0.3px; }
  .obs .v { display:block; font-size:10pt; font-weight:600; margin-top:0.6mm; white-space:pre-line; }
  .obs + .obs { min-height:8mm; }
  .autoriza { background:var(--creme); border-left:3px solid var(--dourado); padding:2mm 3mm; margin-top:2.5mm; font-size:8.3pt; line-height:1.35; border-radius:2px; }
  .assina { display:flex; gap:8mm; margin-top:6mm; }
  .assina .a { flex:3; border-top:1px solid var(--linha); padding-top:1mm; font-size:7.5pt; color:#7a6f66; text-align:center; }
  .assina .d { flex:1; border-top:1px solid var(--linha); padding-top:1mm; font-size:7.5pt; color:#7a6f66; text-align:center; }
  .uso { margin-top:3.5mm; border:1.2px dashed #a89a8a; border-radius:3px; padding:1.5mm 3mm 0; background:#fdfbf6; }
  .uso .tit { font-size:7.5pt; font-weight:700; color:var(--vinho); text-transform:uppercase; letter-spacing:0.6px; }
  .uso .campo { min-height:8mm; }
  .rodape { position:absolute; left:0; right:0; bottom:5mm; text-align:center; font-size:7.5pt; color:#888; }
</style></head><body>
<div class="topo"><img src="${brasao}" alt=""><div>
  <div class="sup">Paróquia</div><div class="nome">Sagrado Coração de Jesus</div>
  <div class="contato">Diocese de Marília · Rua Etelvina Teixeira da Silva, 17 — Marília/SP · Secretaria: (14) 3425-1732</div>
</div></div>
<div class="conteudo">
  <h1>Ficha de Inscrição na Catequese</h1>
  <p class="subtitulo">Dados informados pelo responsável na inscrição pela internet. Complete à mão o que estiver em branco.</p>

  <h2>Dados do catequizando</h2>
  <div class="linha">${campo('Nome completo', l.catequizando, 'p3')}${campo('Data de nascimento', l.nascimento)}</div>
  <div class="linha">${campo('Endereço (rua, número, bairro)', '', 'p3')}${campo('Cidade', '')}</div>
  <div class="linha">${campo('Etapa / turma desejada', l.etapa, 'p2')}${campo('Escola e série (opcional)', '', 'p2')}</div>
  <div class="opcoes"><span class="rot">Sacramentos já recebidos:</span>${cx(batizado, 'Batismo')}${cx(false, '1ª Eucaristia')}${cx(false, 'Crisma')}${cx(!batizado && !!l.batizado, 'Nenhum')}</div>
  <div class="linha">${campo('Paróquia onde foi batizado(a)', l.paroquiaBatismo, 'p3')}${campo('Cidade', '', 'p2')}${campo('Data do batismo', '')}</div>

  <h2>Filiação</h2>
  <div class="linha">${campo('Nome da mãe', '')}${campo('Nome do pai', '')}</div>

  <h2>Responsável pela inscrição</h2>
  <div class="linha">${campo('Nome completo do responsável', l.responsavel, 'p3')}${campo('Parentesco', '')}</div>
  <div class="linha">${campo('WhatsApp com DDD', telBonito(l.whatsapp))}${campo('Outro telefone para recado', '')}</div>

  <h2>Saúde e observações</h2>
  <div class="obs"><span class="l">Alergias, necessidades especiais, melhor dia e horário, outras informações</span><span class="v">${e(l.observacoes || '')}</span></div>
  <div class="obs"></div>

  <h2>Documentos entregues</h2>
  <div class="opcoes">${cx(tem('nascimento'), 'Certidão de nascimento')}${cx(tem('batismo'), 'Certidão de batismo (se já batizado)')}${cx(tem('resid'), 'Comprovante de residência')}${cx(!!outros, 'Outro: ' + (outros ? e(outros) : '____________________'))}</div>

  <div class="autoriza"><strong>Autorização.</strong> Declaro que sou responsável pelo(a) catequizando(a) e que as informações acima são verdadeiras.
  Autorizo a paróquia a usar estes dados e documentos <strong>somente</strong> para a inscrição e o acompanhamento na catequese,
  com sigilo e cuidado, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).</div>
  <div class="assina"><div class="a">Assinatura do responsável</div><div class="d">Data</div></div>

  <div class="uso"><div class="tit">Uso da paróquia</div>
    <div class="linha">${campo('Recebido por', 'Inscrição pela internet')}${campo('Data', dataInscricao)}${campo('Turma / horário', '')}</div>
    <div class="linha">${campo('Observações da secretaria / catequista', '', 'p3')}</div>
  </div>
</div>
<div class="rodape">Paróquia Sagrado Coração de Jesus · Marília/SP</div>
${autoImprimir === false ? '' : '<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 300); });<\/script>'}
</body></html>`;
}

function imprimirFichaCatequese(linhaNumero) {
  const l = linhasCatequese.find(x => x.linha === linhaNumero);
  if (!l) return;
  const janela = window.open('', '_blank');
  if (!janela) {
    alert('O navegador bloqueou a janela da ficha. Permita pop-ups para este site (ícone na barra de endereço) e tente de novo.');
    return;
  }
  janela.document.open();
  janela.document.write(htmlFichaCatequese(l));
  janela.document.close();
}

async function atualizarStatusCatequese(linhaNumero, novoStatus) {
  const range = `${CONFIG.CATEQUESE_ABA}!L${linhaNumero}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;

  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[novoStatus]] }),
    });
    if (!resp.ok) { const err = new Error('status ' + resp.status); err.status = resp.status; throw err; }
    await carregarCatequese();
  } catch (e) {
    alert(mensagemErroGravacao(e, CONFIG.CATEQUESE_ABA, 'planilha Pascom_Controle'));
  }
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

const ABAS = {
  documentos: ['abaDocumentos', 'btnAbaDocumentos'],
  recados: ['abaRecados', 'btnAbaRecados'],
  reservas: ['abaReservas', 'btnAbaReservas'],
  extras: ['abaExtras', 'btnAbaExtras'],
  catequese: ['abaCatequese', 'btnAbaCatequese'],
};

function trocarAba(aba) {
  Object.entries(ABAS).forEach(([nome, [divId, btnId]]) => {
    el(divId).hidden = nome !== aba;
    el(btnId).classList.toggle('ativa', nome === aba);
  });
}

function sair() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  linhasDocs = [];
  linhasRecados = [];
  linhasReservas = [];
  linhasExtras = [];
  linhasCatequese = [];
  el('userBox').hidden = true;
  el('appScreen').hidden = true;
  el('loginScreen').hidden = false;
}

window.addEventListener('DOMContentLoaded', () => {
  iniciarBotaoGoogle();

  el('busca').addEventListener('input', renderizarTabela);
  el('filtroTipo').addEventListener('change', renderizarTabela);
  el('btnAtualizar').addEventListener('click', carregarDocumentos);
  el('btnImprimirLista').addEventListener('click', () => window.print());

  el('buscaRecados').addEventListener('input', renderizarRecados);
  el('filtroStatus').addEventListener('change', renderizarRecados);
  el('btnAtualizarRecados').addEventListener('click', carregarRecados);
  el('btnImprimirRecados').addEventListener('click', () => window.print());

  // Delegação de evento: os botões "Marcar Resolvido" são recriados a cada renderização
  el('tabelaRecadosCorpo').addEventListener('click', (e) => {
    const btnResolver = e.target.closest('.btn-resolver');
    if (btnResolver) { marcarComoResolvido(Number(btnResolver.dataset.linha)); return; }

    const btnWhats = e.target.closest('.btn-whatsapp-auto');
    if (btnWhats) marcarResolvidoAutomatico(Number(btnWhats.dataset.linha));
  });

  el('buscaReservas').addEventListener('input', renderizarReservas);
  el('filtroSala').addEventListener('change', renderizarReservas);
  el('filtroStatusReserva').addEventListener('change', renderizarReservas);
  el('btnAtualizarReservas').addEventListener('click', carregarReservas);
  el('btnNovaReserva').addEventListener('click', abrirModalReserva);
  el('btnFecharModal').addEventListener('click', fecharModalReserva);
  el('formNovaReserva').addEventListener('submit', enviarNovaReserva);
  el('modalReserva').addEventListener('click', (e) => {
    if (e.target === el('modalReserva')) fecharModalReserva();
  });

  el('tabelaReservasCorpo').addEventListener('click', (e) => {
    const btnCancelar = e.target.closest('.btn-resolver');
    if (btnCancelar) cancelarReserva(Number(btnCancelar.dataset.linha));
  });

  el('buscaExtras').addEventListener('input', renderizarExtras);
  el('filtroValidade').addEventListener('change', renderizarExtras);
  el('btnAtualizarExtras').addEventListener('click', carregarExtras);
  el('btnNovaExtra').addEventListener('click', () => abrirModalExtra(null));
  el('btnFecharModalExtra').addEventListener('click', fecharModalExtra);
  el('formExtra').addEventListener('submit', salvarExtra);
  el('modalExtra').addEventListener('click', (e) => {
    if (e.target === el('modalExtra')) { fecharModalExtra(); return; }
    const btnAjuda = e.target.closest('.btn-ajuda');
    if (btnAjuda) {
      const caixa = el(btnAjuda.dataset.ajuda);
      caixa.hidden = !caixa.hidden;
      btnAjuda.setAttribute('aria-expanded', String(!caixa.hidden));
    }
  });

  el('tabelaExtrasCorpo').addEventListener('click', (e) => {
    const btnEditar = e.target.closest('.btn-editar');
    if (btnEditar) { abrirModalExtra(Number(btnEditar.dataset.linha)); return; }
    const btnExcluir = e.target.closest('.btn-excluir');
    if (btnExcluir) excluirExtra(Number(btnExcluir.dataset.linha));
  });

  el('buscaCatequese').addEventListener('input', renderizarCatequese);
  el('filtroDocsCatequese').addEventListener('change', renderizarCatequese);
  el('filtroStatusCatequese').addEventListener('change', renderizarCatequese);
  el('btnAtualizarCatequese').addEventListener('click', carregarCatequese);
  el('btnImprimirCatequese').addEventListener('click', () => window.print());
  el('btnFichaBranco').addEventListener('click', () => window.open('Ficha_Inscricao_Catequese.pdf', '_blank'));
  el('tabelaCatequeseCorpo').addEventListener('click', (e) => {
    const b = e.target.closest('.btn-cat');
    if (!b) return;
    const linha = Number(b.dataset.linha);
    if (b.dataset.acao === 'ficha') imprimirFichaCatequese(linha);
    else if (b.dataset.acao === 'atendimento') atualizarStatusCatequese(linha, 'Em atendimento');
    else if (b.dataset.acao === 'reabrir') atualizarStatusCatequese(linha, 'Nova');
    else if (b.dataset.acao === 'concluir' && confirm('Confirma que quer marcar esta inscrição como Concluída?')) atualizarStatusCatequese(linha, 'Concluída');
  });

  el('btnAbaDocumentos').addEventListener('click', () => trocarAba('documentos'));
  el('btnAbaRecados').addEventListener('click', () => trocarAba('recados'));
  el('btnAbaReservas').addEventListener('click', () => trocarAba('reservas'));
  el('btnAbaExtras').addEventListener('click', () => trocarAba('extras'));
  el('btnAbaCatequese').addEventListener('click', () => trocarAba('catequese'));

  el('btnSair').addEventListener('click', sair);
});
