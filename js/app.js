/**
 * ANÁLISE DE MISTURA EM LEITO FLUIDIZADO - CEUNES / UFES
 * Script Frontend: Manipulação do Canvas de ROI, Chamadas à API e Download de CSV
 */

/**
 * Fábrica de um seletor de ROI (retângulo arrastável) sobre um canvas.
 * Reaproveitada pela aba de Análise e pela aba de Calibração.
 */
function criarSeletorROI(canvas, { larguraContainer = 540, tamanhoMinimo = 20, onMudarROI = () => {} } = {}) {
    const ctx = canvas.getContext('2d');
    let imgObj = new Image();
    let isDrawing = false;
    let startX = 0, startY = 0;
    let roi = { x: 0, y: 0, w: 0, h: 0 };
    let escalaDisplay = 1.0;

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
        startX = pt.x;
        startY = pt.y;
        roi = { x: startX, y: startY, w: 0, h: 0 };
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const pt = getCanvasCoords(e);
        const curX = Math.max(0, Math.min(canvas.width, pt.x));
        const curY = Math.max(0, Math.min(canvas.height, pt.y));

        roi.x = Math.min(startX, curX);
        roi.y = Math.min(startY, curY);
        roi.w = Math.abs(curX - startX);
        roi.h = Math.abs(curY - startY);

        atualizarDesenho();
        onMudarROI(roi, false);
    });

    window.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            onMudarROI(roi, true);
        }
    });

    return {
        carregarImagem(src, aoCarregar) {
            imgObj = new Image();
            imgObj.onload = () => {
                configurarCanvas();
                roi = { x: 0, y: 0, w: 0, h: 0 };
                atualizarDesenho();
                if (aoCarregar) aoCarregar(imgObj.naturalWidth, imgObj.naturalHeight);
            };
            imgObj.src = src;
        },
        definirROI(novaRoi) {
            roi = novaRoi;
            atualizarDesenho();
            onMudarROI(roi, true);
        },
        getROI: () => roi,
        roiValida: () => roi.w >= tamanhoMinimo && roi.h >= tamanhoMinimo,
    };
}

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

    let currentFile = null;
    let isUsingSample = true;
    let resultadoGlobal = null;

    const seletor = criarSeletorROI(document.getElementById('mainCanvas'), {
        onMudarROI(roi, finalizado) {
            roiCoordsLabel.innerText = `ROI: X=${roi.x}, Y=${roi.y}`;
            roiDimsLabel.innerText = `Tamanho: ${roi.w} x ${roi.h} px`;
            if (finalizado && seletor.roiValida()) btnAnalisar.disabled = false;
        }
    });

    modoLeitura.addEventListener('change', () => {
        document.getElementById('badgeModo').innerText = modoLeitura.value === 'uv'
            ? 'Fluorescência UV (compósito verde)'
            : 'IA Não Supervisionada (CIELAB)';
    });

    carregarImagemPadrao();

    function carregarImagemPadrao() {
        fetch('/api/imagem_exemplo')
            .then(r => r.json())
            .then(data => {
                seletor.carregarImagem('data:image/jpeg;base64,' + data.imagem_base64, (w, h) => {
                    // Define ROI inicial padrão bem ajustada ao leito
                    seletor.definirROI({
                        x: Math.round(w * 0.38),
                        y: Math.round(h * 0.32),
                        w: Math.round(w * 0.30),
                        h: Math.round(h * 0.40)
                    });
                    btnAnalisar.disabled = false;
                });
                isUsingSample = true;
                currentFile = null;
            })
            .catch(err => {
                console.error("Erro ao carregar imagem padrão:", err);
            });
    }

    btnCarregarExemplo.addEventListener('click', carregarImagemPadrao);

    inputArquivo.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        currentFile = file;
        isUsingSample = false;
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

    // Envio para o Backend FastAPI e Processamento
    btnAnalisar.addEventListener('click', () => {
        const roi = seletor.getROI();
        if (!seletor.roiValida()) return;

        document.getElementById('loadingSpinner').style.display = 'block';
        document.getElementById('placeholderMsg').style.display = 'none';
        document.getElementById('imgGrafico').style.display = 'none';
        document.getElementById('imgSegmentada').style.display = 'none';
        btnAnalisar.disabled = true;

        const formData = new FormData();
        formData.append('x', roi.x);
        formData.append('y', roi.y);
        formData.append('width', roi.w);
        formData.append('height', roi.h);
        formData.append('largura_mm', document.getElementById('colLargura').value);
        formData.append('usar_exemplo', isUsingSample);
        formData.append('modo', modoLeitura.value);

        if (!isUsingSample && currentFile) {
            formData.append('arquivo', currentFile);
        }

        fetch('/api/analisar_roi', {
            method: 'POST',
            body: formData
        })
        .then(r => {
            if (!r.ok) throw new Error('Erro na resposta do servidor.');
            return r.json();
        })
        .then(data => {
            resultadoGlobal = data;
            exibirResultados(data);
        })
        .catch(err => {
            alert('Falha na análise da ROI: ' + err.message);
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
        document.getElementById('valLacey').innerText = data.stats.lacey_index;
        document.getElementById('valAltura').innerText = data.stats.altura_total_mm + ' mm';
        document.getElementById('valMassica').innerText = data.stats.calibrado
            ? data.stats.media_comp_massica + ' %'
            : 'não calibrado';

        // Atualiza Imagens
        const imgG = document.getElementById('imgGrafico');
        const imgS = document.getElementById('imgSegmentada');
        imgG.src = 'data:image/png;base64,' + data.plot_b64;
        imgS.src = 'data:image/jpeg;base64,' + data.seg_overlay_b64;

        alternarAba('grafico');

        // Preenche Tabela
        const corpo = document.getElementById('tabelaCorpo');
        corpo.innerHTML = '';
        data.perfil.forEach(row => {
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
            csvContent += `${full.z_mm[i]};${c};${m};${full.gas_pct[i]}\n`;
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'perfil_roi_concentracao.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
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

    let calArquivo = null;

    const seletorCal = criarSeletorROI(document.getElementById('calCanvas'), {
        onMudarROI(roi, finalizado) {
            calRoiCoords.innerText = `ROI: X=${roi.x}, Y=${roi.y}`;
            calRoiDims.innerText = `Tamanho: ${roi.w} x ${roi.h} px`;
            atualizarEstadoBtnAdicionar();
        }
    });

    function atualizarEstadoBtnAdicionar() {
        const fracaoOk = calFracaoReal.value !== '' && !isNaN(parseFloat(calFracaoReal.value));
        btnCalAdicionar.disabled = !(calArquivo && seletorCal.roiValida() && fracaoOk);
    }

    calFracaoReal.addEventListener('input', atualizarEstadoBtnAdicionar);

    calInputArquivo.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        calArquivo = file;
        const reader = new FileReader();
        reader.onload = (event) => {
            seletorCal.carregarImagem(event.target.result, () => {
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

    btnCalAdicionar.addEventListener('click', () => {
        const roi = seletorCal.getROI();
        if (!seletorCal.roiValida() || !calArquivo) return;
        btnCalAdicionar.disabled = true;

        const formData = new FormData();
        formData.append('x', roi.x);
        formData.append('y', roi.y);
        formData.append('width', roi.w);
        formData.append('height', roi.h);
        formData.append('modo', calModo.value);
        formData.append('fracao_massica_real', calFracaoReal.value);
        formData.append('arquivo', calArquivo);

        fetch('/api/calibracao/pontos', { method: 'POST', body: formData })
            .then(r => {
                if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Erro ao adicionar ponto.'); });
                return r.json();
            })
            .then(data => {
                renderizarPontosCalibracao(data.pontos, data.coef);
                calFracaoReal.value = '';
            })
            .catch(err => alert('Falha ao adicionar ponto de calibração: ' + err.message))
            .finally(() => atualizarEstadoBtnAdicionar());
    });

    function carregarPontosCalibracao() {
        fetch(`/api/calibracao/pontos?modo=${calModo.value}`)
            .then(r => r.json())
            .then(data => renderizarPontosCalibracao(data.pontos, data.coef))
            .catch(err => console.error('Erro ao carregar pontos de calibração:', err));
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
        btnCalAjustar.disabled = pontos.length < 3;
        exibirCoefCalibracao(coef);
    }

    function removerPontoCalibracao(indice) {
        fetch(`/api/calibracao/pontos?modo=${calModo.value}&indice=${indice}`, { method: 'DELETE' })
            .then(r => r.json())
            .then(data => renderizarPontosCalibracao(data.pontos, data.coef))
            .catch(err => alert('Falha ao remover ponto: ' + err.message));
    }

    btnCalAjustar.addEventListener('click', () => {
        btnCalAjustar.disabled = true;
        const formData = new FormData();
        formData.append('modo', calModo.value);
        fetch('/api/calibracao/ajustar', { method: 'POST', body: formData })
            .then(r => {
                if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Erro ao ajustar a curva.'); });
                return r.json();
            })
            .then(data => {
                exibirCoefCalibracao(data.coef);
                document.getElementById('calGrafico').src = 'data:image/png;base64,' + data.grafico_b64;
                document.getElementById('calResultado').style.display = 'block';
            })
            .catch(err => alert('Falha ao calcular a calibração: ' + err.message))
            .finally(() => { btnCalAjustar.disabled = false; });
    });

    function exibirCoefCalibracao(coef) {
        if (!coef) {
            document.getElementById('calResultado').style.display = 'none';
            return;
        }
        document.getElementById('calFormula').innerText = `y = ${coef.a} + ${coef.b}·x`;
        document.getElementById('calR2').innerText = coef.r2 !== null ? coef.r2 : '-';
        document.getElementById('calLD').innerText = coef.ld !== null ? coef.ld + ' %' : '-';
        document.getElementById('calLQ').innerText = coef.lq !== null ? coef.lq + ' %' : '-';
        document.getElementById('calResultado').style.display = 'block';
    }

    calModoLabel.innerText = calModo.value === 'uv' ? 'Fluorescência UV' : 'Luminosidade';
});
