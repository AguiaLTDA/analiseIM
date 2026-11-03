/**
 * ANÁLISE DE MISTURA EM LEITO FLUIDIZADO - CEUNES / UFES
 * Script Frontend: Canvas de ROI, análise no próprio navegador (js/analise.js),
 * calibração salva no navegador (com exportação/importação) e download de CSV.
 */

/**
 * Fábrica de um seletor de ROI (retângulo arrastável) sobre um canvas, com zonas de exclusão.
 * Reaproveitada pela aba de Análise e pela aba de Calibração.
 * Ferramentas: 'roi' (arrastar define a ROI) ou 'exclusao' (traçar à mão livre o contorno
 * de uma zona de exclusão; ao soltar o botão do mouse o contorno se fecha).
 */
function criarSeletorROI(canvas, {
    larguraContainer = 540, tamanhoMinimo = 20, onMudarROI = () => {}, onMudarExclusoes = () => {}
} = {}) {
    const ctx = canvas.getContext('2d');
    let imgObj = new Image();
    let isDrawing = false;
    let startX = 0, startY = 0;
    let roi = { x: 0, y: 0, w: 0, h: 0 };
    let escalaDisplay = 1.0;
    let ferramenta = 'roi';
    // Zonas de exclusão traçadas à mão livre: { pontos: [[x, y], ...], x, y, w, h (caixa), area },
    // em pixels da imagem original
    let exclusoes = [];
    let tracoEmAndamento = null;  // pontos do traço enquanto o botão do mouse está pressionado
    const DIST_MIN_PONTOS = 2;    // px entre pontos consecutivos do traço
    const AREA_MIN_EXCLUSAO = 9;  // px²; traços menores (um clique) são ignorados

    function caminho(pontos, fechar) {
        ctx.beginPath();
        pontos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (fechar) ctx.closePath();
    }

    function desenharExclusao(pontos, provisoria) {
        if (pontos.length < 2) return;
        const xs = pontos.map(p => p[0]), ys = pontos.map(p => p[1]);
        const bx = Math.min(...xs), by = Math.min(...ys);
        const bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;

        ctx.save();
        caminho(pontos, true);
        ctx.fillStyle = provisoria ? 'rgba(30, 30, 30, 0.35)' : 'rgba(30, 30, 30, 0.55)';
        ctx.fill();
        // Hachura diagonal recortada pelo contorno
        ctx.clip();
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
        ctx.lineWidth = 2;
        for (let d = -bh; d < bw; d += 12) {
            ctx.moveTo(bx + d, by + bh);
            ctx.lineTo(bx + d + bh, by);
        }
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        if (provisoria) {
            caminho(pontos, false);  // enquanto desenha: traço aberto + fechamento tracejado
            ctx.stroke();
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(...pontos[pontos.length - 1]);
            ctx.lineTo(...pontos[0]);
            ctx.stroke();
        } else {
            ctx.setLineDash([8, 4]);
            caminho(pontos, true);
            ctx.stroke();
        }
        ctx.restore();
    }

    function configurarCanvas() {
        escalaDisplay = larguraContainer / imgObj.naturalWidth;
        canvas.width = imgObj.naturalWidth;
        canvas.height = imgObj.naturalHeight;
        canvas.style.width = (imgObj.naturalWidth * escalaDisplay) + 'px';
        canvas.style.height = (imgObj.naturalHeight * escalaDisplay) + 'px';
    }

    function atualizarDesenho() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgObj, 0, 0);

        if (roi.w > 0 && roi.h > 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(0, 0, canvas.width, roi.y);
            ctx.fillRect(0, roi.y + roi.h, canvas.width, canvas.height - (roi.y + roi.h));
            ctx.fillRect(0, roi.y, roi.x, roi.h);
            ctx.fillRect(roi.x + roi.w, roi.y, canvas.width - (roi.x + roi.w), roi.h);

            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3;
            ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);

            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText('ROI ATIVA', roi.x + 8, roi.y + 22);
        }

        exclusoes.forEach((z, i) => {
            desenharExclusao(z.pontos, false);
            ctx.save();
            ctx.font = 'bold 13px sans-serif';
            ctx.fillStyle = '#fbbf24';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.lineWidth = 3;
            ctx.strokeText(`EXCLUÍDA ${i + 1}`, z.x + 2, Math.max(14, z.y - 4));
            ctx.fillText(`EXCLUÍDA ${i + 1}`, z.x + 2, Math.max(14, z.y - 4));
            ctx.restore();
        });
        if (tracoEmAndamento) desenharExclusao(tracoEmAndamento, true);
    }

    function retanguloEntre(x0, y0, x1, y1) {
        return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    }

    /** Área do polígono (fórmula do laço / shoelace), em px². */
    function areaPoligono(pontos) {
        let a = 0;
        for (let i = 0; i < pontos.length; i++) {
            const [x1, y1] = pontos[i], [x2, y2] = pontos[(i + 1) % pontos.length];
            a += x1 * y2 - x2 * y1;
        }
        return Math.abs(a) / 2;
    }

    function criarZona(pontos) {
        const xs = pontos.map(p => p[0]), ys = pontos.map(p => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys);
        return {
            pontos, x, y,
            w: Math.max(...xs) - x, h: Math.max(...ys) - y,
            area: Math.round(areaPoligono(pontos)),
        };
    }

    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        return {
            x: Math.round((clientX - rect.left) / escalaDisplay),
            y: Math.round((clientY - rect.top) / escalaDisplay)
        };
    }

    canvas.addEventListener('mousedown', (e) => {
        if (!imgObj.src) return;
        const pt = getCanvasCoords(e);
        isDrawing = true;
        startX = Math.max(0, Math.min(canvas.width, pt.x));
        startY = Math.max(0, Math.min(canvas.height, pt.y));
        if (ferramenta === 'exclusao') tracoEmAndamento = [[startX, startY]];
        else roi = { x: startX, y: startY, w: 0, h: 0 };
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const pt = getCanvasCoords(e);
        const curX = Math.max(0, Math.min(canvas.width, pt.x));
        const curY = Math.max(0, Math.min(canvas.height, pt.y));

        if (ferramenta === 'exclusao') {
            const [ux, uy] = tracoEmAndamento[tracoEmAndamento.length - 1];
            if (Math.hypot(curX - ux, curY - uy) >= DIST_MIN_PONTOS) {
                tracoEmAndamento.push([curX, curY]);
                atualizarDesenho();
            }
        } else {
            roi = retanguloEntre(startX, startY, curX, curY);
            atualizarDesenho();
            onMudarROI(roi, false);
        }
    });

    window.addEventListener('mouseup', () => {
        if (!isDrawing) return;
        isDrawing = false;
        if (ferramenta === 'exclusao') {
            // Soltar o botão fecha o contorno (liga o último ponto ao primeiro)
            const pontos = tracoEmAndamento;
            tracoEmAndamento = null;
            if (pontos && pontos.length >= 3) {
                const zona = criarZona(pontos);
                if (zona.area >= AREA_MIN_EXCLUSAO) {
                    exclusoes.push(zona);
                    onMudarExclusoes(exclusoes.slice());
                }
            }
            atualizarDesenho();
        } else {
            onMudarROI(roi, true);
        }
    });

    /** Máscara (1 = excluído) das zonas de exclusão dentro da ROI, ou null se nenhuma a atinge. */
    function mascaraExclusao(x0, y0, w, h) {
        const atingem = exclusoes.filter(z => z.x < x0 + w && z.x + z.w > x0 && z.y < y0 + h && z.y + z.h > y0);
        if (!atingem.length) return null;

        // Rasteriza os contornos num canvas do tamanho da ROI (pixel excluído se ficar mais da metade dentro)
        const aux = document.createElement('canvas');
        aux.width = w;
        aux.height = h;
        const auxCtx = aux.getContext('2d');
        auxCtx.translate(-x0, -y0);
        auxCtx.fillStyle = '#000';
        atingem.forEach(z => {
            auxCtx.beginPath();
            z.pontos.forEach(([x, y], i) => (i ? auxCtx.lineTo(x, y) : auxCtx.moveTo(x, y)));
            auxCtx.closePath();
            auxCtx.fill();
        });
        const alfa = auxCtx.getImageData(0, 0, w, h).data;
        const mascara = new Uint8Array(w * h);
        let algum = false;
        for (let i = 0; i < w * h; i++) {
            if (alfa[i * 4 + 3] >= 128) { mascara[i] = 1; algum = true; }
        }
        return algum ? mascara : null;
    }

    return {
        carregarImagem(src, aoCarregar) {
            imgObj = new Image();
            imgObj.onload = () => {
                configurarCanvas();
                roi = { x: 0, y: 0, w: 0, h: 0 };
                // Zonas de exclusão valem para uma imagem; uma imagem nova começa sem nenhuma
                exclusoes = [];
                onMudarExclusoes([]);
                atualizarDesenho();
                if (aoCarregar) aoCarregar(imgObj.naturalWidth, imgObj.naturalHeight);
            };
            imgObj.src = src;
        },
        definirFerramenta(f) { ferramenta = f; },
        removerExclusao(indice) {
            exclusoes = exclusoes.filter((_, i) => i !== indice);
            atualizarDesenho();
            onMudarExclusoes(exclusoes.slice());
        },
        limparExclusoes() {
            exclusoes = [];
            atualizarDesenho();
            onMudarExclusoes([]);
        },
        definirROI(novaRoi) {
            roi = novaRoi;
            atualizarDesenho();
            onMudarROI(roi, true);
        },
        getROI: () => roi,
        roiValida: () => roi.w >= tamanhoMinimo && roi.h >= tamanhoMinimo,
        /**
         * Pixels RGBA da ROI na resolução original (sem o desenho da ROI por cima), com
         * `excluido` = máscara das zonas de exclusão dentro da ROI (ou ausente se não houver).
         */
        extrairPixelsROI() {
            const w = imgObj.naturalWidth, h = imgObj.naturalHeight;
            const x0 = Math.max(0, roi.x), y0 = Math.max(0, roi.y);
            const x1 = Math.min(w, roi.x + roi.w), y1 = Math.min(h, roi.y + roi.h);
            if (x1 - x0 < tamanhoMinimo || y1 - y0 < tamanhoMinimo) {
                throw new Error('ROI muito pequena ou fora da imagem.');
            }
            const aux = document.createElement('canvas');
            aux.width = x1 - x0;
            aux.height = y1 - y0;
            const auxCtx = aux.getContext('2d');
            auxCtx.drawImage(imgObj, x0, y0, aux.width, aux.height, 0, 0, aux.width, aux.height);
            const { data } = auxCtx.getImageData(0, 0, aux.width, aux.height);
            const excluido = mascaraExclusao(x0, y0, aux.width, aux.height);
            return excluido
                ? { data, width: aux.width, height: aux.height, excluido }
                : { data, width: aux.width, height: aux.height };
        },
    };
}

/**
 * Liga os botões "Selecionar ROI" / "Zona de exclusão" / "Limpar" e a lista de zonas
 * de um seletor. Retorna a função que redesenha a lista (usada no onMudarExclusoes).
 */
function criarControlesExclusao(obterSeletor, { btnRoi, btnExclusao, btnLimpar, lista }) {
    const el = id => document.getElementById(id);

    function escolher(ferramenta) {
        obterSeletor().definirFerramenta(ferramenta);
        el(btnRoi).classList.toggle('ativo', ferramenta === 'roi');
        el(btnExclusao).classList.toggle('ativo', ferramenta === 'exclusao');
    }
    el(btnRoi).addEventListener('click', () => escolher('roi'));
    el(btnExclusao).addEventListener('click', () => escolher('exclusao'));
    el(btnLimpar).addEventListener('click', () => obterSeletor().limparExclusoes());

    return function renderizar(exclusoes) {
        el(btnLimpar).disabled = exclusoes.length === 0;
        const container = el(lista);
        container.innerHTML = '';
        exclusoes.forEach((r, i) => {
            const chip = document.createElement('span');
            chip.className = 'chip-exclusao';
            chip.textContent = `Zona ${i + 1}: ${r.area.toLocaleString('pt-BR')} px²`;
            const remover = document.createElement('button');
            remover.title = 'Remover esta zona';
            remover.textContent = '✕';
            remover.addEventListener('click', () => obterSeletor().removerExclusao(i));
            chip.appendChild(remover);
            container.appendChild(chip);
        });
    };
}

/** Executa um cálculo pesado depois de o navegador desenhar o indicador de carregamento. */
function executarDepoisDePintar(fn) {
    return new Promise((resolve, reject) => {
        let executado = false;
        const executar = () => {
            if (executado) return;
            executado = true;
            try { resolve(fn()); } catch (err) { reject(err); }
        };
        // requestAnimationFrame fica pausado com a aba em segundo plano; o temporizador garante a execução
        requestAnimationFrame(() => setTimeout(executar, 0));
        setTimeout(executar, 100);
    });
}

function mensagemErro(err) {
    // Canvas "contaminado": acontece ao abrir o index.html direto do disco (file://)
    if (err && err.name === 'SecurityError') {
        return 'o navegador bloqueou a leitura dos pixels. Abra o app pelo endereço do GitHub Pages ' +
               'ou por um servidor local, não clicando duas vezes no index.html.';
    }
    return err && err.message ? err.message : String(err);
}

function baixarArquivo(conteudo, nome, tipo) {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Calibração salva no navegador (localStorage), separada por modo de leitura.
 * Se o armazenamento estiver bloqueado (janela anônima etc.), fica só na memória desta aba.
 */
const Calibracao = (() => {
    const CHAVE = 'analiseIM.calibracao.v1';
    let memoria = null;

    function normalizar(dados) {
        const out = {};
        Analise.MODOS.forEach(modo => {
            const d = (dados && dados[modo]) || {};
            out[modo] = { pontos: Array.isArray(d.pontos) ? d.pontos : [], coef: d.coef || null };
        });
        return out;
    }

    function carregar() {
        try {
            const bruto = localStorage.getItem(CHAVE);
            if (bruto) return normalizar(JSON.parse(bruto));
        } catch (e) { /* armazenamento indisponível */ }
        return normalizar(memoria);
    }

    function salvar(dados) {
        memoria = dados;
        try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (e) { /* fica só na memória */ }
    }

    /** Valida um arquivo exportado (ou o formato do antigo calibracao.json do servidor). */
    function validarImportacao(json) {
        const dados = json && json.dados ? json.dados : json;
        if (!dados || typeof dados !== 'object') throw new Error('arquivo sem dados de calibração.');
        const modosPresentes = Analise.MODOS.filter(m => dados[m]);
        if (!modosPresentes.length) throw new Error('nenhum modo de leitura encontrado no arquivo.');
        modosPresentes.forEach(m => {
            const pontos = dados[m].pontos || [];
            if (!Array.isArray(pontos) || pontos.some(p => typeof p.x !== 'number' || typeof p.y !== 'number')) {
                throw new Error(`pontos inválidos no modo "${m}".`);
            }
        });
        return normalizar(dados);
    }

    return { carregar, salvar, validarImportacao };
})();

document.addEventListener('DOMContentLoaded', () => {
    // -----------------------------------------------------------------
    // Navegação entre as abas Análise / Calibração
    // -----------------------------------------------------------------
    window.mudarView = function (view) {
        document.getElementById('viewAnalise').style.display = view === 'analise' ? 'grid' : 'none';
        document.getElementById('viewCalibracao').style.display = view === 'calibracao' ? 'grid' : 'none';
        document.getElementById('navAnalise').classList.toggle('active', view === 'analise');
        document.getElementById('navCalibracao').classList.toggle('active', view === 'calibracao');
        if (view === 'calibracao') carregarPontosCalibracao();
    };

    // -----------------------------------------------------------------
    // Aba 1: Análise
    // -----------------------------------------------------------------
    const btnCarregarExemplo = document.getElementById('btnCarregarExemplo');
    const inputArquivo = document.getElementById('inputArquivo');
    const btnAnalisar = document.getElementById('btnAnalisar');
    const roiCoordsLabel = document.getElementById('roiCoords');
    const roiDimsLabel = document.getElementById('roiDims');
    const btnDownloadCSV = document.getElementById('btnDownloadCSV');
    const modoLeitura = document.getElementById('modoLeitura');

    let resultadoGlobal = null;

    const seletor = criarSeletorROI(document.getElementById('mainCanvas'), {
        onMudarROI(roi, finalizado) {
            roiCoordsLabel.innerText = `ROI: X=${roi.x}, Y=${roi.y}`;
            roiDimsLabel.innerText = `Tamanho: ${roi.w} x ${roi.h} px`;
            if (finalizado && seletor.roiValida()) btnAnalisar.disabled = false;
        },
        onMudarExclusoes: lista => renderizarExclusoes(lista),
    });
    const renderizarExclusoes = criarControlesExclusao(() => seletor, {
        btnRoi: 'ferrROI', btnExclusao: 'ferrExcl', btnLimpar: 'btnLimparExcl', lista: 'listaExcl',
    });

    modoLeitura.addEventListener('change', () => {
        document.getElementById('badgeModo').innerText = modoLeitura.value === 'uv'
            ? 'Fluorescência UV (compósito verde)'
            : 'IA Não Supervisionada (CIELAB)';
    });

    carregarImagemPadrao();

    function carregarImagemPadrao() {
        seletor.carregarImagem('img/frame_exemplo.jpg', (w, h) => {
            // Define ROI inicial padrão bem ajustada ao leito
            seletor.definirROI({
                x: Math.round(w * 0.38),
                y: Math.round(h * 0.32),
                w: Math.round(w * 0.30),
                h: Math.round(h * 0.40)
            });
            btnAnalisar.disabled = false;
        });
    }

    btnCarregarExemplo.addEventListener('click', carregarImagemPadrao);

    inputArquivo.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            seletor.carregarImagem(event.target.result, () => {
                btnAnalisar.disabled = true;
                roiCoordsLabel.innerText = 'ROI: Arraste o mouse na imagem para selecionar';
                roiDimsLabel.innerText = 'Tamanho: 0 x 0 px';
            });
        };
        reader.readAsDataURL(file);
    });

    // Análise executada no próprio navegador
    btnAnalisar.addEventListener('click', () => {
        if (!seletor.roiValida()) return;

        document.getElementById('loadingSpinner').style.display = 'block';
        document.getElementById('placeholderMsg').style.display = 'none';
        document.getElementById('imgGrafico').style.display = 'none';
        document.getElementById('imgSegmentada').style.display = 'none';
        btnAnalisar.disabled = true;

        const modo = modoLeitura.value;
        const larguraMm = parseFloat(document.getElementById('colLargura').value);

        executarDepoisDePintar(() => {
            const pixels = seletor.extrairPixelsROI();
            const coef = Calibracao.carregar()[modo].coef;
            const resultado = Analise.analisarROI(pixels, larguraMm, modo, coef);
            resultado.plot = Analise.gerarGrafico(resultado.perfil, resultado.stats);
            resultado.overlay = Analise.gerarOverlay(pixels, resultado.seg);
            return resultado;
        })
        .then(resultado => {
            resultadoGlobal = resultado;
            exibirResultados(resultado);
        })
        .catch(err => {
            document.getElementById('placeholderMsg').style.display = 'block';
            alert('Falha na análise da ROI: ' + mensagemErro(err));
        })
        .finally(() => {
            document.getElementById('loadingSpinner').style.display = 'none';
            btnAnalisar.disabled = false;
        });
    });

    function exibirResultados(data) {
        // Atualiza Cards de Métricas
        document.getElementById('valMedia').innerText = data.stats.media_comp + ' %';
        document.getElementById('valDesvio').innerText = data.stats.desvio_comp + ' %';
        document.getElementById('valLacey').innerText = data.stats.lacey_index !== null ? data.stats.lacey_index : 'n/d';
        document.getElementById('valAltura').innerText = data.stats.altura_total_mm + ' mm';
        document.getElementById('valMassica').innerText = data.stats.calibrado
            ? data.stats.media_comp_massica + ' %'
            : 'não calibrado';
        document.getElementById('valExcluido').innerText = data.stats.excluido_pct + ' %';

        // Atualiza Imagens
        document.getElementById('imgGrafico').src = data.plot;
        document.getElementById('imgSegmentada').src = data.overlay;

        alternarAba('grafico');

        // Preenche Tabela
        const corpo = document.getElementById('tabelaCorpo');
        corpo.innerHTML = '';
        if (!data.tabela.length) {
            corpo.innerHTML = '<tr><td colspan="4" style="color: var(--text-muted);">Nenhuma cota com leito identificada na ROI.</td></tr>';
        }
        data.tabela.forEach(row => {
            const massico = row.c_pct_massico !== null && row.c_pct_massico !== undefined
                ? row.c_pct_massico.toFixed(2) + '%' : '-';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><b>${row.z_mm.toFixed(1)}</b></td>
                <td style="color: #8b0000; font-weight: 600;">${row.c_pct.toFixed(2)}%</td>
                <td style="color: #1e3a8a; font-weight: 600;">${massico}</td>
                <td style="color: #0d9488;">${row.gas_pct.toFixed(1)}%</td>
            `;
            corpo.appendChild(tr);
        });

        btnDownloadCSV.disabled = false;
    }

    // Alternador de Abas de Visualização (gráfico / máscara segmentada)
    window.alternarAba = function(tipo) {
        const imgG = document.getElementById('imgGrafico');
        const imgS = document.getElementById('imgSegmentada');
        const tabG = document.getElementById('tabGrafico');
        const tabS = document.getElementById('tabSegmentado');

        if (tipo === 'grafico') {
            imgG.style.display = 'block';
            imgS.style.display = 'none';
            tabG.classList.add('active');
            tabS.classList.remove('active');
        } else {
            imgG.style.display = 'none';
            imgS.style.display = 'block';
            tabG.classList.remove('active');
            tabS.classList.add('active');
        }
    };

    // Download CSV
    btnDownloadCSV.addEventListener('click', () => {
        if (!resultadoGlobal) return;
        const full = resultadoGlobal.perfil_completo;
        let csvContent = 'Cota_z_mm;Concentracao_Comp_pct;Concentracao_Massica_Calibrada_pct;Fracao_Gas_pct\n';
        for (let i = 0; i < full.z_mm.length; i++) {
            const c = full.c_pct[i] !== null ? full.c_pct[i] : '';
            const m = full.c_pct_massico[i] !== null ? full.c_pct_massico[i] : '';
            const g = full.gas_pct[i] !== null ? full.gas_pct[i] : '';
            csvContent += `${full.z_mm[i]};${c};${m};${g}\n`;
        }
        baixarArquivo(csvContent, 'perfil_roi_concentracao.csv', 'text/csv;charset=utf-8;');
    });

    // -----------------------------------------------------------------
    // Aba 2: Calibração (curva C(z) medido -> fração mássica real)
    // -----------------------------------------------------------------
    const calModo = document.getElementById('calModo');
    const calFracaoReal = document.getElementById('calFracaoReal');
    const calInputArquivo = document.getElementById('calInputArquivo');
    const calRoiCoords = document.getElementById('calRoiCoords');
    const calRoiDims = document.getElementById('calRoiDims');
    const btnCalAdicionar = document.getElementById('btnCalAdicionar');
    const btnCalAjustar = document.getElementById('btnCalAjustar');
    const calTabelaPontos = document.getElementById('calTabelaPontos');
    const calModoLabel = document.getElementById('calModoLabel');
    const btnCalExportar = document.getElementById('btnCalExportar');
    const calInputImportar = document.getElementById('calInputImportar');

    let calImagemCarregada = false;

    const seletorCal = criarSeletorROI(document.getElementById('calCanvas'), {
        onMudarROI(roi) {
            calRoiCoords.innerText = `ROI: X=${roi.x}, Y=${roi.y}`;
            calRoiDims.innerText = `Tamanho: ${roi.w} x ${roi.h} px`;
            atualizarEstadoBtnAdicionar();
        },
        onMudarExclusoes: lista => renderizarExclusoesCal(lista),
    });
    const renderizarExclusoesCal = criarControlesExclusao(() => seletorCal, {
        btnRoi: 'calFerrROI', btnExclusao: 'calFerrExcl', btnLimpar: 'calBtnLimparExcl', lista: 'calListaExcl',
    });

    function atualizarEstadoBtnAdicionar() {
        const fracao = parseFloat(calFracaoReal.value);
        const fracaoOk = calFracaoReal.value !== '' && !isNaN(fracao);
        btnCalAdicionar.disabled = !(calImagemCarregada && seletorCal.roiValida() && fracaoOk);
    }

    calFracaoReal.addEventListener('input', atualizarEstadoBtnAdicionar);

    calInputArquivo.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            seletorCal.carregarImagem(event.target.result, () => {
                calImagemCarregada = true;
                calRoiCoords.innerText = 'ROI: Arraste o mouse na imagem para selecionar';
                calRoiDims.innerText = 'Tamanho: 0 x 0 px';
                atualizarEstadoBtnAdicionar();
            });
        };
        reader.readAsDataURL(file);
    });

    calModo.addEventListener('change', () => {
        calModoLabel.innerText = calModo.value === 'uv' ? 'Fluorescência UV' : 'Luminosidade';
        carregarPontosCalibracao();
    });

    /**
     * Grava os pontos de um modo. Se já havia curva ajustada, ela é recalculada com os
     * pontos atuais (ou descartada se sobrarem menos de 3), para nunca ficar desatualizada.
     */
    function atualizarPontos(modo, pontos) {
        const dados = Calibracao.carregar();
        dados[modo].pontos = pontos;
        if (dados[modo].coef) {
            dados[modo].coef = pontos.length >= Analise.MIN_PONTOS_AJUSTE ? Analise.ajustarCurva(pontos) : null;
        }
        Calibracao.salvar(dados);
        renderizarPontosCalibracao(dados[modo].pontos, dados[modo].coef);
    }

    btnCalAdicionar.addEventListener('click', () => {
        if (!seletorCal.roiValida() || !calImagemCarregada) return;
        const fracaoReal = parseFloat(calFracaoReal.value);
        if (!(fracaoReal >= 0 && fracaoReal <= 100)) {
            alert('A fração mássica real deve estar entre 0 e 100%.');
            return;
        }
        btnCalAdicionar.disabled = true;
        const modo = calModo.value;

        executarDepoisDePintar(() => Analise.medirFracaoHomogenea(seletorCal.extrairPixelsROI(), modo))
            .then(cMedido => {
                const pontos = Calibracao.carregar()[modo].pontos.concat({
                    x: Math.round(cMedido * 1000) / 1000,
                    y: Math.round(fracaoReal * 1000) / 1000,
                    criado_em: new Date().toISOString().slice(0, 19) + '+00:00',
                });
                atualizarPontos(modo, pontos);
                calFracaoReal.value = '';
            })
            .catch(err => alert('Falha ao adicionar ponto de calibração: ' + mensagemErro(err)))
            .finally(() => atualizarEstadoBtnAdicionar());
    });

    function carregarPontosCalibracao() {
        const dados = Calibracao.carregar()[calModo.value];
        renderizarPontosCalibracao(dados.pontos, dados.coef);
    }

    function renderizarPontosCalibracao(pontos, coef) {
        calTabelaPontos.innerHTML = '';
        if (!pontos.length) {
            calTabelaPontos.innerHTML = '<tr><td colspan="4" style="color: var(--text-muted);">Nenhum ponto cadastrado.</td></tr>';
        } else {
            pontos.forEach((p, i) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${i + 1}</td>
                    <td>${p.x.toFixed(2)}</td>
                    <td>${p.y.toFixed(2)}</td>
                    <td><button class="btn btn-outline" style="padding:4px 10px;font-size:0.75rem;" data-indice="${i}">✕</button></td>
                `;
                calTabelaPontos.appendChild(tr);
            });
            calTabelaPontos.querySelectorAll('button[data-indice]').forEach(btn => {
                btn.addEventListener('click', () => removerPontoCalibracao(parseInt(btn.dataset.indice, 10)));
            });
        }
        btnCalAjustar.disabled = pontos.length < Analise.MIN_PONTOS_AJUSTE;
        exibirCoefCalibracao(coef, pontos);
    }

    function removerPontoCalibracao(indice) {
        const modo = calModo.value;
        const pontos = Calibracao.carregar()[modo].pontos.filter((_, i) => i !== indice);
        atualizarPontos(modo, pontos);
    }

    btnCalAjustar.addEventListener('click', () => {
        const modo = calModo.value;
        const dados = Calibracao.carregar();
        try {
            dados[modo].coef = Analise.ajustarCurva(dados[modo].pontos);
            Calibracao.salvar(dados);
            exibirCoefCalibracao(dados[modo].coef, dados[modo].pontos);
        } catch (err) {
            alert('Falha ao calcular a calibração: ' + mensagemErro(err));
        }
    });

    function exibirCoefCalibracao(coef, pontos) {
        if (!coef) {
            document.getElementById('calResultado').style.display = 'none';
            return;
        }
        document.getElementById('calFormula').innerText = `y = ${coef.a} + ${coef.b}·x`;
        document.getElementById('calR2').innerText = coef.r2 !== null ? coef.r2 : '-';
        document.getElementById('calLD').innerText = coef.ld !== null ? coef.ld + ' %' : '-';
        document.getElementById('calLQ').innerText = coef.lq !== null ? coef.lq + ' %' : '-';
        document.getElementById('calGrafico').src = Analise.gerarGraficoCalibracao(pontos, coef, calModo.value);
        document.getElementById('calResultado').style.display = 'block';
    }

    // Exportar / importar a calibração (para levar a outro computador ou guardar cópia)
    btnCalExportar.addEventListener('click', () => {
        const arquivo = {
            app: 'analiseIM',
            versao: 1,
            exportado_em: new Date().toISOString(),
            dados: Calibracao.carregar(),
        };
        baixarArquivo(JSON.stringify(arquivo, null, 2), 'calibracao_analiseIM.json', 'application/json');
    });

    calInputImportar.addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const dados = Calibracao.validarImportacao(JSON.parse(event.target.result));
                const resumo = Analise.MODOS.map(m => `${m}: ${dados[m].pontos.length} ponto(s)`).join(', ');
                if (!confirm(`Substituir a calibração deste navegador pela do arquivo?\n(${resumo})`)) return;
                Calibracao.salvar(dados);
                carregarPontosCalibracao();
            } catch (err) {
                alert('Arquivo de calibração inválido: ' + mensagemErro(err));
            }
        };
        reader.readAsText(file);
    });

    calModoLabel.innerText = calModo.value === 'uv' ? 'Fluorescência UV' : 'Luminosidade';
});
