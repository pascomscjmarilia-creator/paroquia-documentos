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

  // E-mails autorizados a usar o app (checagem de UX — a segurança
  // de verdade é a permissão de compartilhamento da planilha no Google)
  ALLOWED_EMAILS: ['pascomscjmarilia@gmail.com'],
};
// ============================================================

let accessToken = null;
let linhasDocs = [];
let linhasRecados = [];

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
  } catch (e) {
    mostrarErroLogin('Erro ao verificar sua conta. Tente novamente.');
  }
}

async function buscarValoresSheet(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${encodeURIComponent(range)}`;
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
  const ehDocs = aba === 'documentos';
  el('abaDocumentos').hidden = !ehDocs;
  el('abaRecados').hidden = ehDocs;
  el('btnAbaDocumentos').classList.toggle('ativa', ehDocs);
  el('btnAbaRecados').classList.toggle('ativa', !ehDocs);
}

function sair() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  linhasDocs = [];
  linhasRecados = [];
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

  el('btnAbaDocumentos').addEventListener('click', () => trocarAba('documentos'));
  el('btnAbaRecados').addEventListener('click', () => trocarAba('recados'));

  el('btnSair').addEventListener('click', sair);
});
