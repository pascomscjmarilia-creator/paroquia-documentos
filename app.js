// ============================================================
// CONFIGURAÇÃO — preencha estes 3 valores antes de publicar
// ============================================================
const CONFIG = {
  // Client ID OAuth criado no Google Cloud Console (tela "Credenciais")
  CLIENT_ID: 'COLE_AQUI_SEU_CLIENT_ID.apps.googleusercontent.com',

  // ID da planilha "Pascom_Controle" (está na URL do Google Sheets,
  // entre /d/ e /edit — ex: docs.google.com/spreadsheets/d/ESTE_TRECHO/edit)
  SHEET_ID: 'COLE_AQUI_O_ID_DA_PLANILHA',

  // Nome da aba + intervalo das colunas usadas (A2 pula o cabeçalho)
  SHEET_RANGE: 'Índice de Documentos!A2:F',

  // E-mails autorizados a usar o app (checagem de UX — a segurança
  // de verdade é a permissão de compartilhamento da planilha no Google)
  ALLOWED_EMAILS: ['pascomscjmarilia@gmail.com'],
};
// ============================================================

let accessToken = null;
let linhas = [];

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

  google.accounts.id.initialize({
    client_id: CONFIG.CLIENT_ID,
    callback: () => {}, // não usamos o ID token aqui, só o botão visual
  });

  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/userinfo.email',
    callback: async (resp) => {
      if (resp.error) {
        mostrarErroLogin('Não foi possível entrar com essa conta Google.');
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

    await carregarDados();
  } catch (e) {
    mostrarErroLogin('Erro ao verificar sua conta. Tente novamente.');
  }
}

async function carregarDados() {
  const statusMsg = el('statusMsg');
  statusMsg.textContent = 'Carregando documentos...';

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${encodeURIComponent(CONFIG.SHEET_RANGE)}`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: 'Bearer ' + accessToken },
    });

    if (resp.status === 403) {
      statusMsg.textContent = 'Sua conta Google não tem permissão de acesso a esta planilha. Peça para compartilhá-la com você.';
      return;
    }
    if (!resp.ok) {
      statusMsg.textContent = 'Erro ao carregar dados (status ' + resp.status + ').';
      return;
    }

    const data = await resp.json();
    const valores = data.values || [];

    linhas = valores
      .filter(row => row && row.length > 0)
      .map(row => ({
        data: row[0] || '',
        nome: row[1] || '',
        numero: row[2] || '',
        tipo: row[3] || '',
        arquivo: row[4] || '',
        link: row[5] || '',
      }));

    statusMsg.textContent = linhas.length + ' documento(s) encontrado(s).';
    renderizarTabela();
  } catch (e) {
    statusMsg.textContent = 'Erro de conexão ao carregar a planilha.';
  }
}

function renderizarTabela() {
  const termo = el('busca').value.trim().toLowerCase();
  const tipoFiltro = el('filtroTipo').value;

  const filtradas = linhas.filter(l => {
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function sair() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  linhas = [];
  el('userBox').hidden = true;
  el('appScreen').hidden = true;
  el('loginScreen').hidden = false;
}

window.addEventListener('DOMContentLoaded', () => {
  iniciarBotaoGoogle();

  el('busca').addEventListener('input', renderizarTabela);
  el('filtroTipo').addEventListener('change', renderizarTabela);
  el('btnAtualizar').addEventListener('click', carregarDados);
  el('btnImprimirLista').addEventListener('click', () => window.print());
  el('btnSair').addEventListener('click', sair);
});
