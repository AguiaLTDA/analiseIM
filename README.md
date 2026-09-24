# Recursos Estáticos do Frontend (Web UI)

> **Projeto:** Análise de Mistura e Concentração em Leito Fluidizado  
> **Instituição:** CEUNES / UFES  
> **Servidor:** FastAPI ([`app.py`](file:///C:/Users/DELL/Documents/Antigravity%202026/Narcelo%20CEUNES/Mistura%201%25%20PEBD%201,9%20mm%20e%20areia%201,0%20mm/app.py)) montado na rota `/static`

---

## 📂 Arquitetura de Diretórios

```text
static/
├── index.html         # Página principal da aplicação (HTML5 semântico)
├── README.md          # Documentação técnica do frontend (este arquivo)
├── css/
│   └── style.css      # Folha de estilos modular e variáveis de tema
├── js/
│   └── app.js         # Lógica JavaScript (Canvas, API Fetch, ROI e CSV)
└── img/
    ├── favicon.svg    # Ícone vetorial da coluna de leito fluidizado
    └── frame_exemplo.jpg # Imagem experimental de referência para testes rápidos
```

---

## 📄 Descrição dos Módulos

### 1. [`index.html`](file:///C:/Users/DELL/Documents/Antigravity%202026/Narcelo%20CEUNES/Mistura%201%25%20PEBD%201,9%20mm%20e%20areia%201,0%20mm/static/index.html)
* **Função:** Define a estrutura visual da aplicação.
* **Componentes principais:**
  * **Painel Esquerdo (Controles e Canvas):** Botões para upload ou carregamento da imagem padrão, campo de largura da coluna em mm e elemento `<canvas id="mainCanvas">` para seleção interativa da ROI.
  * **Painel Direito (Resultados):** Cards para exibição rápida de estatísticas (Concentração Média, Desvio Padrão, Índice de Lacey e Altura), visualizador com abas (Gráfico $C(z)$ vs Máscara Segmentada) e tabela com botão de exportação CSV.

### 2. [`css/style.css`](file:///C:/Users/DELL/Documents/Antigravity%202026/Narcelo%20CEUNES/Mistura%201%25%20PEBD%201,9%20mm%20e%20areia%201,0%20mm/static/css/style.css)
* **Função:** Responsável por todo o design, responsividade e layout em Grid e Flexbox.
* **Variáveis de Tema:**
  ```css
  --primary: #1e3a8a;       /* Azul acadêmico principal */
  --primary-hover: #1e40af; /* Azul para estados hover */
  --secondary: #0d9488;     /* Verde-petróleo para botões de ação */
  --bg: #f8fafc;            /* Fundo suave da página */
  --card-bg: #ffffff;       /* Fundo dos cartões de conteúdo */
  --border: #e2e8f0;        /* Borda sutil de separadores */
  ```

### 3. [`js/app.js`](file:///C:/Users/DELL/Documents/Antigravity%202026/Narcelo%20CEUNES/Mistura%201%25%20PEBD%201,9%20mm%20e%20areia%201,0%20mm/static/js/app.js)
* **Função:** Controla a interatividade da página sem dependências externas (Pure JavaScript / Vanilla JS).
* **Módulos internos:**
  1. **Manipulação do Canvas:** Captura eventos `mousedown`, `mousemove` e `mouseup` para desenhar o retângulo vermelho da ROI e escurecer a região externa.
  2. **Tratamento de Escala:** Calcula automaticamente a proporção entre as dimensões nativas da imagem e o tamanho exibido na tela (`escalaDisplay`).
  3. **Comunicação com o Backend:** Envia os dados via `FormData` para o endpoint `/api/analisar_roi`.
  4. **Renderização de Resultados:** Recebe os dados em JSON (com imagens codificadas em Base64), popula os cards numéricos, atualiza a tabela e desenha os gráficos.
  5. **Exportador CSV:** Cria dinamicamente um arquivo `.csv` utilizando a API nativa `Blob` e aciona o download automático pelo navegador.

### 4. [`img/`](file:///C:/Users/DELL/Documents/Antigravity%202026/Narcelo%20CEUNES/Mistura%201%25%20PEBD%201,9%20mm%20e%20areia%201,0%20mm/static/img)
* **`favicon.svg`:** Ícone SVG personalizado representando a coluna de leito fluidizado com partículas de compósito (vermelho), matriz de areia (bege) e bolhas de gás (azul).
* **`frame_exemplo.jpg`:** Quadro extraído do vídeo experimental para permitir testes imediatos sem necessidade de upload de arquivos externos.

---

## 🔄 Fluxo de Comunicação Frontend ↔ Backend

```text
[Usuário seleciona ROI no Canvas]
               │
               ▼
[app.js empacota coordenadas e dimensões]
               │
               ▼  POST /api/analisar_roi (multipart/form-data)
       [FastAPI: app.py]
               │
               ├─ Executa K-Means não supervisionado (CIELAB)
               ├─ Calcula perfil C(z) e Índice de Lacey
               └─ Codifica gráfico e máscara em Base64
               │
               ▼  Resposta JSON
[app.js exibe métricas, imagens Base64 e tabela de dados]
```

### Contrato da API (`POST /api/analisar_roi`):

* **Parâmetros Enviados:**
  * `x`: Coordenada X do canto superior esquerdo (pixels)
  * `y`: Coordenada Y do canto superior esquerdo (pixels)
  * `width`: Largura da ROI selecionada (pixels)
  * `height`: Altura da ROI selecionada (pixels)
  * `largura_mm`: Largura real da coluna em mm (ex: `60.0`)
  * `usar_exemplo`: Booleano indicando se usa o quadro padrão
  * `arquivo`: Arquivo binário de imagem (caso seja upload personalizado)

* **Campos Retornados:**
  * `plot_b64`: Imagem PNG do gráfico Matplotlib em Base64.
  * `seg_overlay_b64`: Imagem JPG da máscara segmentada em Base64.
  * `stats`: Objeto contendo `media_comp`, `desvio_comp`, `max_comp`, `altura_total_mm` e `lacey_index`.
  * `perfil`: Lista amostrada de cotas $z$ e concentrações para a tabela visual.
  * `perfil_completo`: Dados completos de todos os pontos para geração do CSV.

---

## 💡 Como Executar e Testar

1. Na primeira vez, crie o ambiente e instale as dependências:
   ```powershell
   python -m venv .venv
   .venv\Scripts\python -m pip install -r requirements.txt
   ```
   Depois, no terminal da pasta raiz do projeto, inicie o backend:
   ```powershell
   .venv\Scripts\python app.py
   ```
   O `app.py` serve os arquivos tanto de uma subpasta `static/` quanto da própria raiz.
2. Abra o navegador em:
   ```
   http://127.0.0.1:8000
   ```
3. Qualquer alteração feita nos arquivos dentro de `static/` (CSS, JS ou HTML) é refletida imediatamente ao recarregar a página no navegador (`Ctrl + F5`).
