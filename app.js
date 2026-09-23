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
      .map(row => ({
        data: row[0] || '',
        nome: row[1] || '',
        numero: row[2] || '',
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
        whatsapp: row[4] || '',
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
    if (!resp.ok) throw new Error('status ' + resp.status);

    resultado.className = 'sucesso';
    resultado.textContent = '✅ Aviso salvo.';
    await carregarExtras();
    setTimeout(fecharModalExtra, 900);
  } catch (err) {
    resultado.className = 'erro';
    resultado.textContent = '⚠️ Não foi possível salvar agora. Tente novamente em instantes.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
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
    if (!resp.ok) throw new Error('status ' + resp.status);
    await carregarExtras();
  } catch (e) {
    alert('Não foi possível excluir o aviso agora. Tente novamente em instantes.');
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
        whatsapp: row[5] || '',
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

function linkWhatsApp(numero) {
  const digits = String(numero || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

function renderizarTabela() {
  const termo = el('busca').value.trim().toLowerCase();
  const tipoFiltro = el('filtroTipo').value;

  const filtradas = linhasDocs.filter(l => {
    const bateTexto = !termo || (l.nome + ' ' + l.tipo + ' ' + l.arquivo + ' ' + l.numero).toLowerCase().includes(termo);
    const bateTipo = !tipoFiltro || l.tipo === tipoFiltro;
    return bateTexto && bateTipo;
  });

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

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function trocarAba(aba) {
  el('abaDocumentos').hidden = aba !== 'documentos';
  el('abaRecados').hidden = aba !== 'recados';
  el('abaReservas').hidden = aba !== 'reservas';
  el('abaExtras').hidden = aba !== 'extras';
  el('btnAbaDocumentos').classList.toggle('ativa', aba === 'documentos');
  el('btnAbaRecados').classList.toggle('ativa', aba === 'recados');
  el('btnAbaReservas').classList.toggle('ativa', aba === 'reservas');
  el('btnAbaExtras').classList.toggle('ativa', aba === 'extras');
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

  el('btnAbaDocumentos').addEventListener('click', () => trocarAba('documentos'));
  el('btnAbaRecados').addEventListener('click', () => trocarAba('recados'));
  el('btnAbaReservas').addEventListener('click', () => trocarAba('reservas'));
  el('btnAbaExtras').addEventListener('click', () => trocarAba('extras'));

  el('btnSair').addEventListener('click', sair);
});
