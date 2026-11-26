# Recursos Estáticos do Frontend (Web UI)

> **Projeto:** Análise de Mistura e Concentração em Leito Fluidizado  
> **Instituição:** CEUNES / UFES  
> **Servidor:** FastAPI ([`app.py`](file:///C:/Users/DELL/Documents/Antigravity%202026/Narcelo%20CEUNES/Mistura%201%25%20PEBD%201,9%20mm%20e%20areia%201,0%20mm/app.py)) montado na rota `/static`

---

## 🌐 Versão online (GitHub Pages) — sem servidor

A análise roda **inteira no navegador**, em [`js/analise.js`](js/analise.js) (porta em JavaScript do cálculo do `app.py`:
K-Means em CIELAB, modo UV, perfil C(z), Índice de Lacey e curva de calibração). Por isso o app funciona
como site estático no GitHub Pages, de graça, e as imagens analisadas não saem do computador do usuário.

**Publicar:** no GitHub, *Settings → Pages → Build and deployment*: *Source* = **Deploy from a branch**,
*Branch* = **main** / **(root)**. O site fica em `https://aguialtda.github.io/analiseIM/`.

**Calibração:** fica salva no navegador de quem calibrou. Use **Exportar Calibração** para guardar o arquivo
`.json` e **Importar Calibração** para levar a mesma curva a outro computador ou navegador.

**Concentração média:** é a fração de compósito na área de sólidos da ROI inteira (Σ compósito / Σ sólidos),
a mesma grandeza medida nos padrões de calibração; a média simples das cotas aparece abaixo, só como referência.

**Conversão por densidades:** informe a densidade real do compósito e da areia. A fração de área A vira
fração mássica por w = ρc·k·A / (ρc·k·A + ρa·(1 − A)). O fator k (visibilidade do compósito na imagem:
segregação na superfície, tamanho de grão, sombras) é ajustado nos padrões de calibração do modo; sem padrões,
k = 1. Basta um padrão para ajustar k; a aba Calibração mostra k, R² e a curva junto da reta.

**Partículas e filtro de tamanho:** no painel Análise, escolha o formato do PEBD e da areia (esférica: Ø;
elíptica ou briquete: X, Y e Z, com X e Y no plano da foto e Z a espessura). A área vista na foto é π·Ø²/4,
π·X·Y/4 (elipse) ou X·Y (briquete); o diâmetro equivalente é o do círculo de mesma área. Com o filtro ligado,
manchas de compósito menores que a média geométrica dos diâmetros equivalentes (≈ 1,38 mm para 1,9 e 1,0 mm)
voltam a ser areia: são sombras entre grãos e grãos escuros de areia (em laranja na máscara). Manchas grandes
nunca são removidas, porque grãos de PEBD encostados formam uma mancha só. O filtro depende da escala: a
largura informada deve ser a largura real da ROI (no padrão de calibração, o campo *Largura real da ROI*).
Cada padrão guarda o filtro usado; se ele mudar, o app avisa que a curva precisa ser refeita. O Ø equivalente
da areia também define o nº de partículas por amostra no Índice de Lacey.

**Base de referências (modo supervisionado):** na aba *Base de Referências*, envie uma foto de referência,
arraste para selecionar o quadro que servirá de referência (como na ROI; ele abre ampliado) e pinte nele
regiões de PEBD, areia e gás/fundo. O app guarda uma amostra das cores (CIELAB) de cada classe, ajusta uma
gaussiana por classe (QDA) e mostra a matriz de confusão (validação deixando uma foto de fora quando há duas
ou mais). No modo de leitura *Base de referências*, cada pixel vai para a classe mais provável; pixels longe
de todas as classes ficam como "incertos" (roxo na máscara) e não entram nas contas. A base fica no navegador
e pode ser exportada/importada em JSON. Se a base mudar, refaça a curva de calibração desse modo.

**Dados online (qualquer máquina):** a base de referências e a calibração também ficam no próprio repositório,
em `dados/base_referencias.json` e `dados/calibracao.json`. Ao abrir o site, o app baixa a versão online
(sem login) e só não a aplica se este navegador tiver alterações ainda não enviadas. Para enviar, use
**☁ Salvar online** no topo da página; cada envio vira um commit, então o histórico do Git guarda todas as versões.
Salvar exige um token do GitHub, cadastrado uma vez por navegador no botão **🔑 Token**:
em *github.com/settings/personal-access-tokens/new*, crie um *fine-grained token* com
*Repository access* = **Only select repositories** → `AguiaLTDA/analiseIM` e
*Permissions → Repository → Contents* = **Read and write**. O token fica só no navegador onde foi colado;
em computador compartilhado, remova-o ao terminar (botão 🔑, deixar em branco). Os dados ficam públicos,
como o resto do repositório. Se duas máquinas salvarem a mesma coisa, o app avisa e pergunta qual versão manter.

**Testar localmente:** o `index.html` precisa ser aberto por um servidor (clicar duas vezes no arquivo bloqueia a
leitura dos pixels). Qualquer servidor estático serve, por exemplo `python -m http.server` na pasta do projeto,
ou o próprio `app.py`.

O `app.py` continua no repositório como referência e para uso local; ele não é necessário para o site.
As seções abaixo descrevem a versão original com servidor.

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
