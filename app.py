"""
ANÁLISE DE MISTURA EM LEITO FLUIDIZADO - CEUNES / UFES
Backend FastAPI: segmentação não supervisionada (K-Means em CIELAB), perfil C(z) e Índice de Lacey.

Execução:
    python app.py            ->  http://127.0.0.1:8000
"""

import base64
import io
import os
from pathlib import Path
from typing import Optional

import cv2
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent
# Aceita tanto o layout do README (arquivos dentro de static/) quanto os arquivos na raiz
STATIC_DIR = BASE_DIR / "static" if (BASE_DIR / "static" / "index.html").exists() else BASE_DIR
IMAGEM_EXEMPLO = STATIC_DIR / "img" / "frame_exemplo.jpg"

# Parâmetros da análise
N_CLUSTERS = 3                 # compósito, areia, gás
DELTA_L_MIN_GAS = 10.0         # separação mínima de luminosidade (L*) para aceitar um cluster de gás
JANELA_SUAVIZACAO_MM = 2.0     # altura da janela móvel do perfil C(z)
FRACAO_SOLIDOS_MIN = 0.20      # abaixo disso a cota é considerada sem leito (C = null)
ALTURA_AMOSTRA_LACEY_MM = 5.0  # altura de cada amostra (faixa horizontal) usada no Índice de Lacey
D_PARTICULA_MM = 1.0           # diâmetro da areia (estimativa do nº de partículas por amostra)
N_LINHAS_TABELA = 25

# Cores da máscara (BGR): compósito vermelho, areia bege, gás azul (mesmas do favicon)
CORES_FASES = {
    0: (40, 40, 200),    # compósito
    1: (140, 190, 220),  # areia
    2: (230, 160, 60),   # gás
}

app = FastAPI(title="Análise de Mistura em Leito Fluidizado - CEUNES/UFES")

for sub in ("css", "js", "img"):
    if (STATIC_DIR / sub).is_dir():
        app.mount(f"/static/{sub}", StaticFiles(directory=STATIC_DIR / sub), name=f"static_{sub}")


# ---------------------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/imagem_exemplo")
def imagem_exemplo():
    if not IMAGEM_EXEMPLO.exists():
        raise HTTPException(404, "Imagem de exemplo não encontrada.")
    return {"imagem_base64": base64.b64encode(IMAGEM_EXEMPLO.read_bytes()).decode("ascii")}


@app.post("/api/analisar_roi")
async def analisar_roi(
    x: int = Form(...),
    y: int = Form(...),
    width: int = Form(...),
    height: int = Form(...),
    largura_mm: float = Form(60.0),
    usar_exemplo: str = Form("true"),
    arquivo: Optional[UploadFile] = File(None),
):
    # Lê bytes + imdecode (cv2.imread falha com acentos no caminho no Windows)
    if str(usar_exemplo).lower() in ("true", "1", "sim"):
        dados = IMAGEM_EXEMPLO.read_bytes()
    else:
        if arquivo is None:
            raise HTTPException(400, "Nenhum arquivo de imagem enviado.")
        dados = await arquivo.read()
    # IMREAD_COLOR aplica a orientação EXIF, igual ao navegador
    img = cv2.imdecode(np.frombuffer(dados, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Não foi possível decodificar a imagem.")

    # Recorte da ROI (limitado às bordas da imagem)
    h_img, w_img = img.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(w_img, x + width), min(h_img, y + height)
    if x1 - x0 < 20 or y1 - y0 < 20:
        raise HTTPException(400, "ROI muito pequena ou fora da imagem.")
    if largura_mm <= 0:
        raise HTTPException(400, "A largura da coluna deve ser positiva.")
    roi = img[y0:y1, x0:x1]

    # Escala: assume-se que a largura da ROI corresponde à largura interna da coluna
    mm_por_px = largura_mm / roi.shape[1]

    fases = segmentar_fases(roi)
    perfil = calcular_perfil(fases, mm_por_px)
    stats = calcular_estatisticas(fases, perfil, mm_por_px)

    return {
        "plot_b64": gerar_grafico(perfil, stats),
        "seg_overlay_b64": gerar_overlay(roi, fases),
        "stats": stats,
        "perfil": amostrar_perfil(perfil),
        "perfil_completo": {
            "z_mm": [round(float(v), 2) for v in perfil["z_mm"]],
            "c_pct": [None if np.isnan(v) else round(float(v), 3) for v in perfil["c_pct"]],
            "gas_pct": [round(float(v), 2) for v in perfil["gas_pct"]],
        },
    }


# ---------------------------------------------------------------------------
# Processamento
# ---------------------------------------------------------------------------

def segmentar_fases(roi_bgr: np.ndarray) -> np.ndarray:
    """
    Classifica cada pixel em 0 = compósito, 1 = areia, 2 = gás via K-Means em CIELAB.
    Os clusters são rotulados pela luminosidade L*: o mais escuro é o compósito,
    o intermediário a areia e o mais claro o gás (bolhas / região livre).
    """
    blur = cv2.GaussianBlur(roi_bgr, (3, 3), 0)
    lab = cv2.cvtColor(blur, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)

    cv2.setRNGSeed(42)  # resultados reprodutíveis
    criterios = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5)
    _, rotulos, centros = cv2.kmeans(lab, N_CLUSTERS, None, criterios, 5, cv2.KMEANS_PP_CENTERS)
    rotulos = rotulos.ravel()

    # L* do OpenCV vai de 0 a 255; converte para a escala 0-100
    l_centros = centros[:, 0] * 100.0 / 255.0
    ordem = np.argsort(l_centros)  # escuro -> claro
    mapa = np.empty(N_CLUSTERS, dtype=np.uint8)
    mapa[ordem[0]] = 0
    mapa[ordem[1]] = 1
    mapa[ordem[2]] = 2
    # Se o cluster mais claro não se distingue da areia, a ROI não contém gás: funde com a areia
    if l_centros[ordem[2]] - l_centros[ordem[1]] < DELTA_L_MIN_GAS:
        mapa[ordem[2]] = 1

    return mapa[rotulos].reshape(roi_bgr.shape[:2])


def calcular_perfil(fases: np.ndarray, mm_por_px: float) -> dict:
    """Perfil vertical por linha de pixels, suavizado por janela móvel. z = 0 na base da ROI."""
    altura = fases.shape[0]
    comp = (fases == 0).sum(axis=1).astype(float)
    areia = (fases == 1).sum(axis=1).astype(float)
    gas = (fases == 2).sum(axis=1).astype(float)

    janela = max(1, int(round(JANELA_SUAVIZACAO_MM / mm_por_px)))
    kernel = np.ones(janela)
    comp_s = np.convolve(comp, kernel, mode="same")
    areia_s = np.convolve(areia, kernel, mode="same")
    gas_s = np.convolve(gas, kernel, mode="same")
    total_s = comp_s + areia_s + gas_s
    solidos_s = comp_s + areia_s

    with np.errstate(invalid="ignore", divide="ignore"):
        c_pct = np.where(solidos_s / total_s >= FRACAO_SOLIDOS_MIN, 100.0 * comp_s / solidos_s, np.nan)
        gas_pct = 100.0 * gas_s / total_s

    # Linha 0 da imagem é o topo; inverte para z crescer de baixo para cima
    z_mm = (altura - 1 - np.arange(altura) + 0.5) * mm_por_px
    ordem = np.argsort(z_mm)
    return {"z_mm": z_mm[ordem], "c_pct": c_pct[ordem], "gas_pct": gas_pct[ordem]}


def calcular_estatisticas(fases: np.ndarray, perfil: dict, mm_por_px: float) -> dict:
    c_validos = perfil["c_pct"][~np.isnan(perfil["c_pct"])]
    altura_total = fases.shape[0] * mm_por_px

    return {
        "media_comp": round(float(np.mean(c_validos)), 3) if c_validos.size else 0.0,
        "desvio_comp": round(float(np.std(c_validos)), 3) if c_validos.size else 0.0,
        "max_comp": round(float(np.max(c_validos)), 3) if c_validos.size else 0.0,
        "altura_total_mm": round(float(altura_total), 1),
        "lacey_index": indice_lacey(fases, mm_por_px),
    }


def indice_lacey(fases: np.ndarray, mm_por_px: float):
    """
    M = (σ0² - σ²) / (σ0² - σR²)
      σ²  : variância da fração de compósito entre amostras (faixas horizontais da ROI)
      σ0² = p(1-p)        : estado totalmente segregado
      σR² = p(1-p) / n    : mistura aleatória perfeita, n = partículas por amostra
    Retorna None se não houver amostras suficientes.
    """
    altura_amostra_px = max(2, int(round(ALTURA_AMOSTRA_LACEY_MM / mm_por_px)))
    fracoes, n_particulas = [], []
    for inicio in range(0, fases.shape[0] - altura_amostra_px + 1, altura_amostra_px):
        faixa = fases[inicio:inicio + altura_amostra_px]
        n_comp = int((faixa == 0).sum())
        n_solidos = n_comp + int((faixa == 1).sum())
        if n_solidos < FRACAO_SOLIDOS_MIN * faixa.size:
            continue
        fracoes.append(n_comp / n_solidos)
        area_solidos_mm2 = n_solidos * mm_por_px ** 2
        n_particulas.append(max(1.0, area_solidos_mm2 / D_PARTICULA_MM ** 2))

    if len(fracoes) < 2:
        return None
    fracoes = np.array(fracoes)
    p = float(fracoes.mean())
    sigma0_2 = p * (1 - p)
    sigmaR_2 = sigma0_2 / float(np.mean(n_particulas))
    if sigma0_2 - sigmaR_2 <= 0:
        return None
    m = (sigma0_2 - float(fracoes.var(ddof=1))) / (sigma0_2 - sigmaR_2)
    return round(float(np.clip(m, 0.0, 1.0)), 4)


def amostrar_perfil(perfil: dict) -> list:
    """Linhas igualmente espaçadas para a tabela da interface (somente cotas com leito)."""
    validos = np.where(~np.isnan(perfil["c_pct"]))[0]
    if validos.size == 0:
        return []
    idx = validos[np.linspace(0, validos.size - 1, min(N_LINHAS_TABELA, validos.size)).astype(int)]
    return [
        {
            "z_mm": round(float(perfil["z_mm"][i]), 2),
            "c_pct": round(float(perfil["c_pct"][i]), 3),
            "gas_pct": round(float(perfil["gas_pct"][i]), 2),
        }
        for i in idx[::-1]  # topo primeiro, como na imagem
    ]


# ---------------------------------------------------------------------------
# Imagens de saída
# ---------------------------------------------------------------------------

def gerar_grafico(perfil: dict, stats: dict) -> str:
    fig, (ax_c, ax_g) = plt.subplots(1, 2, figsize=(8, 5.5), sharey=True,
                                     gridspec_kw={"width_ratios": [2, 1]})
    z = perfil["z_mm"]

    ax_c.plot(perfil["c_pct"], z, color="#8b0000", lw=1.6, label="C(z)")
    ax_c.axvline(stats["media_comp"], color="#1e3a8a", ls="--", lw=1.2,
                 label=f"Média = {stats['media_comp']:.2f} %")
    ax_c.set_xlabel("Concentração de compósito (%)")
    ax_c.set_ylabel("Cota vertical z (mm)")
    ax_c.set_title("Perfil de concentração C(z)")
    ax_c.grid(alpha=0.3)
    ax_c.legend(loc="best", fontsize=8)

    ax_g.fill_betweenx(z, 0, perfil["gas_pct"], color="#0d9488", alpha=0.35)
    ax_g.plot(perfil["gas_pct"], z, color="#0d9488", lw=1.2)
    ax_g.set_xlabel("Fração de gás (%)")
    ax_g.set_title("Gás / bolhas")
    ax_g.set_xlim(0, 100)
    ax_g.grid(alpha=0.3)

    lacey = stats["lacey_index"]
    fig.suptitle(f"Índice de Lacey M = {lacey if lacey is not None else 'n/d'}", fontsize=10)
    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def gerar_overlay(roi_bgr: np.ndarray, fases: np.ndarray) -> str:
    cores = np.zeros_like(roi_bgr)
    for fase, cor in CORES_FASES.items():
        cores[fases == fase] = cor
    overlay = cv2.addWeighted(roi_bgr, 0.35, cores, 0.65, 0)
    # Lado a lado: original | segmentação
    lado_a_lado = np.hstack([roi_bgr, np.full((roi_bgr.shape[0], 4, 3), 255, np.uint8), overlay])
    ok, buf = cv2.imencode(".jpg", lado_a_lado, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return base64.b64encode(buf.tobytes()).decode("ascii")


if __name__ == "__main__":
    # Em hospedagens (Railway etc.) a porta vem da variável PORT e é preciso escutar em 0.0.0.0
    porta = int(os.environ.get("PORT", 8000))
    host = "0.0.0.0" if "PORT" in os.environ else "127.0.0.1"
    uvicorn.run("app:app", host=host, port=porta, reload=False)
