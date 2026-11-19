/**
 * Dados online: a base de referências e a calibração ficam como arquivos JSON no próprio
 * repositório do GitHub (pasta dados/), lidos e gravados pela API de conteúdo.
 *
 * - Ler não exige login (o repositório é público).
 * - Gravar exige um token do GitHub com permissão "Contents: Read and write" neste
 *   repositório, colado uma vez em cada navegador (fica só no localStorage dele).
 * - Cada gravação vira um commit no ramo main, então o histórico do Git guarda todas as versões.
 */
const Nuvem = (() => {
    const REPO = 'AguiaLTDA/analiseIM';
    const RAMO = 'main';
    const API = 'https://api.github.com/repos/' + REPO;
    const RAW = 'https://raw.githubusercontent.com/' + REPO + '/' + RAMO + '/';
    const CHAVE_TOKEN = 'analiseIM.github.token';

    function token() {
        try { return localStorage.getItem(CHAVE_TOKEN) || ''; } catch (e) { return ''; }
    }

    function definirToken(t) {
        try {
            if (t) localStorage.setItem(CHAVE_TOKEN, t);
            else localStorage.removeItem(CHAVE_TOKEN);
        } catch (e) { /* armazenamento indisponível */ }
    }

    function bytesParaB64(u8) {
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
    }

    function b64ParaBytes(b64) {
        const s = atob(b64.replace(/\s/g, ''));
        const u = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
        return u;
    }

    /** SHA do objeto "blob" do Git (o mesmo que a API devolve), para leituras feitas sem a API. */
    async function shaBlob(bytes) {
        const cab = new TextEncoder().encode(`blob ${bytes.length}\0`);
        const tudo = new Uint8Array(cab.length + bytes.length);
        tudo.set(cab);
        tudo.set(bytes, cab.length);
        const h = new Uint8Array(await crypto.subtle.digest('SHA-1', tudo));
        return Array.from(h, b => b.toString(16).padStart(2, '0')).join('');
    }

    function descreverErro(status, msg) {
        if (status === 401) return 'token do GitHub inválido ou expirado.';
        if (status === 403 && /rate limit/i.test(msg)) {
            return 'limite de consultas ao GitHub atingido. Tente de novo em alguns minutos.';
        }
        if (status === 403 || status === 404) return 'o token não tem permissão de escrita no repositório ' + REPO + '.';
        if (status === 409 || status === 422) return 'a versão online mudou desde a última sincronização.';
        return `GitHub respondeu ${status}${msg ? ': ' + msg : ''}.`;
    }

    async function requisitar(url, opcoes = {}) {
        const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
        const t = token();
        if (t) headers.Authorization = 'Bearer ' + t;
        let resp;
        try {
            resp = await fetch(url, { cache: 'no-store', ...opcoes, headers: { ...headers, ...(opcoes.headers || {}) } });
        } catch (e) {
            throw new Error('sem conexão com o GitHub.');
        }
        if (resp.ok) return resp.json();
        let msg = '';
        try { msg = (await resp.json()).message || ''; } catch (e) { /* corpo vazio */ }
        const err = new Error(descreverErro(resp.status, msg));
        err.status = resp.status;
        err.limite = resp.status === 403 && /rate limit/i.test(msg);
        throw err;
    }

    /** Leitura pelo raw.githubusercontent (sem limite de consultas, mas com cache de até 5 min). */
    async function lerRaw(caminho) {
        const resp = await fetch(RAW + caminho, { cache: 'no-store' });
        if (resp.status === 404) return null;
        if (!resp.ok) throw new Error(`GitHub respondeu ${resp.status}.`);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        return { texto: new TextDecoder().decode(bytes), sha: await shaBlob(bytes) };
    }

    /** Conteúdo atual do arquivo no repositório: { texto, sha }, ou null se ele ainda não existe. */
    async function ler(caminho) {
        let meta;
        try {
            meta = await requisitar(`${API}/contents/${caminho}?ref=${RAMO}`);
        } catch (err) {
            if (err.status === 404) return null;
            if (err.limite) return lerRaw(caminho);
            throw err;
        }
        let b64 = meta.content;
        // Acima de 1 MB a API de conteúdo não devolve o arquivo; a de blobs devolve.
        if (!b64 || meta.encoding !== 'base64') b64 = (await requisitar(`${API}/git/blobs/${meta.sha}`)).content;
        return { texto: new TextDecoder().decode(b64ParaBytes(b64)), sha: meta.sha };
    }

    /**
     * Grava o arquivo (um commit). `sha` é a versão em que esta máquina se baseou; se a versão
     * online for outra, o GitHub recusa (erro com status 409/422) em vez de sobrescrever.
     * Retorna o sha da nova versão.
     */
    async function gravar(caminho, texto, sha, mensagem) {
        const corpo = { message: mensagem, content: bytesParaB64(new TextEncoder().encode(texto)), branch: RAMO };
        if (sha) corpo.sha = sha;
        const r = await requisitar(`${API}/contents/${caminho}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
        });
        return r.content.sha;
    }

    return { REPO, token, definirToken, ler, gravar };
})();

/**
 * Estado de sincronização de cada item (sha da última versão online conhecida e se há
 * alterações locais ainda não enviadas), guardado no navegador.
 */
const EstadoNuvem = (() => {
    const CHAVE = 'analiseIM.sync.v1';
    let memoria = {};
    let ouvinte = () => {};

    function lerTudo() {
        try { return JSON.parse(localStorage.getItem(CHAVE)) || memoria; } catch (e) { return memoria; }
    }

    function obter(chave) {
        return lerTudo()[chave] || null;
    }

    function definir(chave, valores) {
        const tudo = lerTudo();
        tudo[chave] = { ...(tudo[chave] || {}), ...valores };
        memoria = tudo;
        try { localStorage.setItem(CHAVE, JSON.stringify(tudo)); } catch (e) { /* fica só na memória */ }
        ouvinte();
    }

    function marcarAlterado(chave) {
        definir(chave, { sujo: true });
    }

    function aoMudar(fn) {
        ouvinte = fn;
    }

    return { obter, definir, marcarAlterado, aoMudar };
})();
