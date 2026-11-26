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
    larguraContainer = 540, tamanhoMinimo = 20, onMudarROI = () => {}, onMudarExclusoes = () => {},
    rotuloROI = 'ROI ATIVA',
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
            ctx.fillText(rotuloROI, roi.x + 8, roi.y + 22);
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

/**
 * Pintor de rótulos sobre uma foto (aba Base de Referências).
 * Classe 1 = PEBD, 2 = areia, 3 = gás/fundo, 0 = borracha; ferramentas 'pincel' ou 'retangulo'.
 * Os rótulos ficam num Uint8Array do tamanho da imagem original (0 = sem marca, fase + 1).
 */
function criarPintorRotulos(canvas, { larguraContainer = 540, alturaMaxima = 720, ampliacaoMaxima = 8, onMudar = () => {} } = {}) {
    const ctx = canvas.getContext('2d');
    const CORES = { 1: [239, 68, 68], 2: [250, 204, 21], 3: [59, 130, 246] };
    let imgObj = null, rotulos = null, overlay = null, overlayCtx = null;
    let escala = 1, classe = 1, ferramenta = 'pincel', raio = 8;
    let pintando = false, ultimo = null, inicioRet = null, retAtual = null, cursor = null;
    let contagem = [0, 0, 0, 0];

    function desenhar() {
        if (!imgObj) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgObj, 0, 0);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(overlay, 0, 0);
        ctx.globalAlpha = 1;
        const lw = Math.max(1, 1.5 / escala);
        if (retAtual) {
            ctx.save();
            ctx.setLineDash([6 / escala, 4 / escala]);
            ctx.lineWidth = 2 * lw;
            ctx.strokeStyle = classe ? `rgb(${CORES[classe]})` : '#ffffff';
            ctx.strokeRect(retAtual.x, retAtual.y, retAtual.w, retAtual.h);
            ctx.restore();
        }
        if (cursor && ferramenta === 'pincel') {
            ctx.save();
            ctx.lineWidth = lw;
            ctx.strokeStyle = '#000';
            ctx.beginPath(); ctx.arc(cursor.x, cursor.y, raio + lw, 0, 2 * Math.PI); ctx.stroke();
            ctx.strokeStyle = classe ? `rgb(${CORES[classe]})` : '#ffffff';
            ctx.beginPath(); ctx.arc(cursor.x, cursor.y, raio, 0, 2 * Math.PI); ctx.stroke();
            ctx.restore();
        }
    }

    /** Aplica a classe atual aos pixels da caixa que satisfazem `dentro(x, y)`. */
    function aplicar(x0, y0, x1, y1, dentro) {
        x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
        x1 = Math.min(canvas.width - 1, Math.ceil(x1)); y1 = Math.min(canvas.height - 1, Math.ceil(y1));
        if (x1 < x0 || y1 < y0) return;
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        const id = overlayCtx.getImageData(x0, y0, bw, bh);
        const d = id.data;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                if (!dentro(x, y)) continue;
                const i = y * canvas.width + x;
                if (rotulos[i] === classe) continue;
                contagem[rotulos[i]]--;
                contagem[classe]++;
                rotulos[i] = classe;
                const k = ((y - y0) * bw + (x - x0)) * 4;
                if (classe) { d[k] = CORES[classe][0]; d[k + 1] = CORES[classe][1]; d[k + 2] = CORES[classe][2]; d[k + 3] = 255; }
                else d[k + 3] = 0;
            }
        }
        overlayCtx.putImageData(id, x0, y0);
    }

    function disco(cx, cy) {
        const r2 = raio * raio;
        aplicar(cx - raio, cy - raio, cx + raio, cy + raio, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r2);
    }

    function coords(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(canvas.width - 1, Math.round((e.clientX - rect.left) / escala))),
            y: Math.max(0, Math.min(canvas.height - 1, Math.round((e.clientY - rect.top) / escala))),
        };
    }

    canvas.addEventListener('mousedown', (e) => {
        if (!imgObj) return;
        e.preventDefault();
        const p = coords(e);
        pintando = true;
        if (ferramenta === 'pincel') { disco(p.x, p.y); ultimo = p; }
        else { inicioRet = p; retAtual = { x: p.x, y: p.y, w: 0, h: 0 }; }
        desenhar();
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!imgObj) return;
        const p = coords(e);
        cursor = p;
        if (pintando && ferramenta === 'pincel') {
            // Interpola entre os eventos do mouse para o traço não ficar pontilhado
            const dist = Math.hypot(p.x - ultimo.x, p.y - ultimo.y);
            const passos = Math.max(1, Math.ceil(dist / Math.max(1, raio / 2)));
            for (let s = 1; s <= passos; s++) {
                disco(Math.round(ultimo.x + (p.x - ultimo.x) * s / passos), Math.round(ultimo.y + (p.y - ultimo.y) * s / passos));
            }
            ultimo = p;
        } else if (pintando) {
            retAtual = {
                x: Math.min(inicioRet.x, p.x), y: Math.min(inicioRet.y, p.y),
                w: Math.abs(p.x - inicioRet.x), h: Math.abs(p.y - inicioRet.y),
            };
        }
        desenhar();
    });

    canvas.addEventListener('mouseleave', () => { cursor = null; desenhar(); });

    window.addEventListener('mouseup', () => {
        if (!pintando) return;
        pintando = false;
        if (ferramenta === 'retangulo' && retAtual && retAtual.w > 0 && retAtual.h > 0) {
            const r = retAtual;
            aplicar(r.x, r.y, r.x + r.w, r.y + r.h, () => true);
        }
        retAtual = null;
        desenhar();
        onMudar(contagem.slice());
    });

    return {
        /**
         * `fonte`: endereço de imagem ou um canvas (o quadro recortado). Quadros pequenos são
         * ampliados para caber na largura do painel (até `ampliacaoMaxima`); altos, limitados em altura.
         */
        carregarImagem(fonte, aoCarregar) {
            const usar = (novo, w, h) => {
                imgObj = novo;
                canvas.width = w;
                canvas.height = h;
                escala = Math.min(larguraContainer / w, alturaMaxima / h, ampliacaoMaxima);
                canvas.style.width = (w * escala) + 'px';
                canvas.style.height = (h * escala) + 'px';
                // Ampliado, o pixel aparece como bloco (sem suavizar), para marcar com precisão
                canvas.style.imageRendering = escala > 1.5 ? 'pixelated' : 'auto';
                overlay = document.createElement('canvas');
                overlay.width = w;
                overlay.height = h;
                overlayCtx = overlay.getContext('2d');
                rotulos = new Uint8Array(w * h);
                contagem = [rotulos.length, 0, 0, 0];
                desenhar();
                onMudar(contagem.slice());
                if (aoCarregar) aoCarregar();
            };
            if (fonte instanceof HTMLCanvasElement) { usar(fonte, fonte.width, fonte.height); return; }
            const novo = new Image();
            novo.onload = () => usar(novo, novo.naturalWidth, novo.naturalHeight);
            novo.src = fonte;
        },
        definirClasse(c) { classe = c; },
        definirFerramenta(f) { ferramenta = f; },
        definirRaio(r) { raio = r; desenhar(); },
        limpar() {
            if (!imgObj) return;
            rotulos.fill(0);
            contagem = [rotulos.length, 0, 0, 0];
            overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
            desenhar();
            onMudar(contagem.slice());
        },
        /** Recorte da foto em volta das marcações (pixels RGBA + rótulos), ou null se não há marcas. */
        extrairRotulados() {
            if (!imgObj) return null;
            const w = canvas.width, h = canvas.height;
            let x0 = w, y0 = h, x1 = -1, y1 = -1;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (!rotulos[y * w + x]) continue;
                    if (x < x0) x0 = x; if (x > x1) x1 = x;
                    if (y < y0) y0 = y; if (y > y1) y1 = y;
                }
            }
            if (x1 < 0) return null;
            // Margem para o desfoque 3x3 usar os vizinhos reais nas bordas das marcações
            x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2);
            x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
            const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
            const aux = document.createElement('canvas');
            aux.width = bw; aux.height = bh;
            const auxCtx = aux.getContext('2d');
            auxCtx.drawImage(imgObj, x0, y0, bw, bh, 0, 0, bw, bh);
            const { data } = auxCtx.getImageData(0, 0, bw, bh);
            const rot = new Uint8Array(bw * bh);
            for (let y = 0; y < bh; y++) rot.set(rotulos.subarray((y + y0) * w + x0, (y + y0) * w + x0 + bw), y * bw);
            return { img: { data, width: bw, height: bh }, rotulos: rot };
        },
    };
}

/** Uint8Array <-> base64 (amostras de cor guardadas de forma compacta no JSON). */
function u8ParaB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
}

function b64ParaU8(b64) {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
}

/**
 * Base de referências salva no navegador: uma entrada por foto marcada, com as cores
 * (Lab 8 bits, sorteadas) dos pixels de cada classe.
 * { versao: 1, fotos: [{ id, nome, criado_em, marcados: [n0, n1, n2], amostras: { '0': b64, ... } }] }
 */
const BaseReferencias = (() => {
    const CHAVE = 'analiseIM.referencias.v1';
    let memoria = { versao: 1, fotos: [] };

    function carregar() {
        try {
            const bruto = localStorage.getItem(CHAVE);
            if (bruto) return validar(JSON.parse(bruto));
        } catch (e) { /* armazenamento indisponível ou corrompido */ }
        return memoria;
    }

    /**
     * Retorna false se não coube no armazenamento do navegador (fica só na memória).
     * `origem` = 'nuvem' quando a base veio do GitHub (não conta como alteração local).
     */
    function salvar(base, origem) {
        memoria = base;
        if (origem !== 'nuvem') EstadoNuvem.marcarAlterado('referencias');
        try { localStorage.setItem(CHAVE, JSON.stringify(base)); return true; } catch (e) { return false; }
    }

    function validar(json) {
        const base = json && json.base ? json.base : json;
        if (!base || !Array.isArray(base.fotos)) throw new Error('arquivo sem a lista de fotos da base.');
        base.fotos.forEach((f, i) => {
            if (!f.amostras || typeof f.amostras !== 'object') throw new Error(`foto ${i + 1} sem amostras.`);
            Object.keys(f.amostras).forEach(k => {
                if (!['0', '1', '2'].includes(k)) throw new Error(`classe desconhecida "${k}" na foto ${i + 1}.`);
                if (b64ParaU8(f.amostras[k]).length % 3) throw new Error(`amostras corrompidas na foto ${i + 1}.`);
            });
        });
        return { versao: 1, fotos: base.fotos };
    }

    /** Amostras decodificadas de cada foto: [{0: Uint8Array, 1: ..., 2: ...}, ...]. */
    function decodificar(base) {
        return base.fotos.map(f => {
            const out = {};
            Object.keys(f.amostras).forEach(k => { out[k] = b64ParaU8(f.amostras[k]); });
            return out;
        });
    }

    return { carregar, salvar, validar, decodificar };
})();

const NOMES_MODOS = {
    luminosidade: 'Luminosidade',
    uv: 'Fluorescência UV',
    referencia: 'Base de referências',
};

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

    /** `origem` = 'nuvem' quando a calibração veio do GitHub (não conta como alteração local). */
    function salvar(dados, origem) {
        memoria = dados;
        if (origem !== 'nuvem') EstadoNuvem.marcarAlterado('calibracao');
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
        [['analise', 'viewAnalise', 'navAnalise'], ['referencia', 'viewReferencia', 'navReferencia'],
         ['calibracao', 'viewCalibracao', 'navCalibracao']].forEach(([nome, idView, idNav]) => {
            document.getElementById(idView).style.display = view === nome ? 'grid' : 'none';
            document.getElementById(idNav).classList.toggle('active', view === nome);
        });
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
        document.getElementById('badgeModo').innerText = {
            uv: 'Fluorescência UV (compósito verde)',
            referencia: 'Supervisionado (base de referências)',
        }[modoLeitura.value] || 'IA Não Supervisionada (CIELAB)';
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

    // Densidades dos sólidos (modelo área -> massa); lembradas neste navegador
    const CHAVE_DENSIDADES = 'analiseIM.densidades.v1';
    const inputRhoComp = document.getElementById('rhoComp');
    const inputRhoAreia = document.getElementById('rhoAreia');
    try {
        const salvo = JSON.parse(localStorage.getItem(CHAVE_DENSIDADES) || 'null');
        if (salvo && salvo.rhoComp > 0) inputRhoComp.value = salvo.rhoComp;
        if (salvo && salvo.rhoAreia > 0) inputRhoAreia.value = salvo.rhoAreia;
    } catch (e) { /* usa os valores padrão do HTML */ }
    [inputRhoComp, inputRhoAreia].forEach(inp => inp.addEventListener('change', () => {
        try {
            localStorage.setItem(CHAVE_DENSIDADES, JSON.stringify({
                rhoComp: parseFloat(inputRhoComp.value), rhoAreia: parseFloat(inputRhoAreia.value),
            }));
        } catch (e) { /* fica só nesta sessão */ }
    }));

    // Formato e dimensões das partículas (filtro de tamanho e Índice de Lacey); lembrados neste navegador
    const CHAVE_PARTICULAS = 'analiseIM.particulas.v1';
    const linhasParticula = {};
    document.querySelectorAll('.filtro-tamanho .particula').forEach(linha => {
        linhasParticula[linha.dataset.material] = linha;
    });
    const chkFiltroTamanho = document.getElementById('usarFiltroTamanho');

    /** { formato, d, x, y, z } lidos da linha do material. */
    function lerParticula(material) {
        const linha = linhasParticula[material];
        const p = { formato: linha.querySelector('select.formato').value };
        linha.querySelectorAll('input.dim').forEach(inp => { p[inp.dataset.dim] = parseFloat(inp.value); });
        return p;
    }

    try {
        const salvo = JSON.parse(localStorage.getItem(CHAVE_PARTICULAS) || 'null');
        if (salvo) {
            Object.keys(linhasParticula).forEach(material => {
                const p = salvo[material];
                if (!p) return;
                const linha = linhasParticula[material];
                if (Analise.FORMATOS.includes(p.formato)) linha.querySelector('select.formato').value = p.formato;
                linha.querySelectorAll('input.dim').forEach(inp => {
                    if (p[inp.dataset.dim] > 0) inp.value = p[inp.dataset.dim];
                });
            });
            if (typeof salvo.ativo === 'boolean') chkFiltroTamanho.checked = salvo.ativo;
        }
    } catch (e) { /* usa os valores padrão do HTML */ }

    /** { pebd, areia, ativo, dMinMm }; dMinMm = 0 com o filtro desligado ou partículas inválidas. */
    function opcoesTamanho() {
        const pebd = lerParticula('pebd'), areia = lerParticula('areia');
        const ativo = chkFiltroTamanho.checked;
        const dPebd = Analise.diametroEquivalente(pebd), dAreia = Analise.diametroEquivalente(areia);
        const ok = dPebd > dAreia && dAreia > 0;
        const dMinMm = ativo && ok ? Math.round(Analise.limiteTamanho(pebd, areia) * 1000) / 1000 : 0;
        return { pebd, areia, ativo, ok, dPebd, dAreia, dMinMm };
    }

    function atualizarParticulas() {
        Object.values(linhasParticula).forEach(linha => {
            linha.classList.toggle('xyz', linha.querySelector('select.formato').value !== 'esferica');
        });
        const t = opcoesTamanho();
        const num = v => v.toFixed(2).replace('.', ',');
        const info = document.getElementById('limiteTamanhoInfo');
        const eq = t.dPebd > 0 && t.dAreia > 0 ? ` (Ø equivalente: PEBD ${num(t.dPebd)} · areia ${num(t.dAreia)} mm)` : '';
        if (!t.ativo) info.innerText = 'filtro desligado' + eq;
        else if (!t.ok) info.innerText = '⚠ o PEBD precisa ser maior que a areia (filtro inativo)' + eq;
        else info.innerText = `manchas de PEBD menores que Ø ${num(t.dMinMm)} mm viram areia` + eq;
        try {
            localStorage.setItem(CHAVE_PARTICULAS, JSON.stringify({ pebd: t.pebd, areia: t.areia, ativo: t.ativo }));
        } catch (e) { /* fica só nesta sessão */ }
    }
    document.querySelectorAll('.filtro-tamanho select, .filtro-tamanho input').forEach(el => {
        el.addEventListener(el.type === 'number' ? 'input' : 'change', atualizarParticulas);
    });
    atualizarParticulas();

    /** Os padrões do modo foram medidos com outro filtro de tamanho? (pontos antigos = sem filtro) */
    function calibracaoComOutroFiltro(modo, dMinMm) {
        return Calibracao.carregar()[modo].pontos.some(p => Math.abs((p.filtro_mm || 0) - dMinMm) > 1e-3);
    }

    /**
     * Densidades atuais + fator k ajustado nos padrões do modo (k = 1 sem padrões).
     * Retorna null se as densidades forem inválidas.
     */
    function modeloDensidades(modo) {
        const rhoComp = parseFloat(inputRhoComp.value), rhoAreia = parseFloat(inputRhoAreia.value);
        if (!(rhoComp > 0 && rhoAreia > 0)) return null;
        const pontos = Calibracao.carregar()[modo].pontos;
        const ajuste = pontos.length ? Analise.ajustarFatorK(pontos, rhoComp, rhoAreia) : null;
        return { rhoComp, rhoAreia, k: ajuste ? ajuste.k : 1, ajuste };
    }

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
        const opcoesLacey = {
            amostragem: document.getElementById('laceyAmostragem').value,
            tamanhoMm: parseFloat(document.getElementById('laceyTamanho').value),
        };
        const tamanhos = opcoesTamanho();
        if (tamanhos.dAreia > 0) opcoesLacey.dParticulaMm = tamanhos.dAreia;

        executarDepoisDePintar(() => {
            const pixels = seletor.extrairPixelsROI();
            const coef = Calibracao.carregar()[modo].coef;
            const densidades = modeloDensidades(modo);
            const resultado = Analise.analisarROI(pixels, larguraMm, modo, coef, opcoesLacey, densidades,
                                                  { dMinMm: tamanhos.dMinMm, pebd: tamanhos.pebd, areia: tamanhos.areia });
            resultado.ajusteK = densidades ? densidades.ajuste : null;
            resultado.calibOutroFiltro = calibracaoComOutroFiltro(modo, tamanhos.dMinMm);
            resultado.plot = Analise.gerarGrafico(resultado.perfil, resultado.stats);
            resultado.overlay = Analise.gerarOverlay(pixels, resultado.seg, resultado.amostrasLacey);
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
        document.getElementById('valMediaInfo').innerText = `média das cotas: ${data.stats.media_perfil} %`;
        document.getElementById('valDesvio').innerText = data.stats.desvio_comp + ' %';
        document.getElementById('valLacey').innerText = data.stats.lacey_index !== null ? data.stats.lacey_index : 'n/d';
        document.getElementById('valLaceyInfo').innerText = Analise.descreverAmostragem(data.stats);
        document.getElementById('valAltura').innerText = data.stats.altura_total_mm + ' mm';
        document.getElementById('valMassica').innerText = data.stats.calibrado
            ? data.stats.media_comp_massica + ' %'
            : 'não calibrado';
        const avisoFiltro = data.calibOutroFiltro ? '⚠ padrões medidos com outro filtro de tamanho: refaça-os' : '';
        document.getElementById('valMassicaInfo').innerText = [
            data.stats.abaixo_ld ? '⚠ abaixo do limite de detecção da curva' : '',
            data.stats.calibrado ? avisoFiltro : '',
        ].filter(Boolean).join(' · ');
        const temDensidade = data.stats.media_comp_densidade !== undefined;
        document.getElementById('valDensidade').innerText = temDensidade
            ? data.stats.media_comp_densidade + ' %' : 'densidades inválidas';
        document.getElementById('valDensidadeInfo').innerText = !temDensidade ? ''
            : data.ajusteK
                ? `k = ${data.stats.fator_k} (ajustado em ${data.ajusteK.n} padr${data.ajusteK.n > 1 ? 'ões' : 'ão'})` +
                  (avisoFiltro ? ' · ' + avisoFiltro : '')
                : 'k = 1 (sem padrões: só densidades)';
        const st = data.stats;
        const temTamanho = st.media_comp_tamanho !== undefined;
        document.getElementById('valTamanho').innerText = temTamanho
            ? st.media_comp_tamanho + ' %' : 'partículas inválidas';
        document.getElementById('valTamanhoInfo').innerText = temTamanho
            ? `espessura média do grão: PEBD ${st.espessura_pebd_mm} · areia ${st.espessura_areia_mm} mm ` +
              '(sem densidade, sem calibração)'
            : '';
        document.getElementById('valFiltro').innerText = st.filtro_d_min_mm > 0
            ? `${st.manchas_pebd} manchas de PEBD` : 'desligado';
        document.getElementById('valFiltroInfo').innerText = st.filtro_d_min_mm > 0
            ? `${st.manchas_removidas} manchas < Ø ${st.filtro_d_min_mm} mm → areia ` +
              `(${st.filtrado_pct} % da ROI, laranja na máscara) · escala ${st.px_por_mm} px/mm`
            : '';
        document.getElementById('valExcluido').innerText = data.stats.excluido_pct + ' %';
        document.getElementById('valIncerto').innerText = data.stats.incerto_pct > 0
            ? `+ ${data.stats.incerto_pct} % incerto (fora da base, em roxo na máscara)` : '';

        // Atualiza Imagens
        document.getElementById('imgGrafico').src = data.plot;
        document.getElementById('imgSegmentada').src = data.overlay;

        alternarAba('grafico');

        // Preenche Tabela
        const corpo = document.getElementById('tabelaCorpo');
        corpo.innerHTML = '';
        if (!data.tabela.length) {
            corpo.innerHTML = '<tr><td colspan="5" style="color: var(--text-muted);">Nenhuma cota com leito identificada na ROI.</td></tr>';
        }
        const formatar = v => (v !== null && v !== undefined ? v.toFixed(2) + '%' : '-');
        data.tabela.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><b>${row.z_mm.toFixed(1)}</b></td>
                <td style="color: #8b0000; font-weight: 600;">${row.c_pct.toFixed(2)}%</td>
                <td style="color: #1e3a8a; font-weight: 600;">${formatar(row.c_pct_massico)}</td>
                <td style="color: #0d9488; font-weight: 600;">${formatar(row.c_pct_densidade)}</td>
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
        let csvContent = 'Cota_z_mm;Concentracao_Comp_pct;Concentracao_Massica_Calibrada_pct;Concentracao_Massica_Densidades_pct;Fracao_Gas_pct\n';
        const campo = v => (v !== null ? v : '');
        for (let i = 0; i < full.z_mm.length; i++) {
            csvContent += `${full.z_mm[i]};${campo(full.c_pct[i])};${campo(full.c_pct_massico[i])};` +
                          `${campo(full.c_pct_densidade[i])};${campo(full.gas_pct[i])}\n`;
        }
        baixarArquivo(csvContent, 'perfil_roi_concentracao.csv', 'text/csv;charset=utf-8;');
    });

    // -----------------------------------------------------------------
    // Aba 2: Calibração (curva fração medida na ROI -> fração mássica real)
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
        calModoLabel.innerText = NOMES_MODOS[calModo.value];
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

        // Mesmo filtro de tamanho da aba Análise; o ponto guarda qual foi usado
        const dMinMm = opcoesTamanho().dMinMm;
        const larguraMm = parseFloat(document.getElementById('calLarguraMm').value);
        executarDepoisDePintar(() => Analise.medirFracaoHomogenea(seletorCal.extrairPixelsROI(), modo, { dMinMm, larguraMm }))
            .then(cMedido => {
                const pontos = Calibracao.carregar()[modo].pontos.concat({
                    x: Math.round(cMedido * 1000) / 1000,
                    y: Math.round(fracaoReal * 1000) / 1000,
                    filtro_mm: dMinMm,
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
            calTabelaPontos.innerHTML = '<tr><td colspan="5" style="color: var(--text-muted);">Nenhum ponto cadastrado.</td></tr>';
        } else {
            pontos.forEach((p, i) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${i + 1}</td>
                    <td>${p.x.toFixed(2)}</td>
                    <td>${p.y.toFixed(2)}</td>
                    <td>${p.filtro_mm ? p.filtro_mm.toFixed(2) + " mm" : "sem filtro"}</td>
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

        const dens = modeloDensidades(calModo.value);
        const ajuste = dens && dens.ajuste;
        document.getElementById('calK').innerText = ajuste ? ajuste.k : '-';
        document.getElementById('calKInfo').innerText = dens
            ? `ρ compósito ${dens.rhoComp} · ρ areia ${dens.rhoAreia} g/cm³` : 'densidades inválidas na aba Análise';
        document.getElementById('calKR2').innerText = ajuste && ajuste.r2 !== null ? ajuste.r2 : '-';
        document.getElementById('calKRmse').innerText = ajuste ? `erro médio (RMSE): ${ajuste.rmse} % mássico` : '';
        document.getElementById('calGrafico').src = Analise.gerarGraficoCalibracao(pontos, coef, calModo.value, ajuste ? dens : null);
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

    calModoLabel.innerText = NOMES_MODOS[calModo.value];

    // -----------------------------------------------------------------
    // Aba 3: Base de Referências (exemplos marcados -> classificador)
    // -----------------------------------------------------------------
    const refContagem = document.getElementById('refContagem');
    const btnRefAdicionar = document.getElementById('btnRefAdicionar');
    const btnRefLimparMarcas = document.getElementById('btnRefLimparMarcas');
    const refRaio = document.getElementById('refRaio');
    let refNomeFoto = '';
    let refQuadro = null;          // {x, y, w, h} do quadro em uso, em pixels da foto original
    let refTamanhoFoto = null;
    const NOMES_CLASSES = ['PEBD', 'Areia', 'Gás / fundo'];

    const pintor = criarPintorRotulos(document.getElementById('refCanvas'), {
        onMudar(contagem) {
            const marcados = contagem[1] + contagem[2] + contagem[3];
            refContagem.innerText = `Marcados: PEBD ${contagem[1].toLocaleString('pt-BR')} px · ` +
                `Areia ${contagem[2].toLocaleString('pt-BR')} px · Gás/fundo ${contagem[3].toLocaleString('pt-BR')} px`;
            btnRefAdicionar.disabled = marcados === 0;
            btnRefLimparMarcas.disabled = marcados === 0;
        },
    });

    document.querySelectorAll('.classe-ref').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.classe-ref').forEach(b => b.classList.toggle('ativo', b === btn));
        pintor.definirClasse(parseInt(btn.dataset.classe, 10));
    }));
    document.querySelectorAll('.ferr-ref').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.ferr-ref').forEach(b => b.classList.toggle('ativo', b === btn));
        pintor.definirFerramenta(btn.dataset.ferramenta);
    }));
    refRaio.addEventListener('input', () => {
        document.getElementById('refRaioValor').innerText = refRaio.value;
        pintor.definirRaio(parseInt(refRaio.value, 10));
    });

    // Etapa 1: selecionar o quadro de referência (arrastar, como a ROI). Etapa 2: pintar nele.
    const refQuadroCanvas = document.getElementById('refQuadroCanvas');
    const refCanvas = document.getElementById('refCanvas');
    const btnRefUsarQuadro = document.getElementById('btnRefUsarQuadro');

    const seletorQuadro = criarSeletorROI(refQuadroCanvas, {
        rotuloROI: 'QUADRO DE REFERÊNCIA',
        onMudarROI(roi, finalizado) {
            refContagem.innerText = `Quadro: X=${roi.x}, Y=${roi.y} · ${roi.w} x ${roi.h} px`;
            if (finalizado) btnRefUsarQuadro.disabled = !seletorQuadro.roiValida();
        },
    });

    function mostrarEtapaRef(etapa) {
        refQuadroCanvas.style.display = etapa === 'quadro' ? 'block' : 'none';
        refCanvas.style.display = etapa === 'pintura' ? 'block' : 'none';
        document.getElementById('refFerrQuadro').style.display = etapa === 'quadro' ? 'flex' : 'none';
        document.getElementById('refFerrPintura').style.display = etapa === 'pintura' ? 'flex' : 'none';
    }

    function temMarcacoes() {
        return refCanvas.style.display !== 'none' && !btnRefLimparMarcas.disabled;
    }

    function abrirSelecaoQuadro() {
        mostrarEtapaRef('quadro');
        const roi = seletorQuadro.getROI();
        btnRefUsarQuadro.disabled = !seletorQuadro.roiValida();
        refContagem.innerText = seletorQuadro.roiValida()
            ? `Quadro: X=${roi.x}, Y=${roi.y} · ${roi.w} x ${roi.h} px`
            : 'Arraste o mouse na foto para selecionar o quadro de referência.';
    }

    function usarQuadro(roi) {
        seletorQuadro.definirROI(roi);
        const px = seletorQuadro.extrairPixelsROI();
        const recorte = document.createElement('canvas');
        recorte.width = px.width;
        recorte.height = px.height;
        recorte.getContext('2d').putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
        refQuadro = { x: Math.max(0, roi.x), y: Math.max(0, roi.y), w: px.width, h: px.height };
        pintor.carregarImagem(recorte, () => mostrarEtapaRef('pintura'));
    }

    document.getElementById('refInputArquivo').addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (temMarcacoes() && !confirm('Descartar as marcações ainda não adicionadas à base?')) return;
        refNomeFoto = file.name;
        const reader = new FileReader();
        reader.onload = (event) => seletorQuadro.carregarImagem(event.target.result, (w, h) => {
            refTamanhoFoto = { w, h };
            refQuadro = null;
            abrirSelecaoQuadro();
        });
        reader.readAsDataURL(file);
    });

    btnRefUsarQuadro.addEventListener('click', () => {
        if (seletorQuadro.roiValida()) usarQuadro(seletorQuadro.getROI());
    });

    document.getElementById('btnRefFotoInteira').addEventListener('click', () => {
        if (refTamanhoFoto) usarQuadro({ x: 0, y: 0, w: refTamanhoFoto.w, h: refTamanhoFoto.h });
    });

    document.getElementById('btnRefTrocarQuadro').addEventListener('click', () => {
        if (temMarcacoes() && !confirm('Trocar de quadro descarta as marcações ainda não adicionadas à base. Continuar?')) return;
        pintor.limpar();
        abrirSelecaoQuadro();
    });

    btnRefLimparMarcas.addEventListener('click', () => pintor.limpar());

    btnRefAdicionar.addEventListener('click', () => {
        btnRefAdicionar.disabled = true;
        executarDepoisDePintar(() => {
            const recorte = pintor.extrairRotulados();
            if (!recorte) throw new Error('nenhum pixel marcado.');
            return Analise.amostrarCoresRotuladas(recorte.img, recorte.rotulos);
        })
        .then(({ amostras, marcados }) => {
            const base = BaseReferencias.carregar();
            const codificadas = {};
            Object.keys(amostras).forEach(k => { codificadas[k] = u8ParaB64(amostras[k]); });
            const q = refQuadro;
            const inteira = q && refTamanhoFoto && q.w === refTamanhoFoto.w && q.h === refTamanhoFoto.h;
            base.fotos.push({
                id: Date.now().toString(36),
                nome: (refNomeFoto || `foto ${base.fotos.length + 1}`) +
                      (q && !inteira ? ` [quadro ${q.x},${q.y} ${q.w}x${q.h}]` : ''),
                quadro: q,
                criado_em: new Date().toISOString().slice(0, 19) + '+00:00',
                marcados,
                amostras: codificadas,
            });
            salvarBase(base);
            pintor.limpar();
        })
        .catch(err => {
            alert('Falha ao adicionar à base: ' + mensagemErro(err));
            btnRefAdicionar.disabled = false;
        });
    });

    function salvarBase(base) {
        if (!BaseReferencias.salvar(base)) {
            alert('A base não coube no armazenamento do navegador e ficará só nesta aba. ' +
                  'Use "Exportar Base" para não perder as marcações.');
        }
        atualizarModeloReferencia();
    }

    /** Retreina o classificador com a base atual e redesenha o painel. */
    function atualizarModeloReferencia() {
        const base = BaseReferencias.carregar();
        const lista = BaseReferencias.decodificar(base);
        let modelo = null, avaliacao = null, motivo = '';
        if (lista.length) {
            try {
                modelo = Analise.treinarModeloReferencia(Analise.concatenarAmostras(lista));
                avaliacao = Analise.avaliarModeloReferencia(lista);
            } catch (err) {
                modelo = null;
                motivo = mensagemErro(err);
            }
        }
        Analise.definirModeloReferencia(modelo);
        renderizarBase(base, modelo, avaliacao, motivo);
    }

    function renderizarBase(base, modelo, avaliacao, motivo) {
        const status = document.getElementById('refStatus');
        status.className = 'ref-status' + (modelo ? ' ok' : base.fotos.length ? ' aviso' : '');
        if (modelo) {
            const semGas = !modelo.classes.some(c => c.fase === 2);
            status.innerText = `Classificador pronto (${base.fotos.length} foto(s)). ` +
                (avaliacao && avaliacao.acuracia !== null ? `Acerto na validação: ${avaliacao.acuracia.toLocaleString('pt-BR')} %. ` : '') +
                (semGas ? 'Sem exemplos de gás/fundo: pixels de bolha ou fundo tendem a ficar "incertos".' : '');
        } else {
            status.innerText = base.fotos.length ? `Classificador indisponível: ${motivo}` : 'Base vazia.';
        }

        const corpo = document.getElementById('refTabelaFotos');
        corpo.innerHTML = '';
        if (!base.fotos.length) {
            corpo.innerHTML = '<tr><td colspan="6" style="color: var(--text-muted);">Nenhuma foto adicionada.</td></tr>';
        }
        base.fotos.forEach((f, i) => {
            const tr = document.createElement('tr');
            const m = f.marcados || [0, 0, 0];
            const celNome = document.createElement('td');
            celNome.textContent = f.nome;
            celNome.style.cssText = 'max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            celNome.title = f.nome;
            tr.innerHTML = `<td>${i + 1}</td>`;
            tr.appendChild(celNome);
            tr.insertAdjacentHTML('beforeend', m.map(v => `<td>${v.toLocaleString('pt-BR')}</td>`).join('') +
                `<td><button class="btn btn-outline" style="padding:4px 10px;font-size:0.75rem;" title="Remover esta foto da base">✕</button></td>`);
            tr.querySelector('button').addEventListener('click', () => {
                if (!confirm(`Remover "${f.nome}" da base?`)) return;
                const atual = BaseReferencias.carregar();
                atual.fotos = atual.fotos.filter(x => x.id !== f.id);
                salvarBase(atual);
            });
            corpo.appendChild(tr);
        });

        document.getElementById('refModelo').style.display = modelo ? 'block' : 'none';
        if (!modelo) return;

        const classes = document.getElementById('refTabelaClasses');
        classes.innerHTML = '';
        modelo.classes.forEach(c => {
            const [L, a, b] = c.media;
            const rgb = Analise.lab8ParaRgb(L, a, b);
            classes.insertAdjacentHTML('beforeend', `<tr>
                <td>${NOMES_CLASSES[c.fase]}</td>
                <td><span class="amostra-cor" style="background: rgb(${rgb});"></span></td>
                <td>${(L * 100 / 255).toFixed(1)}</td><td>${(a - 128).toFixed(1)}</td><td>${(b - 128).toFixed(1)}</td>
                <td>${c.n.toLocaleString('pt-BR')}</td></tr>`);
        });

        document.getElementById('refMetodoValidacao').innerText = avaliacao.metodo === 'foto'
            ? `Cada foto foi classificada por um modelo treinado só com as outras (${avaliacao.fotosTestadas} foto(s) testada(s), ` +
              `${avaliacao.nTeste.toLocaleString('pt-BR')} pixels). Percentual por linha.`
            : 'Só há uma foto utilizável: 70% dos pixels treinam e 30% testam. Essa medida é otimista; ' +
              'adicione fotos diferentes para uma validação mais honesta. Percentual por linha.';
        const matriz = document.getElementById('refMatriz');
        matriz.innerHTML = '';
        avaliacao.matriz.forEach((linha, f) => {
            const total = linha.reduce((s, v) => s + v, 0);
            if (!total) return;
            matriz.insertAdjacentHTML('beforeend', `<tr><td><b>${NOMES_CLASSES[f]}</b></td>` +
                linha.map((v, j) => `<td class="${j === f ? 'diag' : ''}">${(100 * v / total).toFixed(1)}%</td>`).join('') +
                '</tr>');
        });
    }

    document.getElementById('btnRefExportar').addEventListener('click', () => {
        const arquivo = { app: 'analiseIM', tipo: 'base-referencias', versao: 1,
                          exportado_em: new Date().toISOString(), base: BaseReferencias.carregar() };
        baixarArquivo(JSON.stringify(arquivo), 'base_referencias_analiseIM.json', 'application/json');
    });

    document.getElementById('refInputImportar').addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const base = BaseReferencias.validar(JSON.parse(event.target.result));
                if (!confirm(`Substituir a base deste navegador pela do arquivo? (${base.fotos.length} foto(s))`)) return;
                salvarBase(base);
            } catch (err) {
                alert('Arquivo de base inválido: ' + mensagemErro(err));
            }
        };
        reader.readAsText(file);
    });

    document.getElementById('btnRefLimparBase').addEventListener('click', () => {
        if (!BaseReferencias.carregar().fotos.length) return;
        if (!confirm('Apagar toda a base de referências deste navegador? Exporte antes se quiser guardar uma cópia.')) return;
        salvarBase({ versao: 1, fotos: [] });
    });

    atualizarModeloReferencia();

    // -----------------------------------------------------------------
    // Dados online (GitHub): base de referências e calibração
    // -----------------------------------------------------------------
    const ITENS_NUVEM = {
        referencias: {
            nome: 'base de referências',
            caminho: 'dados/base_referencias.json',
            serializar: () => JSON.stringify({ app: 'analiseIM', tipo: 'base-referencias', versao: 1,
                                               exportado_em: new Date().toISOString(), base: BaseReferencias.carregar() }),
            aplicar: texto => {
                BaseReferencias.salvar(BaseReferencias.validar(JSON.parse(texto)), 'nuvem');
                atualizarModeloReferencia();
            },
            vazio: () => !BaseReferencias.carregar().fotos.length,
        },
        calibracao: {
            nome: 'calibração',
            caminho: 'dados/calibracao.json',
            serializar: () => JSON.stringify({ app: 'analiseIM', versao: 1, exportado_em: new Date().toISOString(),
                                               dados: Calibracao.carregar() }, null, 2),
            aplicar: texto => {
                Calibracao.salvar(Calibracao.validarImportacao(JSON.parse(texto)), 'nuvem');
                carregarPontosCalibracao();
            },
            vazio: () => Analise.MODOS.every(m => !Calibracao.carregar()[m].pontos.length),
        },
    };
    const nuvemStatus = document.getElementById('nuvemStatus');
    const btnNuvemSalvar = document.getElementById('btnNuvemSalvar');
    const btnNuvemToken = document.getElementById('btnNuvemToken');
    const shaOnline = {};       // sha da versão online vista nesta sessão (null = arquivo ainda não existe)
    let nuvemErro = '';
    let nuvemOcupada = true;

    function renderizarNuvem() {
        const chaves = Object.keys(ITENS_NUVEM);
        const pendentes = chaves.filter(k => (EstadoNuvem.obter(k) || {}).sujo);
        const conflitos = pendentes.filter(k => shaOnline[k] && shaOnline[k] !== EstadoNuvem.obter(k).sha);
        const nomes = ks => ks.map(k => ITENS_NUVEM[k].nome).join(' e ');
        let texto, classe;
        if (nuvemOcupada) {
            texto = '☁ Sincronizando com o GitHub…'; classe = '';
        } else if (nuvemErro) {
            texto = '⚠ Dados online indisponíveis: ' + nuvemErro; classe = 'aviso';
        } else if (conflitos.length) {
            texto = `⚠ A ${nomes(conflitos)} online mudou em outra máquina e esta tem alterações não salvas.`; classe = 'aviso';
        } else if (pendentes.length) {
            texto = `● Alterações não salvas online: ${nomes(pendentes)}.`; classe = 'aviso';
        } else if (chaves.every(k => !shaOnline[k])) {
            texto = '☁ Nada salvo online ainda.'; classe = '';
        } else {
            texto = '☁ Sincronizado com o GitHub.'; classe = 'ok';
        }
        nuvemStatus.innerText = texto;
        nuvemStatus.className = 'nuvem-status ' + classe;
        btnNuvemSalvar.disabled = nuvemOcupada || !pendentes.length;
        btnNuvemToken.title = Nuvem.token()
            ? 'Token do GitHub cadastrado neste navegador (clique para trocar ou remover)'
            : 'Cadastrar o token do GitHub que permite salvar online';
        btnNuvemToken.classList.toggle('ativo', !!Nuvem.token());
    }
    EstadoNuvem.aoMudar(renderizarNuvem);

    /** Ao abrir: traz do GitHub o que mudou online, sem apagar alterações locais não enviadas. */
    async function sincronizarAoAbrir() {
        nuvemOcupada = true;
        nuvemErro = '';
        renderizarNuvem();
        for (const [chave, item] of Object.entries(ITENS_NUVEM)) {
            try {
                const remoto = await Nuvem.ler(item.caminho);
                shaOnline[chave] = remoto ? remoto.sha : null;
                let est = EstadoNuvem.obter(chave);
                if (!est) {
                    // Primeira vez neste navegador: o que já existe localmente conta como não enviado
                    est = { sha: null, sujo: !item.vazio() };
                    EstadoNuvem.definir(chave, est);
                }
                if (!remoto || remoto.sha === est.sha) continue;
                if (!est.sujo || item.vazio()) {
                    item.aplicar(remoto.texto);
                    EstadoNuvem.definir(chave, { sha: remoto.sha, sujo: false });
                }
            } catch (err) {
                nuvemErro = mensagemErro(err);
            }
        }
        nuvemOcupada = false;
        renderizarNuvem();
    }

    function pedirToken() {
        const atual = Nuvem.token();
        const t = prompt(
            'Token do GitHub para salvar online (fica guardado só neste navegador).\n\n' +
            'Para criar: github.com/settings/personal-access-tokens/new → "Only select repositories" = ' +
            Nuvem.REPO + ' → Permissions → Contents = "Read and write".\n\n' +
            (atual ? 'Deixe em branco e clique OK para remover o token deste navegador.' : 'Cole o token:'),
            '');
        if (t === null) return false;
        Nuvem.definirToken(t.trim());
        renderizarNuvem();
        return !!t.trim();
    }

    btnNuvemToken.addEventListener('click', pedirToken);

    btnNuvemSalvar.addEventListener('click', async () => {
        if (!Nuvem.token() && !pedirToken()) return;
        nuvemOcupada = true;
        renderizarNuvem();
        for (const [chave, item] of Object.entries(ITENS_NUVEM)) {
            const est = EstadoNuvem.obter(chave) || {};
            if (!est.sujo) continue;
            const msg = `Atualiza ${item.nome} (salvo pelo app)`;
            try {
                let sha;
                try {
                    sha = await Nuvem.gravar(item.caminho, item.serializar(), est.sha, msg);
                } catch (err) {
                    if (err.status !== 409 && err.status !== 422) throw err;
                    // Outra máquina salvou depois da última sincronização desta
                    if (confirm(`A ${item.nome} online foi alterada em outra máquina depois que esta sincronizou.\n\n` +
                                `OK: substituir a versão online pela desta máquina.\nCancelar: decidir depois.`)) {
                        const remoto = await Nuvem.ler(item.caminho);
                        sha = await Nuvem.gravar(item.caminho, item.serializar(), remoto && remoto.sha, msg);
                    } else if (confirm(`Então descartar as alterações desta máquina e carregar a ${item.nome} online?`)) {
                        const remoto = await Nuvem.ler(item.caminho);
                        if (remoto) {
                            item.aplicar(remoto.texto);
                            shaOnline[chave] = remoto.sha;
                            EstadoNuvem.definir(chave, { sha: remoto.sha, sujo: false });
                        }
                        continue;
                    } else {
                        continue;
                    }
                }
                shaOnline[chave] = sha;
                EstadoNuvem.definir(chave, { sha, sujo: false });
            } catch (err) {
                alert(`Não foi possível salvar a ${item.nome} online: ${mensagemErro(err)}`);
                if (err.status === 401 || err.status === 403 || err.status === 404) break;
            }
        }
        nuvemErro = '';
        nuvemOcupada = false;
        renderizarNuvem();
    });

    sincronizarAoAbrir();
});
