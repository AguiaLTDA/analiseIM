/**
 * ANÁLISE DE MISTURA EM LEITO FLUIDIZADO - CEUNES / UFES
 * Núcleo de cálculo executado no navegador (porta do antigo backend Python):
 * segmentação por luminosidade (K-Means em CIELAB) ou por fluorescência UV,
 * perfil C(z), Índice de Lacey e curva de calibração.
 *
 * Funções de cálculo puras (sem DOM): também rodam no Node para testes.
 * Entrada de imagem: { data: RGBA (Uint8ClampedArray), width, height }.
 */
(function (global) {
    'use strict';

    // Parâmetros da análise (mesmos valores do app.py)
    const N_CLUSTERS = 3;                 // compósito, areia, gás
    const DELTA_L_MIN_GAS = 10.0;         // separação mínima de L* para aceitar um cluster de gás
    const JANELA_SUAVIZACAO_MM = 2.0;     // altura da janela móvel do perfil C(z)
    const FRACAO_SOLIDOS_MIN = 0.20;      // abaixo disso a cota é considerada sem leito (C = null)
    const ALTURA_AMOSTRA_LACEY_MM = 5.0;  // altura de cada amostra usada no Índice de Lacey
    const D_PARTICULA_MM = 1.0;           // diâmetro da areia (nº de partículas por amostra)
    const N_LINHAS_TABELA = 25;

    // Modo UV: compósito PEBD fluoresce em verde; areia fica azul; gás aparece escuro
    const A_MAX_COMPOSITO_UV = 8.0;       // a* abaixo disso = tom verde do compósito
    const L_MIN_COMPOSITO_UV = 15.0;      // L* mínimo (0-100) para aceitar o pixel como fluorescente
    const GAS_FRACAO_L_UV = 0.70;         // gás: L* abaixo desta fração da mediana de L* da coluna

    const MODOS = ['luminosidade', 'uv'];
    const MIN_PONTOS_AJUSTE = 3;

    // K-Means: o ajuste usa no máximo esta quantidade de pixels (sorteados); depois todos são classificados
    const KMEANS_MAX_AMOSTRAS = 200000;
    // Nº de inicializações do K-Means; fica a de menor soma de distâncias (mais estável que 1 só)
    let KMEANS_TENTATIVAS = 20;

    // Cores da máscara (RGB): compósito vermelho, areia bege, gás azul (mesmas do favicon)
    const CORES_FASES = [[200, 40, 40], [220, 190, 140], [60, 160, 230]];

    // -----------------------------------------------------------------------
    // Utilitários
    // -----------------------------------------------------------------------

    function arredondar(v, casas) {
        const f = Math.pow(10, casas);
        return Math.round(v * f) / f;
    }

    /** Gerador pseudoaleatório com semente (resultados reprodutíveis). */
    function mulberry32(semente) {
        let t = semente >>> 0;
        return function () {
            t = (t + 0x6D2B79F5) >>> 0;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }

    /** Equivale a np.convolve(x, ones(m), mode="same"). */
    function somaMovel(x, m) {
        const n = x.length;
        const fim = Math.floor((m - 1) / 2);       // amostras à frente
        const inicio = m - 1 - fim;                // amostras atrás
        const acum = new Float64Array(n + 1);
        for (let i = 0; i < n; i++) acum[i + 1] = acum[i] + x[i];
        const out = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - inicio);
            const b = Math.min(n - 1, i + fim);
            out[i] = acum[b + 1] - acum[a];
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // Pré-processamento: desfoque gaussiano e CIELAB (compatível com OpenCV 8 bits)
    // -----------------------------------------------------------------------

    // Núcleos fixos que o OpenCV usa com sigma = 0
    const NUCLEOS_GAUSS = { 3: [0.25, 0.5, 0.25], 5: [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16] };

    /** Desfoque gaussiano separável com borda BORDER_REFLECT_101; devolve RGB uint8. */
    function desfoqueGaussiano(img, tamanho) {
        const { data, width: w, height: h } = img;
        const k = NUCLEOS_GAUSS[tamanho];
        const r = (tamanho - 1) / 2;
        const refletir = (i, n) => {
            if (n === 1) return 0;
            while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i;
            return i;
        };
        const tmp = new Float32Array(w * h * 3);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                for (let c = 0; c < 3; c++) {
                    let s = 0;
                    for (let j = -r; j <= r; j++) s += k[j + r] * data[(y * w + refletir(x + j, w)) * 4 + c];
                    tmp[(y * w + x) * 3 + c] = s;
                }
            }
        }
        const out = new Uint8Array(w * h * 3);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                for (let c = 0; c < 3; c++) {
                    let s = 0;
                    for (let j = -r; j <= r; j++) s += k[j + r] * tmp[(refletir(y + j, h) * w + x) * 3 + c];
                    out[(y * w + x) * 3 + c] = Math.min(255, Math.max(0, Math.round(s)));
                }
            }
        }
        return out;
    }

    // Tabela sRGB -> linear para os 256 níveis
    const SRGB_LINEAR = new Float64Array(256);
    for (let i = 0; i < 256; i++) {
        const v = i / 255;
        SRGB_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }

    function fLab(t) {
        return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    }

    /**
     * RGB uint8 -> CIELAB quantizado como no OpenCV 8 bits:
     * L em 0-255 (L* x 2,55), a e b com deslocamento de +128.
     */
    function rgbParaLab8(rgb, n) {
        const lab = new Uint8Array(n * 3);
        for (let i = 0; i < n; i++) {
            const r = SRGB_LINEAR[rgb[i * 3]], g = SRGB_LINEAR[rgb[i * 3 + 1]], b = SRGB_LINEAR[rgb[i * 3 + 2]];
            const X = (0.412453 * r + 0.357580 * g + 0.180423 * b) / 0.950456;
            const Y = 0.212671 * r + 0.715160 * g + 0.072169 * b;
            const Z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / 1.088754;
            const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
            const L = Y > 0.008856 ? 116 * fy - 16 : 903.3 * Y;
            const clamp = v => Math.min(255, Math.max(0, Math.round(v)));
            lab[i * 3] = clamp(L * 255 / 100);
            lab[i * 3 + 1] = clamp(500 * (fx - fy) + 128);
            lab[i * 3 + 2] = clamp(200 * (fy - fz) + 128);
        }
        return lab;
    }

    // -----------------------------------------------------------------------
    // Segmentação: 0 = compósito, 1 = areia, 2 = gás, 3 = zona de exclusão
    // -----------------------------------------------------------------------

    const FASE_EXCLUIDA = 3;

    /**
     * img.excluido (opcional): Uint8Array do tamanho da ROI, 1 = pixel numa zona de exclusão.
     * Pixels excluídos não entram no ajuste do K-Means nem em nenhuma contagem.
     */
    function segmentar(img, modo) {
        const seg = modo === 'uv' ? segmentarFasesUV(img) : segmentarFases(img);
        if (img.excluido) {
            for (let i = 0; i < seg.fases.length; i++) if (img.excluido[i]) seg.fases[i] = FASE_EXCLUIDA;
        }
        return seg;
    }

    /** K-Means++ em CIELAB; retorna { centros, compacidade }. */
    function kmeans(pontos, n, k, rng, maxIter = 50, eps = 0.5) {
        const dist2 = (i, c, centros) => {
            const d0 = pontos[i * 3] - centros[c * 3];
            const d1 = pontos[i * 3 + 1] - centros[c * 3 + 1];
            const d2 = pontos[i * 3 + 2] - centros[c * 3 + 2];
            return d0 * d0 + d1 * d1 + d2 * d2;
        };

        // Inicialização k-means++
        const centros = new Float64Array(k * 3);
        const primeiro = Math.floor(rng() * n);
        for (let d = 0; d < 3; d++) centros[d] = pontos[primeiro * 3 + d];
        const menorDist = new Float64Array(n).fill(Infinity);
        for (let c = 1; c < k; c++) {
            let soma = 0;
            for (let i = 0; i < n; i++) {
                const d = dist2(i, c - 1, centros);
                if (d < menorDist[i]) menorDist[i] = d;
                soma += menorDist[i];
            }
            let alvo = rng() * soma, escolhido = n - 1;
            for (let i = 0; i < n; i++) {
                alvo -= menorDist[i];
                if (alvo <= 0) { escolhido = i; break; }
            }
            for (let d = 0; d < 3; d++) centros[c * 3 + d] = pontos[escolhido * 3 + d];
        }

        const rotulos = new Uint8Array(n);
        let compacidade = 0;
        for (let iter = 0; iter < maxIter; iter++) {
            compacidade = 0;
            const somas = new Float64Array(k * 3);
            const contagem = new Float64Array(k);
            for (let i = 0; i < n; i++) {
                let melhor = 0, melhorD = Infinity;
                for (let c = 0; c < k; c++) {
                    const d = dist2(i, c, centros);
                    if (d < melhorD) { melhorD = d; melhor = c; }
                }
                rotulos[i] = melhor;
                compacidade += melhorD;
                contagem[melhor]++;
                for (let d = 0; d < 3; d++) somas[melhor * 3 + d] += pontos[i * 3 + d];
            }
            let maiorDesloc = 0;
            for (let c = 0; c < k; c++) {
                if (contagem[c] === 0) continue;  // cluster vazio mantém o centro
                let desloc = 0;
                for (let d = 0; d < 3; d++) {
                    const novo = somas[c * 3 + d] / contagem[c];
                    desloc += (novo - centros[c * 3 + d]) ** 2;
                    centros[c * 3 + d] = novo;
                }
                maiorDesloc = Math.max(maiorDesloc, desloc);
            }
            if (maiorDesloc <= eps * eps) break;
        }
        return { centros, compacidade };
    }

    /**
     * Luz visível: K-Means (3 grupos) em CIELAB, rotulados pela luminosidade L*:
     * o mais escuro é o compósito, o intermediário a areia e o mais claro o gás.
     */
    function segmentarFases(img) {
        const n = img.width * img.height;
        const lab = rgbParaLab8(desfoqueGaussiano(img, 3), n);

        // Ajuste só com os pixels fora das zonas de exclusão (amostrados se forem muitos);
        // várias tentativas, fica a de menor compacidade
        const rng = mulberry32(42);
        let validos = null;
        if (img.excluido) {
            validos = [];
            for (let i = 0; i < n; i++) if (!img.excluido[i]) validos.push(i);
            if (validos.length < 100) throw new Error('Quase toda a ROI está em zonas de exclusão; não há pixels para analisar.');
        }
        const nValidos = validos ? validos.length : n;
        const indice = j => (validos ? validos[j] : j);

        let pontos = lab, nAjuste = n;
        if (validos || n > KMEANS_MAX_AMOSTRAS) {
            const amostrar = nValidos > KMEANS_MAX_AMOSTRAS;
            nAjuste = amostrar ? KMEANS_MAX_AMOSTRAS : nValidos;
            pontos = new Uint8Array(nAjuste * 3);
            for (let i = 0; i < nAjuste; i++) {
                const j = indice(amostrar ? Math.floor(rng() * nValidos) : i);
                pontos[i * 3] = lab[j * 3]; pontos[i * 3 + 1] = lab[j * 3 + 1]; pontos[i * 3 + 2] = lab[j * 3 + 2];
            }
        }
        let melhor = null;
        for (let t = 0; t < KMEANS_TENTATIVAS; t++) {
            const res = kmeans(pontos, nAjuste, N_CLUSTERS, rng);
            if (!melhor || res.compacidade < melhor.compacidade) melhor = res;
        }
        const centros = melhor.centros;

        const lCentros = [0, 1, 2].map(c => centros[c * 3] * 100 / 255);
        const ordem = [0, 1, 2].sort((p, q) => lCentros[p] - lCentros[q]);  // escuro -> claro
        const mapa = new Uint8Array(N_CLUSTERS);
        mapa[ordem[0]] = 0;
        mapa[ordem[1]] = 1;
        mapa[ordem[2]] = 2;
        // Se o cluster mais claro não se distingue da areia, a ROI não contém gás: funde com a areia
        if (lCentros[ordem[2]] - lCentros[ordem[1]] < DELTA_L_MIN_GAS) mapa[ordem[2]] = 1;

        const fases = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            let melhorC = 0, melhorD = Infinity;
            for (let c = 0; c < N_CLUSTERS; c++) {
                const d0 = lab[i * 3] - centros[c * 3];
                const d1 = lab[i * 3 + 1] - centros[c * 3 + 1];
                const d2 = lab[i * 3 + 2] - centros[c * 3 + 2];
                const d = d0 * d0 + d1 * d1 + d2 * d2;
                if (d < melhorD) { melhorD = d; melhorC = c; }
            }
            fases[i] = mapa[melhorC];
        }
        return { fases, width: img.width, height: img.height };
    }

    /**
     * Luz ultravioleta: compósito = verde fluorescente (a* baixo), gás = pixel bem mais
     * escuro que a mediana de L* da sua coluna (compensa iluminação UV não uniforme).
     */
    function segmentarFasesUV(img) {
        const { width: w, height: h } = img;
        const n = w * h;
        const lab = rgbParaLab8(desfoqueGaussiano(img, 5), n);
        const lStar = new Float32Array(n);
        const comp0 = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            lStar[i] = lab[i * 3] * 100 / 255;
            const aStar = lab[i * 3 + 1] - 128;
            comp0[i] = aStar < A_MAX_COMPOSITO_UV && lStar[i] >= L_MIN_COMPOSITO_UV ? 1 : 0;
        }

        // Abertura morfológica com elemento 2x2 (âncora em (1,1), como no OpenCV)
        const vizinhos = [[0, 0], [-1, 0], [0, -1], [-1, -1]];
        const erodido = new Uint8Array(n);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let v = 1;
                for (const [dy, dx] of vizinhos) {
                    const yy = y + dy, xx = x + dx;
                    if (yy >= 0 && xx >= 0 && !comp0[yy * w + xx]) { v = 0; break; }
                }
                erodido[y * w + x] = v;
            }
        }
        const comp = new Uint8Array(n);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let v = 0;
                for (const [dy, dx] of vizinhos) {
                    const yy = y + dy, xx = x + dx;
                    if (yy >= 0 && xx >= 0 && erodido[yy * w + xx]) { v = 1; break; }
                }
                comp[y * w + x] = v;
            }
        }

        // Mediana de L* por coluna (sem os pixels excluídos), suavizada por média móvel
        const mediana = new Float64Array(w);
        for (let x = 0; x < w; x++) {
            const ord = [];
            for (let y = 0; y < h; y++) if (!img.excluido || !img.excluido[y * w + x]) ord.push(lStar[y * w + x]);
            ord.sort((p, q) => p - q);
            const m = ord.length;
            mediana[x] = m === 0 ? NaN : m % 2 ? ord[(m - 1) / 2] : (ord[m / 2 - 1] + ord[m / 2]) / 2;
        }
        const k = Math.max(1, Math.floor(w / 20));
        const medianaSuave = new Float64Array(w);
        for (let x = 0; x < w; x++) {
            let s = 0, cont = 0;
            for (let j = -k; j <= k; j++) {
                const v = mediana[Math.min(w - 1, Math.max(0, x + j))];
                if (!Number.isNaN(v)) { s += v; cont++; }
            }
            medianaSuave[x] = cont ? s / cont : 0;  // coluna toda excluída: valor irrelevante
        }

        const fases = new Uint8Array(n).fill(1);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (comp[i]) fases[i] = 0;
                else if (lStar[i] < GAS_FRACAO_L_UV * Math.max(medianaSuave[x], 1e-3)) fases[i] = 2;
            }
        }
        return { fases, width: w, height: h };
    }

    // -----------------------------------------------------------------------
    // Perfil vertical, estatísticas e Índice de Lacey
    // -----------------------------------------------------------------------

    /**
     * Perfil por linha de pixels, suavizado; z = 0 na base da ROI, ordenado de baixo para cima.
     * Zonas de exclusão: C(z) e gás usam só os pixels válidos, mas a cota só é considerada
     * leito se os sólidos ocuparem ao menos FRACAO_SOLIDOS_MIN da largura inteira da ROI
     * (cotas quase todas excluídas ficam sem valor em vez de virar um ruído de poucos pixels).
     */
    function calcularPerfil(seg, mmPorPx) {
        const { fases, width: w, height: h } = seg;
        const comp = new Float64Array(h), areia = new Float64Array(h), gas = new Float64Array(h);
        const excl = new Float64Array(h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const f = fases[y * w + x];
                if (f === 0) comp[y]++; else if (f === 1) areia[y]++; else if (f === 2) gas[y]++; else excl[y]++;
            }
        }
        const janela = Math.max(1, Math.round(JANELA_SUAVIZACAO_MM / mmPorPx));
        const compS = somaMovel(comp, janela), areiaS = somaMovel(areia, janela), gasS = somaMovel(gas, janela);
        const exclS = somaMovel(excl, janela);

        const zMm = new Float64Array(h), cPct = new Float64Array(h), gasPct = new Float64Array(h);
        for (let i = 0; i < h; i++) {
            const y = h - 1 - i;  // linha 0 da imagem é o topo
            const solidos = compS[y] + areiaS[y];
            const validos = solidos + gasS[y];
            const area = validos + exclS[y];
            zMm[i] = (i + 0.5) * mmPorPx;
            cPct[i] = area > 0 && solidos / area >= FRACAO_SOLIDOS_MIN ? 100 * compS[y] / solidos : NaN;
            gasPct[i] = validos > 0 ? 100 * gasS[y] / validos : NaN;
        }
        return { zMm, cPct, gasPct };
    }

    function indiceLacey(seg, mmPorPx) {
        const { fases, width: w, height: h } = seg;
        const alturaAmostra = Math.max(2, Math.round(ALTURA_AMOSTRA_LACEY_MM / mmPorPx));
        const fracoes = [], nParticulas = [];
        for (let inicio = 0; inicio + alturaAmostra <= h; inicio += alturaAmostra) {
            let nComp = 0, nAreia = 0;
            for (let i = inicio * w; i < (inicio + alturaAmostra) * w; i++) {
                if (fases[i] === 0) nComp++; else if (fases[i] === 1) nAreia++;
            }
            const nSolidos = nComp + nAreia;
            if (nSolidos < FRACAO_SOLIDOS_MIN * alturaAmostra * w) continue;
            fracoes.push(nComp / nSolidos);
            nParticulas.push(Math.max(1, nSolidos * mmPorPx * mmPorPx / (D_PARTICULA_MM * D_PARTICULA_MM)));
        }
        if (fracoes.length < 2) return null;
        const m = fracoes.length;
        const p = fracoes.reduce((s, v) => s + v, 0) / m;
        const sigma0 = p * (1 - p);
        const sigmaR = sigma0 / (nParticulas.reduce((s, v) => s + v, 0) / m);
        if (sigma0 - sigmaR <= 0) return null;
        const variancia = fracoes.reduce((s, v) => s + (v - p) ** 2, 0) / (m - 1);
        const M = (sigma0 - variancia) / (sigma0 - sigmaR);
        return arredondar(Math.min(1, Math.max(0, M)), 4);
    }

    function calcularEstatisticas(seg, perfil, mmPorPx) {
        const validos = Array.from(perfil.cPct).filter(v => !Number.isNaN(v));
        const n = validos.length;
        const media = n ? validos.reduce((s, v) => s + v, 0) / n : 0;
        const desvio = n ? Math.sqrt(validos.reduce((s, v) => s + (v - media) ** 2, 0) / n) : 0;
        let nExcluidos = 0;
        for (let i = 0; i < seg.fases.length; i++) if (seg.fases[i] === FASE_EXCLUIDA) nExcluidos++;
        return {
            media_comp: arredondar(media, 3),
            desvio_comp: arredondar(desvio, 3),
            max_comp: n ? arredondar(Math.max(...validos), 3) : 0,
            altura_total_mm: arredondar(seg.height * mmPorPx, 1),
            lacey_index: indiceLacey(seg, mmPorPx),
            excluido_pct: arredondar(100 * nExcluidos / seg.fases.length, 2),
        };
    }

    /** Linhas igualmente espaçadas para a tabela (somente cotas com leito), topo primeiro. */
    function amostrarPerfil(perfil, cMassico) {
        const validos = [];
        perfil.cPct.forEach((v, i) => { if (!Number.isNaN(v)) validos.push(i); });
        if (!validos.length) return [];
        const qtd = Math.min(N_LINHAS_TABELA, validos.length);
        const linhas = [];
        for (let j = 0; j < qtd; j++) {
            const pos = qtd === 1 ? 0 : Math.floor(j * (validos.length - 1) / (qtd - 1));
            const i = validos[pos];
            linhas.push({
                z_mm: arredondar(perfil.zMm[i], 2),
                c_pct: arredondar(perfil.cPct[i], 3),
                c_pct_massico: cMassico ? arredondar(cMassico[i], 3) : null,
                gas_pct: arredondar(perfil.gasPct[i], 2),
            });
        }
        return linhas.reverse();
    }

    /**
     * Análise completa de uma ROI.
     * coef: curva de calibração do modo ({a, b, ...}) ou null.
     */
    function analisarROI(img, larguraMm, modo, coef) {
        if (!MODOS.includes(modo)) throw new Error(`Modo de leitura inválido: ${modo}.`);
        if (!(larguraMm > 0)) throw new Error('A largura da coluna deve ser positiva.');
        if (img.width < 20 || img.height < 20) throw new Error('ROI muito pequena ou fora da imagem.');

        // Escala: assume-se que a largura da ROI corresponde à largura interna da coluna
        const mmPorPx = larguraMm / img.width;
        const seg = segmentar(img, modo);
        const perfil = calcularPerfil(seg, mmPorPx);
        const stats = calcularEstatisticas(seg, perfil, mmPorPx);

        stats.calibrado = !!coef;
        let cMassico = null;
        if (coef) {
            const corrigir = v => Math.min(100, Math.max(0, coef.a + coef.b * v));
            cMassico = perfil.cPct.map(v => (Number.isNaN(v) ? NaN : corrigir(v)));
            stats.media_comp_massica = arredondar(corrigir(stats.media_comp), 3);
        }

        const paraLista = (arr, casas) => Array.from(arr, v => (Number.isNaN(v) ? null : arredondar(v, casas)));
        return {
            seg,
            perfil,
            stats,
            tabela: amostrarPerfil(perfil, cMassico),
            perfil_completo: {
                z_mm: paraLista(perfil.zMm, 2),
                c_pct: paraLista(perfil.cPct, 3),
                c_pct_massico: cMassico ? paraLista(cMassico, 3) : Array.from(perfil.zMm, () => null),
                gas_pct: paraLista(perfil.gasPct, 2),
            },
        };
    }

    // -----------------------------------------------------------------------
    // Calibração (curva C medido -> fração mássica real)
    // -----------------------------------------------------------------------

    /** Fração de compósito (%) numa amostra homogênea: ROI inteira, sem perfil por linha. */
    function medirFracaoHomogenea(img, modo) {
        if (!MODOS.includes(modo)) throw new Error(`Modo de leitura inválido: ${modo}.`);
        if (img.width < 20 || img.height < 20) throw new Error('ROI muito pequena ou fora da imagem.');
        const { fases } = segmentar(img, modo);
        let comp = 0, areia = 0;
        for (let i = 0; i < fases.length; i++) {
            if (fases[i] === 0) comp++; else if (fases[i] === 1) areia++;
        }
        if (comp + areia === 0) throw new Error('ROI sem sólidos identificados (só gás/fundo).');
        return 100 * comp / (comp + areia);
    }

    /** Regressão linear y = a + b·x com R², desvio residual e limites de detecção/quantificação. */
    function ajustarCurva(pontos) {
        const n = pontos.length;
        if (n < MIN_PONTOS_AJUSTE) {
            throw new Error(`São necessários ao menos ${MIN_PONTOS_AJUSTE} pontos para ajustar a curva (há ${n}).`);
        }
        const xs = pontos.map(p => p.x), ys = pontos.map(p => p.y);
        const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
        let sxx = 0, sxy = 0;
        for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
        if (sxx === 0) throw new Error('Os padrões têm o mesmo valor medido; não é possível ajustar a curva.');
        const b = sxy / sxx, a = my - b * mx;

        let ssRes = 0, ssTot = 0;
        for (let i = 0; i < n; i++) { ssRes += (ys[i] - (a + b * xs[i])) ** 2; ssTot += (ys[i] - my) ** 2; }
        const r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
        const sigma = n > 2 ? Math.sqrt(ssRes / (n - 2)) : null;
        return {
            a: arredondar(a, 5),
            b: arredondar(b, 5),
            r2: r2 !== null ? arredondar(r2, 5) : null,
            sigma: sigma !== null ? arredondar(sigma, 4) : null,
            ld: sigma !== null && b !== 0 ? arredondar(3 * sigma / b, 3) : null,
            lq: sigma !== null && b !== 0 ? arredondar(10 * sigma / b, 3) : null,
            n,
            atualizado_em: new Date().toISOString().slice(0, 19) + '+00:00',
        };
    }

    // -----------------------------------------------------------------------
    // Imagens de saída (precisam de DOM / canvas)
    // -----------------------------------------------------------------------

    /**
     * Original | segmentação colorida, lado a lado, como JPEG (data URL).
     * Zonas de exclusão aparecem na segmentação em cinza hachurado, sem cor de fase.
     */
    function gerarOverlay(img, seg) {
        const { width: w, height: h } = img;
        const canvas = document.createElement('canvas');
        canvas.width = 2 * w + 4;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const saida = ctx.createImageData(canvas.width, h);
        const d = saida.data;
        d.fill(255);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const src = (y * w + x) * 4;
                const fase = seg.fases[y * w + x];
                const esq = (y * canvas.width + x) * 4;
                const dir = (y * canvas.width + x + w + 4) * 4;
                for (let c = 0; c < 3; c++) {
                    d[esq + c] = img.data[src + c];
                    d[dir + c] = fase === FASE_EXCLUIDA
                        ? ((x + y) % 8 < 2 ? 95 : 175)
                        : Math.round(0.35 * img.data[src + c] + 0.65 * CORES_FASES[fase][c]);
                }
            }
        }
        ctx.putImageData(saida, 0, 0);
        return canvas.toDataURL('image/jpeg', 0.9);
    }

    /** Valores "redondos" para marcas de eixo. */
    function marcasEixo(min, max, alvo = 6) {
        if (!(max > min)) max = min + 1;
        const bruto = (max - min) / alvo;
        const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
        const passo = [1, 2, 5, 10].map(m => m * mag).find(p => p >= bruto);
        const marcas = [];
        for (let v = Math.ceil(min / passo) * passo; v <= max + passo * 1e-9; v += passo) marcas.push(arredondar(v, 10));
        return { marcas, min: Math.min(min, marcas[0]), max: Math.max(max, marcas[marcas.length - 1]) };
    }

    /** Desenha um painel de eixos e devolve funções de conversão para coordenadas de tela. */
    function desenharEixos(ctx, caixa, ex, ey, { titulo, rotuloX, rotuloY, mostrarY = true }) {
        const { x, y, w, h } = caixa;
        const px = v => x + (v - ex.min) / (ex.max - ex.min) * w;
        const py = v => y + h - (v - ey.min) / (ey.max - ey.min) * h;

        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#334155';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ex.marcas.forEach(v => {
            ctx.beginPath(); ctx.moveTo(px(v), y); ctx.lineTo(px(v), y + h); ctx.stroke();
            ctx.fillText(String(v), px(v), y + h + 5);
        });
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ey.marcas.forEach(v => {
            ctx.beginPath(); ctx.moveTo(x, py(v)); ctx.lineTo(x + w, py(v)); ctx.stroke();
            if (mostrarY) ctx.fillText(String(v), x - 6, py(v));
        });
        ctx.strokeStyle = '#334155';
        ctx.strokeRect(x, y, w, h);

        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(rotuloX, x + w / 2, y + h + 24);
        ctx.font = '14px sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(titulo, x + w / 2, y - 6);
        if (mostrarY && rotuloY) {
            ctx.save();
            ctx.translate(x - 46, y + h / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.font = '12px sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText(rotuloY, 0, 0);
            ctx.restore();
        }
        ctx.restore();
        return { px, py };
    }

    function desenharLinha(ctx, xs, ys, px, py, cor, largura, tracejado) {
        ctx.save();
        ctx.strokeStyle = cor;
        ctx.lineWidth = largura;
        if (tracejado) ctx.setLineDash(tracejado);
        ctx.beginPath();
        let aberto = false;
        for (let i = 0; i < xs.length; i++) {
            if (Number.isNaN(xs[i]) || Number.isNaN(ys[i])) { aberto = false; continue; }
            if (!aberto) { ctx.moveTo(px(xs[i]), py(ys[i])); aberto = true; } else ctx.lineTo(px(xs[i]), py(ys[i]));
        }
        ctx.stroke();
        ctx.restore();
    }

    function desenharLegenda(ctx, itens, xDir, yTopo) {
        ctx.save();
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        const larg = Math.max(...itens.map(i => ctx.measureText(i.texto).width)) + 42;
        const alt = itens.length * 18 + 8;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(xDir - larg, yTopo, larg, alt);
        ctx.strokeRect(xDir - larg, yTopo, larg, alt);
        itens.forEach((item, k) => {
            const yy = yTopo + 13 + k * 18;
            ctx.strokeStyle = item.cor;
            ctx.fillStyle = item.cor;
            ctx.lineWidth = 2;
            ctx.setLineDash(item.tracejado || []);
            if (item.ponto) {
                ctx.beginPath(); ctx.arc(xDir - larg + 18, yy, 4, 0, 2 * Math.PI); ctx.fill();
            } else {
                ctx.beginPath(); ctx.moveTo(xDir - larg + 8, yy); ctx.lineTo(xDir - larg + 30, yy); ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.fillStyle = '#1e293b';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.texto, xDir - larg + 36, yy);
        });
        ctx.restore();
    }

    function novoCanvasGrafico(largura, altura) {
        const escala = 2;  // resolução dobrada para ficar nítido
        const canvas = document.createElement('canvas');
        canvas.width = largura * escala;
        canvas.height = altura * escala;
        const ctx = canvas.getContext('2d');
        ctx.scale(escala, escala);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, largura, altura);
        return { canvas, ctx };
    }

    /** Gráfico C(z) + fração de gás (PNG data URL). */
    function gerarGrafico(perfil, stats) {
        const W = 880, H = 600;
        const { canvas, ctx } = novoCanvasGrafico(W, H);
        const z = Array.from(perfil.zMm), c = Array.from(perfil.cPct), g = Array.from(perfil.gasPct);

        const cValidos = c.filter(v => !Number.isNaN(v));
        const ey = marcasEixo(0, z.length ? z[z.length - 1] : 1);
        const ex = marcasEixo(0, Math.max(1, ...cValidos, stats.media_comp) * 1.05);
        const eg = { marcas: [0, 20, 40, 60, 80, 100], min: 0, max: 100 };

        const caixaC = { x: 80, y: 60, w: 470, h: 460 };
        const caixaG = { x: 580, y: 60, w: 270, h: 460 };

        ctx.fillStyle = '#1e293b';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        const lacey = stats.lacey_index;
        ctx.fillText(`Índice de Lacey M = ${lacey !== null ? lacey : 'n/d'}`, W / 2, 22);

        const eixC = desenharEixos(ctx, caixaC, ex, ey, {
            titulo: 'Perfil de concentração C(z)',
            rotuloX: 'Concentração de compósito (%)',
            rotuloY: 'Cota vertical z (mm)',
        });
        desenharLinha(ctx, c, z, eixC.px, eixC.py, '#8b0000', 1.6);
        desenharLinha(ctx, [stats.media_comp, stats.media_comp], [ey.min, ey.max], eixC.px, eixC.py, '#1e3a8a', 1.2, [6, 4]);
        desenharLegenda(ctx, [
            { texto: 'C(z)', cor: '#8b0000' },
            { texto: `Média = ${stats.media_comp.toFixed(2)} %`, cor: '#1e3a8a', tracejado: [6, 4] },
        ], caixaC.x + caixaC.w - 8, caixaC.y + 8);

        const eixG = desenharEixos(ctx, caixaG, eg, ey, {
            titulo: 'Gás / bolhas', rotuloX: 'Fração de gás (%)', mostrarY: false,
        });
        ctx.save();
        ctx.fillStyle = 'rgba(13,148,136,0.35)';
        ctx.beginPath();
        ctx.moveTo(eixG.px(0), eixG.py(z[0]));
        for (let i = 0; i < z.length; i++) ctx.lineTo(eixG.px(Number.isNaN(g[i]) ? 0 : g[i]), eixG.py(z[i]));
        ctx.lineTo(eixG.px(0), eixG.py(z[z.length - 1]));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        desenharLinha(ctx, g, z, eixG.px, eixG.py, '#0d9488', 1.2);

        return canvas.toDataURL('image/png');
    }

    /** Pontos dos padrões + reta ajustada (PNG data URL). */
    function gerarGraficoCalibracao(pontos, coef, modo) {
        const W = 600, H = 480;
        const { canvas, ctx } = novoCanvasGrafico(W, H);
        const xs = pontos.map(p => p.x), ys = pontos.map(p => p.y);
        const xMax = Math.max(...xs, 1e-6) * 1.15;
        const yReta = [coef.a, coef.a + coef.b * xMax];
        const ex = marcasEixo(0, xMax);
        const ey = marcasEixo(Math.min(0, ...ys, ...yReta), Math.max(...ys, ...yReta, 1e-6) * 1.1);

        const nomeModo = modo === 'uv' ? 'uv' : 'luminosidade';
        const eix = desenharEixos(ctx, { x: 80, y: 40, w: 490, h: 370 }, ex, ey, {
            titulo: `Curva de calibração — modo ${nomeModo}`,
            rotuloX: 'C(z) medido pela plataforma (% da área de sólidos)',
            rotuloY: 'Fração mássica real (%)',
        });
        desenharLinha(ctx, [0, xMax], yReta, eix.px, eix.py, '#8b0000', 1.6);
        ctx.fillStyle = '#1e3a8a';
        pontos.forEach(p => { ctx.beginPath(); ctx.arc(eix.px(p.x), eix.py(p.y), 5, 0, 2 * Math.PI); ctx.fill(); });
        desenharLegenda(ctx, [
            { texto: 'Padrões', cor: '#1e3a8a', ponto: true },
            { texto: `y = ${coef.a.toFixed(3)} + ${coef.b.toFixed(3)}x`, cor: '#8b0000' },
        ], 570 - 8, 48);
        return canvas.toDataURL('image/png');
    }

    const Analise = {
        MODOS,
        MIN_PONTOS_AJUSTE,
        analisarROI,
        medirFracaoHomogenea,
        ajustarCurva,
        gerarGrafico,
        gerarGraficoCalibracao,
        gerarOverlay,
        // expostas para testes
        _interno: { definirTentativas: n => { KMEANS_TENTATIVAS = n; }, desfoqueGaussiano, rgbParaLab8, segmentar, calcularPerfil, indiceLacey, somaMovel },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Analise;
    else global.Analise = Analise;
})(typeof window !== 'undefined' ? window : globalThis);
