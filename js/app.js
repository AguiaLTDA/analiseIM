/**
 * ANÁLISE DE MISTURA EM LEITO FLUIDIZADO - CEUNES / UFES
 * Script Frontend: Manipulação do Canvas de ROI, Chamadas à API e Download de CSV
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('mainCanvas');
    const ctx = canvas.getContext('2d');
    const btnCarregarExemplo = document.getElementById('btnCarregarExemplo');
    const inputArquivo = document.getElementById('inputArquivo');
    const btnAnalisar = document.getElementById('btnAnalisar');
    const roiCoordsLabel = document.getElementById('roiCoords');
    const roiDimsLabel = document.getElementById('roiDims');
    const btnDownloadCSV = document.getElementById('btnDownloadCSV');

    let imgObj = new Image();
    let currentFile = null;
    let isUsingSample = true;

    // Estado do Retângulo de ROI
    let isDrawing = false;
    let startX = 0, startY = 0;
    let roi = { x: 0, y: 0, w: 0, h: 0 };
    let escalaDisplay = 1.0;
    let resultadoGlobal = null;

    // Carrega imagem padrão ao iniciar
    carregarImagemPadrao();

    function carregarImagemPadrao() {
        fetch('/api/imagem_exemplo')
            .then(r => r.json())
            .then(data => {
                imgObj.onload = () => {
                    configurarCanvas();
                    // Define ROI inicial padrão bem ajustada ao leito
                    const w = imgObj.naturalWidth;
                    const h = imgObj.naturalHeight;
                    roi = {
                        x: Math.round(w * 0.38),
                        y: Math.round(h * 0.32),
                        w: Math.round(w * 0.30),
                        h: Math.round(h * 0.40)
                    };
                    atualizarDesenho();
                    atualizarLabelsROI();
                    btnAnalisar.disabled = false;
                };
                imgObj.src = 'data:image/jpeg;base64,' + data.imagem_base64;
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
            imgObj.onload = () => {
                configurarCanvas();
                roi = { x: 0, y: 0, w: 0, h: 0 };
                atualizarDesenho();
                btnAnalisar.disabled = true;
                roiCoordsLabel.innerText = 'ROI: Arraste o mouse na imagem para selecionar';
                roiDimsLabel.innerText = 'Tamanho: 0 x 0 px';
            };
            imgObj.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    function configurarCanvas() {
        const containerWidth = 540;
        escalaDisplay = containerWidth / imgObj.naturalWidth;
        canvas.width = imgObj.naturalWidth;
        canvas.height = imgObj.naturalHeight;
        canvas.style.width = (imgObj.naturalWidth * escalaDisplay) + 'px';
        canvas.style.height = (imgObj.naturalHeight * escalaDisplay) + 'px';
    }

    function atualizarDesenho() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgObj, 0, 0);

        if (roi.w > 0 && roi.h > 0) {
            // Sombra semi-transparente fora da ROI
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(0, 0, canvas.width, roi.y);
            ctx.fillRect(0, roi.y + roi.h, canvas.width, canvas.height - (roi.y + roi.h));
            ctx.fillRect(0, roi.y, roi.x, roi.h);
            ctx.fillRect(roi.x + roi.w, roi.y, canvas.width - (roi.x + roi.w), roi.h);

            // Borda da ROI em vermelho
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3;
            ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);

            // Marcação de texto visual
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText('ROI ATIVA', roi.x + 8, roi.y + 22);
        }
    }

    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const x = (clientX - rect.left) / escalaDisplay;
        const y = (clientY - rect.top) / escalaDisplay;
        return { x: Math.round(x), y: Math.round(y) };
    }

    canvas.addEventListener('mousedown', (e) => {
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
        atualizarLabelsROI();
    });

    window.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            if (roi.w > 20 && roi.h > 20) {
                btnAnalisar.disabled = false;
            }
        }
    });

    function atualizarLabelsROI() {
        roiCoordsLabel.innerText = `ROI: X=${roi.x}, Y=${roi.y}`;
        roiDimsLabel.innerText = `Tamanho: ${roi.w} x ${roi.h} px`;
    }

    // Envio para o Backend FastAPI e Processamento
    btnAnalisar.addEventListener('click', () => {
        if (roi.w < 20 || roi.h < 20) return;

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
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><b>${row.z_mm.toFixed(1)}</b></td>
                <td style="color: #8b0000; font-weight: 600;">${row.c_pct.toFixed(2)}%</td>
                <td style="color: #0d9488;">${row.gas_pct.toFixed(1)}%</td>
            `;
            corpo.appendChild(tr);
        });

        btnDownloadCSV.disabled = false;
    }

    // Alternador de Abas
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
        let csvContent = 'Cota_z_mm;Concentracao_Comp_pct;Fracao_Gas_pct\n';
        for (let i = 0; i < full.z_mm.length; i++) {
            const c = full.c_pct[i] !== null ? full.c_pct[i] : '';
            csvContent += `${full.z_mm[i]};${c};${full.gas_pct[i]}\n`;
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
});
