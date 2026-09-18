
`app.js` completo, com Client ID e ID da planilha configurados. Atualizado em `C:\Users\Dell\Downloads\paroquia-documentos-app\app.js`.

**Agora é só reenviar esse arquivo pro GitHub, substituindo o antigo:**

1. Vá em [github.com/pascomscjmarilia-creator/paroquia-documentos](https://github.com/pascomscjmarilia-creator/paroquia-documentos)
2. Clique no arquivo **`app.js`**
3. Clique no ícone de lápis ✏️ (**Edit this file**) no canto superior direito
4. Apague todo o conteúdo (Ctrl+A, Delete) e cole o conteúdo do novo `app.js` que está na sua pasta Downloads
5. Role para baixo, clique em **Commit changes** (pode usar a mensagem "Configura Client ID e planilha")

Depois disso, teste o login em [https://pascomscjmarilia-creator.github.io/paroquia-documentos/](https://pascomscjmarilia-creator.github.io/paroquia-documentos/) usando a conta `pascomscjmarilia@gmail.com`.

Enquanto isso, aqui está o node que falta no n8n para popular a planilha automaticamente sempre que um documento for salvo no Drive — copie e adicione um novo node **Google Sheets** logo depois do node `📁 Salvar no Google Drive`:

**Configuração do node novo (`📊 Registrar no Índice`):**
- **Resource**: Sheet within Document
- **Operation**: Append Row
- **Document**: selecione a planilha "Pascom_Controle" (ID `1-9ZRasNVZK3qX3j51QffsZjOzI59axMkh4pCZxxhFws`)
- **Sheet**: "Índice de Documentos"
- **Mapeamento das colunas:**
  - `Data/Hora`: `={{ $now.setZone('America/Sao_Paulo').toFormat('dd/MM/yyyy HH:mm') }}`
  - `Contato`: `={{ $('📁 Classificar Documento').item.json.pushName }}`
  - `Número`: `={{ $('📁 Classificar Documento').item.json.numero }}`
  - `Tipo`: `={{ ({'PIX_DIZIMO':'PIX Dízimo','PIX_DOACAO':'PIX Doação','DOCUMENTOS':'Documentos'})[$('📁 Classificar Documento').item.json.pastaDestino] }}`
  - `Arquivo`: `={{ $json.name }}`
  - `Link`: `={{ $json.webViewLink }}`

Teste o login primeiro e me avisa o resultado antes de mexer no n8n.
