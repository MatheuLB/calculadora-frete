// Conta do Frete: calcula quanto sobra de um frete e compara ofertas.
// Roda inteiro no navegador; guarda os dados só no próprio aparelho.

// ===== Configuração =====
const MOTORISTA = 0.12; // parte fixa do motorista sobre o valor do frete

const ROTA_URL = "https://router.project-osrm.org/route/v1/driving/";
const ROTA_TEMPO_LIMITE = 8000; // ms
const ROTA_INTERVALO = 1100; // ms entre pedidos (o serviço aceita 1 por segundo)

// Sem o serviço de rotas, a distância é a linha reta vezes um fator.
// Medido em 60 rotas reais pelo Brasil (out/2026): até 800 km a estrada
// sai ~40% maior que a reta; acima disso, ~29%.
const fatorEstrada = (retaKm) => (retaKm < 800 ? 1.4 : 1.29);

const CHAVES = {
  config: "frete.config",
  rotas: "frete.rotas",
  ofertas: "frete.ofertas",
  ordem: "frete.ordem",
  aviso: "frete.aviso-instalar",
};
const MAX_ROTAS_GUARDADAS = 500;

// ===== Ajudantes =====
const $ = (seletor) => document.querySelector(seletor);

function normalizar(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Aceita "6,20", "6.20", "4.500", "4.500,00" e "R$ 4500". Vazio = null; inválido = NaN.
function lerNumero(texto) {
  let t = String(texto ?? "").replace(/R\$|\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const fmtReais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtInteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtMedia = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const fmtDinheiro = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reais = (v) => fmtReais.format(v);
const km = (v) => `${fmtInteiro.format(v)} km`;

function ler(chave, padrao) {
  try {
    const v = localStorage.getItem(chave);
    return v ? JSON.parse(v) : padrao;
  } catch {
    return padrao;
  }
}

function guardar(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem armazenamento: o app segue funcionando, só não lembra */
  }
}

function distanciaReta(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ===== Cidades =====
const cidades = window.CIDADES.split(";").map((linha) => {
  const [nome, uf, lat, lon, capital] = linha.split("|");
  return { nome, uf, lat: Number(lat), lon: Number(lon), capital: capital === "1", chave: `${nome}|${uf}`, busca: normalizar(nome) };
});
const cidadePorChave = new Map(cidades.map((c) => [c.chave, c]));
const UFS = new Set(cidades.map((c) => c.uf));

const rotulo = (c) => `${c.nome} – ${c.uf}`;

function procurar(texto) {
  let q = normalizar(texto);
  if (!q) return [];
  let uf = null;
  const comUf = q.match(/^(.+) ([a-z]{2})$/);
  if (comUf && UFS.has(comUf[2].toUpperCase())) {
    q = comUf[1];
    uf = comUf[2].toUpperCase();
  }
  const achadas = [];
  for (const c of cidades) {
    if (uf && c.uf !== uf) continue;
    let nota;
    if (c.busca === q) nota = 0;
    else if (c.busca.startsWith(q)) nota = 1;
    else if (c.busca.includes(" " + q)) nota = 2;
    else if (c.busca.includes(q)) nota = 3;
    else continue;
    achadas.push({ c, nota });
  }
  achadas.sort(
    (a, b) => a.nota - b.nota || b.c.capital - a.c.capital || a.c.nome.length - b.c.nome.length || a.c.nome.localeCompare(b.c.nome)
  );
  return achadas;
}

const buscarCidades = (texto, limite = 8) => procurar(texto).slice(0, limite).map((a) => a.c);

// Só resolve sozinho quando o texto bate com uma única cidade.
function resolverCidade(texto) {
  const exatas = procurar(texto).filter((a) => a.nota === 0);
  return exatas.length === 1 ? exatas[0].c : null;
}

function cidadeMaisProxima(lat, lon) {
  const ponto = { lat, lon };
  let melhor = null;
  let menor = Infinity;
  for (const c of cidades) {
    const d = distanciaReta(ponto, c);
    if (d < menor) [melhor, menor] = [c, d];
  }
  return melhor;
}

// ===== Distâncias =====
const rotasGuardadas = ler(CHAVES.rotas, {});
const chaveRota = (a, b) => [a.chave, b.chave].sort().join(">");

function guardarRota(a, b, kmEstrada) {
  rotasGuardadas[chaveRota(a, b)] = kmEstrada;
  const chaves = Object.keys(rotasGuardadas);
  if (chaves.length > MAX_ROTAS_GUARDADAS) delete rotasGuardadas[chaves[0]];
  guardar(CHAVES.rotas, rotasGuardadas);
}

let filaRotas = Promise.resolve();
let ultimoPedido = 0;

// Uma chamada só para a viagem inteira; devolve os km de cada trecho ou null.
function pedirRota(pontos) {
  const vez = filaRotas.then(async () => {
    const espera = ultimoPedido + ROTA_INTERVALO - Date.now();
    if (espera > 0) await esperar(espera);
    ultimoPedido = Date.now();
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), ROTA_TEMPO_LIMITE);
    try {
      const coords = pontos.map((c) => `${c.lon},${c.lat}`).join(";");
      const resposta = await fetch(`${ROTA_URL}${coords}?overview=false`, { signal: controle.signal });
      const dados = await resposta.json();
      if (dados.code !== "Ok" || !dados.routes?.[0]?.legs) return null;
      return dados.routes[0].legs.map((perna) => Math.round(perna.distance / 1000));
    } catch {
      return null;
    } finally {
      clearTimeout(relogio);
    }
  });
  filaRotas = vez.catch(() => null);
  return vez;
}

// paradas: cidades na ordem da viagem. Devolve [{km, estimada}] por trecho.
async function medirTrechos(paradas) {
  const trechos = [];
  for (let i = 0; i < paradas.length - 1; i++) trechos.push([paradas[i], paradas[i + 1]]);
  const medidas = trechos.map(([a, b]) => {
    if (a === b) return { km: 0, estimada: false };
    const guardada = rotasGuardadas[chaveRota(a, b)];
    return guardada != null ? { km: guardada, estimada: false } : null;
  });
  if (medidas.every(Boolean)) return medidas;

  const pontos = paradas.filter((c, i) => i === 0 || c !== paradas[i - 1]);
  const pernas = await pedirRota(pontos);
  let perna = 0;
  trechos.forEach(([a, b], i) => {
    if (a === b) return;
    const kmPerna = pernas ? pernas[perna] : null;
    perna++;
    if (medidas[i]) return;
    if (kmPerna != null) {
      guardarRota(a, b, kmPerna);
      medidas[i] = { km: kmPerna, estimada: false };
    } else {
      const reta = distanciaReta(a, b);
      medidas[i] = { km: Math.round(reta * fatorEstrada(reta)), estimada: true };
    }
  });
  return medidas;
}

function linkMapa(paradas) {
  const nome = (c) => `${c.nome}, ${c.uf}, Brasil`;
  const pontos = paradas.filter((c, i) => i === 0 || c !== paradas[i - 1]);
  const p = new URLSearchParams({ api: "1", origin: nome(pontos[0]), destination: nome(pontos[pontos.length - 1]), travelmode: "driving" });
  const meio = pontos.slice(1, -1);
  if (meio.length) p.set("waypoints", meio.map(nome).join("|"));
  return `https://www.google.com/maps/dir/?${p}`;
}

// ===== A conta =====
function paradasDaViagem({ atual, pega, entrega, volta }) {
  const paradas = [atual, pega || atual, entrega];
  if (volta) paradas.push(atual);
  return paradas;
}

function contaDoFrete({ trechos, kmManual, media, diesel, frete, outros }) {
  const kmRota = trechos.reduce((soma, t) => soma + t.km, 0);
  const kmTotal = kmManual ?? kmRota;
  const litros = kmTotal / media;
  const custoDiesel = litros * diesel;
  const motorista = frete * MOTORISTA;
  const ganho = frete - motorista - custoDiesel - outros;
  return {
    kmTotal,
    litros,
    custoDiesel,
    motorista,
    ganho,
    margem: frete ? ganho / frete : 0,
    porKm: kmTotal ? ganho / kmTotal : 0,
    estimada: kmManual == null && trechos.some((t) => t.estimada),
  };
}

// ===== Formulários =====
function cidadeDoCampo(input) {
  return cidadePorChave.get(input.dataset.chave) || null;
}

function definirCidade(input, c) {
  input.value = c ? rotulo(c) : "";
  if (c) input.dataset.chave = c.chave;
  else delete input.dataset.chave;
}

function mostrarErro(input, mensagem) {
  const campo = input.closest(".campo");
  const erro = campo.querySelector(".erro");
  campo.classList.toggle("tem-erro", Boolean(mensagem));
  if (erro) {
    erro.textContent = mensagem || "";
    erro.hidden = !mensagem;
  }
}

// Lê um campo de cidade. obrigatoria=false aceita vazio (devolve null).
function lerCidade(input, { obrigatoria, mensagemVazio }) {
  if (!input.value.trim()) {
    if (obrigatoria) throw [input, mensagemVazio];
    return null;
  }
  const c = cidadeDoCampo(input) || resolverCidade(input.value);
  if (!c) throw [input, "Escolha a cidade na lista que aparece ao digitar."];
  definirCidade(input, c);
  return c;
}

function lerValor(input, { minimo = 0, maximo = Infinity, obrigatorio = true, mensagem }) {
  const n = lerNumero(input.value);
  if (n == null && !obrigatorio) return 0;
  if (n == null || Number.isNaN(n) || n <= minimo || n > maximo) throw [input, mensagem];
  return n;
}

// Roda as leituras e mostra o primeiro erro de cada campo. Devolve null se algo falhou.
function validar(leituras) {
  const valores = {};
  let ok = true;
  for (const [nome, input, leitura] of leituras) {
    try {
      valores[nome] = leitura();
      mostrarErro(input, null);
    } catch (falha) {
      if (!Array.isArray(falha)) throw falha;
      mostrarErro(falha[0], falha[1]);
      ok = false;
    }
  }
  return ok ? valores : null;
}

function formatarAoSair(input, formato) {
  input.addEventListener("change", () => {
    const n = lerNumero(input.value);
    if (n != null && !Number.isNaN(n)) input.value = formato.format(n);
  });
}

// Campo de cidade com sugestões ao digitar.
function ligarCampoCidade(input, aoEscolher) {
  const lista = input.closest(".campo").querySelector(".sugestoes");
  lista.id = `${input.id}-lista`;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", lista.id);
  input.setAttribute("aria-expanded", "false");
  let opcoes = [];
  let ativa = -1;

  const fechar = () => {
    lista.hidden = true;
    ativa = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const desenhar = () => {
    lista.innerHTML = opcoes
      .map(
        (c, i) =>
          `<li role="option" id="${lista.id}-${i}" data-i="${i}" aria-selected="${i === ativa}"><span>${escapar(c.nome)}</span><span class="uf">${c.uf}</span></li>`
      )
      .join("");
    if (ativa >= 0) input.setAttribute("aria-activedescendant", `${lista.id}-${ativa}`);
  };
  const abrir = () => {
    opcoes = buscarCidades(input.value);
    if (!opcoes.length) return fechar();
    desenhar();
    lista.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  const escolher = (c) => {
    definirCidade(input, c);
    fechar();
    mostrarErro(input, null);
    aoEscolher?.(c);
  };

  input.addEventListener("input", () => {
    delete input.dataset.chave;
    ativa = -1;
    abrir();
  });
  input.addEventListener("keydown", (e) => {
    if (lista.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      ativa = e.key === "ArrowDown" ? Math.min(ativa + 1, opcoes.length - 1) : Math.max(ativa - 1, 0);
      desenhar();
    } else if (e.key === "Enter") {
      e.preventDefault();
      escolher(opcoes[Math.max(ativa, 0)]);
    } else if (e.key === "Escape") {
      fechar();
    }
  });
  lista.addEventListener("mousedown", (e) => e.preventDefault());
  lista.addEventListener("click", (e) => {
    const item = e.target.closest("li");
    if (item) escolher(opcoes[Number(item.dataset.i)]);
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === input) return;
      fechar();
      if (!input.dataset.chave && input.value.trim()) {
        const c = resolverCidade(input.value);
        if (c) escolher(c);
      }
    }, 180);
  });
}

// ===== Configuração do caminhão (compartilhada pelas duas abas) =====
const campos = {
  atual: $("#atual"),
  pega: $("#pega"),
  entrega: $("#entrega"),
  volta: $("#volta"),
  media: $("#media"),
  diesel: $("#diesel"),
  frete: $("#frete"),
  outros: $("#outros"),
  kmManual: $("#km-manual"),
};

function lerConfig() {
  const config = ler(CHAVES.config, {});
  return {
    atual: cidadePorChave.get(config.atual) || null,
    media: config.media > 0 ? config.media : null,
    diesel: config.diesel > 0 ? config.diesel : null,
    volta: Boolean(config.volta),
  };
}

function salvarConfig() {
  const config = ler(CHAVES.config, {});
  const atual = cidadeDoCampo(campos.atual);
  const media = lerNumero(campos.media.value);
  const diesel = lerNumero(campos.diesel.value);
  if (atual) config.atual = atual.chave;
  if (media > 0) config.media = media;
  if (diesel > 0) config.diesel = diesel;
  config.volta = campos.volta.checked;
  guardar(CHAVES.config, config);
}

function usarLocalizacao() {
  const botao = $("#usar-local");
  const pronto = () => (botao.textContent = "Usar minha localização");
  if (!navigator.geolocation) {
    mostrarErro(campos.atual, "Este aparelho não informa a localização. Digite a cidade.");
    return;
  }
  botao.textContent = "Procurando…";
  navigator.geolocation.getCurrentPosition(
    (posicao) => {
      definirCidade(campos.atual, cidadeMaisProxima(posicao.coords.latitude, posicao.coords.longitude));
      mostrarErro(campos.atual, null);
      salvarConfig();
      pronto();
    },
    () => {
      mostrarErro(campos.atual, "Não deu para pegar a localização. Libere em Ajustes › Privacidade › Serviços de Localização, ou digite a cidade.");
      pronto();
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
  );
}

function restaurarConfig() {
  const config = lerConfig();
  if (config.atual) definirCidade(campos.atual, config.atual);
  if (config.media) campos.media.value = fmtMedia.format(config.media);
  if (config.diesel) campos.diesel.value = fmtDinheiro.format(config.diesel);
  campos.volta.checked = config.volta;
}

// ===== Aba Calcular =====
let ultimaViagem = null;

function lerViagem() {
  return validar([
    ["atual", campos.atual, () => lerCidade(campos.atual, { obrigatoria: true, mensagemVazio: "Informe a cidade onde o caminhão está." })],
    ["pega", campos.pega, () => lerCidade(campos.pega, { obrigatoria: false })],
    ["entrega", campos.entrega, () => lerCidade(campos.entrega, { obrigatoria: true, mensagemVazio: "Informe para onde vai a carga." })],
    ["media", campos.media, () => lerValor(campos.media, { maximo: 15, mensagem: "Informe a média do caminhão em km por litro, por exemplo 2,5." })],
    ["diesel", campos.diesel, () => lerValor(campos.diesel, { maximo: 30, mensagem: "Informe o preço do litro do diesel, por exemplo 6,20." })],
    ["frete", campos.frete, () => lerValor(campos.frete, { mensagem: "Informe quanto paga o frete." })],
    ["outros", campos.outros, () => lerValor(campos.outros, { minimo: -1, obrigatorio: false, mensagem: "Valor inválido. Deixe vazio se não tiver pedágio." })],
    ["kmManual", campos.kmManual, () => (campos.kmManual.value.trim() ? lerValor(campos.kmManual, { mensagem: "Km inválido. Deixe vazio para calcular sozinho." }) : null)],
  ]);
}

async function calcular() {
  const viagem = lerViagem();
  if (!viagem) {
    document.querySelector(".tem-erro input")?.focus();
    return;
  }
  viagem.volta = campos.volta.checked;
  salvarConfig();

  const botao = $("#botao-calcular");
  botao.disabled = true;
  botao.textContent = "Buscando a rota…";
  const paradas = paradasDaViagem(viagem);
  try {
    const trechos = await medirTrechos(paradas);
    ultimaViagem = { ...viagem, paradas, trechos, conta: contaDoFrete({ ...viagem, trechos }) };
    mostrarResultado(ultimaViagem);
  } finally {
    botao.disabled = false;
    botao.textContent = "Calcular ganho";
  }
}

function linhaConta(rotulo, valor, { detalhe = "", classe = "" } = {}) {
  return `<div class="conta-linha ${classe}"><span class="rotulo">${rotulo}${detalhe ? `<span class="detalhe">${detalhe}</span>` : ""}</span><span class="valor">${valor}</span></div>`;
}

function mostrarResultado(v) {
  const { conta } = v;
  const lucro = conta.ganho > 0;
  const nomes = v.paradas.filter((c, i) => i === 0 || c !== v.paradas[i - 1]).map((c) => `<span>${escapar(rotulo(c))}</span>`);

  const marcos = [];
  if (v.kmManual != null) {
    marcos.push(["Km total (digitado)", km(conta.kmTotal)]);
  } else {
    marcos.push(["Vazio até a carga", km(v.trechos[0].km)]);
    marcos.push(["Com carga", km(v.trechos[1].km)]);
    if (v.volta) marcos.push(["Volta vazio", km(v.trechos[2].km)]);
    marcos.push(["Total rodado", km(conta.kmTotal)]);
  }
  marcos.push(["Diesel gasto", `${fmtInteiro.format(conta.litros)} litros`]);
  marcos.push(["Ganho por km", reais(conta.porKm)]);

  let fonte;
  if (v.kmManual != null) fonte = `<p class="fonte-distancia">Conta feita com o km total que você digitou.</p>`;
  else if (conta.estimada)
    fonte = `<p class="fonte-distancia estimada">Sem conexão com o serviço de rotas, então a distância é uma estimativa (linha reta + 30 a 40%). Confira os km no mapa e, se quiser, digite em <strong>Km total</strong>.</p>`;
  else fonte = `<p class="fonte-distancia">Distância pela estrada, calculada no mapa do OpenStreetMap. A rota do caminhão pode variar um pouco.</p>`;

  $("#resultado").innerHTML = `
    <div class="placa">
      <div class="placa-borda">
        <div class="placa-rota">${nomes.join('<span class="seta" aria-hidden="true">→</span>')}</div>
        <div class="placa-rotulo">Ganho estimado</div>
        <div class="placa-valor">${reais(conta.ganho)}</div>
        <p class="placa-nota">${lucro ? `Sobram ${fmtInteiro.format(conta.margem * 100)}% do frete` : "O frete não cobre os custos"} · ${reais(conta.porKm)} por km rodado</p>
        <span class="selo ${lucro ? "" : "prejuizo"}">${lucro ? "Dá lucro" : "Prejuízo"}</span>
      </div>
    </div>
    <div class="conta">
      ${linhaConta("Frete", reais(v.frete))}
      ${linhaConta("Motorista (12%)", `− ${reais(conta.motorista)}`, { classe: "menos" })}
      ${linhaConta("Diesel", `− ${reais(conta.custoDiesel)}`, {
        classe: "menos",
        detalhe: `${km(conta.kmTotal)} ÷ ${fmtMedia.format(v.media)} km/l = ${fmtInteiro.format(conta.litros)} l × ${reais(v.diesel)}`,
      })}
      ${v.outros ? linhaConta("Pedágio e outros", `− ${reais(v.outros)}`, { classe: "menos" }) : ""}
      ${linhaConta("Sobra", reais(conta.ganho), { classe: `total ${lucro ? "positivo" : "negativo"}` })}
    </div>
    <div class="marcos">
      ${marcos.map(([r, val]) => `<div class="marco"><div class="marco-rotulo">${r}</div><div class="marco-valor">${val}</div></div>`).join("")}
    </div>
    ${fonte}
    <div class="acoes-resultado">
      <a class="botao-secundario" href="${escapar(linkMapa(v.paradas))}" target="_blank" rel="noopener">Ver rota no mapa</a>
      <button type="button" class="botao-secundario" id="guardar-viagem">Guardar para comparar</button>
    </div>
    <p class="nota-final">Não entram na conta: manutenção, pneus, seguro e outras despesas do caminhão.</p>`;

  $("#guardar-viagem").addEventListener("click", (e) => {
    adicionarOferta({ pega: (v.pega || v.atual).chave, entrega: v.entrega.chave, valor: v.frete, outros: v.outros, obs: "" });
    e.currentTarget.textContent = "Guardado em Comparar fretes";
    e.currentTarget.disabled = true;
  });
}

// ===== Aba Comparar =====
let ofertas = ler(CHAVES.ofertas, []);
let ordem = ler(CHAVES.ordem, "ganho");
let vezDaLista = 0;

function adicionarOferta(oferta) {
  ofertas.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...oferta });
  guardar(CHAVES.ofertas, ofertas);
}

function textoBase(config) {
  if (!config.atual || !config.media || !config.diesel) return null;
  return `Contas saindo de <strong>${escapar(rotulo(config.atual))}</strong>, média <strong>${fmtMedia.format(config.media)} km/l</strong>, diesel <strong>${reais(config.diesel)}</strong>, motorista 12%${config.volta ? ", somando a volta vazio" : ""}. Para mudar, use a aba Calcular.`;
}

async function mostrarOfertas() {
  const vez = ++vezDaLista;
  const config = lerConfig();
  const base = textoBase(config);
  const lista = $("#lista-ofertas");
  $("#base-calculo").innerHTML = base || "Antes de comparar, preencha na aba <strong>Calcular</strong> onde o caminhão está, a média e o preço do diesel.";
  $("#ofertas-vazio").hidden = ofertas.length > 0;
  $("#cabecalho-lista").hidden = ofertas.length === 0;
  document.querySelectorAll(".ordem-botao").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ordem === ordem)));
  if (!ofertas.length) {
    lista.innerHTML = "";
    return;
  }
  if (!base) {
    lista.innerHTML = ofertas.map((o) => cartaoOferta(o, null)).join("");
    return;
  }

  lista.setAttribute("aria-busy", "true");
  const contas = await Promise.all(
    ofertas.map(async (o) => {
      const pega = cidadePorChave.get(o.pega);
      const entrega = cidadePorChave.get(o.entrega);
      if (!pega || !entrega) return null;
      const viagem = { atual: config.atual, pega, entrega, volta: config.volta };
      const trechos = await medirTrechos(paradasDaViagem(viagem));
      return { trechos, ...contaDoFrete({ trechos, kmManual: null, media: config.media, diesel: config.diesel, frete: o.valor, outros: o.outros || 0 }) };
    })
  );
  if (vez !== vezDaLista) return; // a lista mudou enquanto calculava

  const ordenadas = ofertas.map((o, i) => ({ o, conta: contas[i] })).sort((a, b) => (b.conta?.[ordem] ?? -Infinity) - (a.conta?.[ordem] ?? -Infinity));
  lista.innerHTML = ordenadas.map(({ o, conta }, i) => cartaoOferta(o, conta, i)).join("");
  lista.removeAttribute("aria-busy");
}

function cartaoOferta(o, conta, posicao = null) {
  const pega = cidadePorChave.get(o.pega);
  const entrega = cidadePorChave.get(o.entrega);
  const rota = `${escapar(pega ? rotulo(pega) : o.pega)}<span class="seta" aria-hidden="true">→</span>${escapar(entrega ? rotulo(entrega) : o.entrega)}`;
  const melhor = posicao === 0 && conta?.ganho > 0;
  const ruim = conta && conta.ganho <= 0;

  let ganho = `<span class="por-km">Frete ${reais(o.valor)}</span>`;
  let detalhes = "";
  if (conta) {
    const [vazio, carga, volta] = conta.trechos;
    ganho = `<span class="valor">${reais(conta.ganho)}</span><span class="por-km">${reais(conta.porKm)} por km</span>${melhor ? '<span class="selo">Melhor opção</span>' : ""}${ruim ? '<span class="selo prejuizo">Prejuízo</span>' : ""}`;
    const partes = [`${km(vazio.km)} vazio`, `${km(carga.km)} com carga`];
    if (volta) partes.push(`${km(volta.km)} de volta`);
    detalhes = `Frete ${reais(o.valor)} · ${partes.join(" + ")} = ${km(conta.kmTotal)}${conta.estimada ? " (estimado)" : ""} · diesel ${reais(conta.custoDiesel)}${o.outros ? ` · pedágio ${reais(o.outros)}` : ""}`;
  }
  return `
    <li class="oferta${melhor ? " melhor" : ""}${ruim ? " ruim" : ""}">
      <span class="oferta-posicao">${posicao == null ? "·" : posicao + 1}</span>
      <div class="oferta-corpo">
        <div class="oferta-topo">
          <span class="oferta-rota">${rota}</span>
          <button type="button" class="oferta-remover" data-id="${escapar(o.id)}" aria-label="Apagar esta oferta">×</button>
        </div>
        <div class="oferta-ganho">${ganho}</div>
        ${detalhes ? `<div class="oferta-detalhes">${detalhes}</div>` : ""}
        ${o.obs ? `<p class="oferta-obs">${escapar(o.obs)}</p>` : ""}
      </div>
    </li>`;
}

function lerOferta() {
  const f = {
    pega: $("#oferta-pega"),
    entrega: $("#oferta-entrega"),
    valor: $("#oferta-valor"),
    outros: $("#oferta-outros"),
  };
  return validar([
    ["pega", f.pega, () => lerCidade(f.pega, { obrigatoria: true, mensagemVazio: "Informe onde a carga é carregada." })],
    ["entrega", f.entrega, () => lerCidade(f.entrega, { obrigatoria: true, mensagemVazio: "Informe onde a carga é entregue." })],
    ["valor", f.valor, () => lerValor(f.valor, { mensagem: "Informe quanto paga o frete." })],
    ["outros", f.outros, () => lerValor(f.outros, { minimo: -1, obrigatorio: false, mensagem: "Valor inválido. Deixe vazio se não tiver pedágio." })],
  ]);
}

// ===== Abas e instalação =====
function abrirAba(nome) {
  for (const aba of ["calcular", "comparar"]) {
    const ativa = aba === nome;
    $(`#aba-${aba}`).hidden = !ativa;
    $(`#tab-${aba}`).setAttribute("aria-selected", String(ativa));
  }
  window.scrollTo(0, 0);
  if (nome === "comparar") mostrarOfertas();
}

function avisoInstalar() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalado = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  if (!ios || instalado || ler(CHAVES.aviso, false)) return;
  $("#aviso-instalar").hidden = false;
  $("#fechar-aviso").addEventListener("click", () => {
    $("#aviso-instalar").hidden = true;
    guardar(CHAVES.aviso, true);
  });
}

// ===== Início =====
function iniciar() {
  restaurarConfig();

  // Calcular
  ligarCampoCidade(campos.atual, salvarConfig);
  $("#usar-local").addEventListener("click", usarLocalizacao);
  ligarCampoCidade(campos.pega);
  ligarCampoCidade(campos.entrega);
  formatarAoSair(campos.media, fmtMedia);
  for (const input of [campos.diesel, campos.frete, campos.outros]) formatarAoSair(input, fmtDinheiro);
  formatarAoSair(campos.kmManual, fmtInteiro);
  for (const input of [campos.media, campos.diesel, campos.volta]) input.addEventListener("change", salvarConfig);

  $("#form-calcular").addEventListener("submit", (e) => {
    e.preventDefault();
    calcular();
  });
  // Depois da primeira conta, mudar um número refaz a conta sozinho.
  let refazer;
  for (const input of [campos.media, campos.diesel, campos.frete, campos.outros, campos.kmManual, campos.volta]) {
    input.addEventListener(input.type === "checkbox" ? "change" : "input", () => {
      if (!ultimaViagem) return;
      clearTimeout(refazer);
      refazer = setTimeout(calcular, 600);
    });
  }

  // Comparar
  ligarCampoCidade($("#oferta-pega"));
  ligarCampoCidade($("#oferta-entrega"));
  formatarAoSair($("#oferta-valor"), fmtDinheiro);
  formatarAoSair($("#oferta-outros"), fmtDinheiro);
  $("#form-oferta").addEventListener("submit", (e) => {
    e.preventDefault();
    const oferta = lerOferta();
    if (!oferta) return;
    adicionarOferta({ pega: oferta.pega.chave, entrega: oferta.entrega.chave, valor: oferta.valor, outros: oferta.outros, obs: $("#oferta-obs").value.trim() });
    e.currentTarget.reset();
    for (const id of ["#oferta-pega", "#oferta-entrega"]) delete $(id).dataset.chave;
    mostrarOfertas();
  });
  $("#lista-ofertas").addEventListener("click", (e) => {
    const botao = e.target.closest(".oferta-remover");
    if (!botao) return;
    ofertas = ofertas.filter((o) => o.id !== botao.dataset.id);
    guardar(CHAVES.ofertas, ofertas);
    mostrarOfertas();
  });
  document.querySelectorAll(".ordem-botao").forEach((b) =>
    b.addEventListener("click", () => {
      ordem = b.dataset.ordem;
      guardar(CHAVES.ordem, ordem);
      mostrarOfertas();
    })
  );
  const limpar = $("#limpar-ofertas");
  let confirmar;
  limpar.addEventListener("click", () => {
    if (!limpar.classList.contains("confirmar")) {
      limpar.classList.add("confirmar");
      limpar.textContent = "Toque de novo para apagar todas";
      confirmar = setTimeout(() => {
        limpar.classList.remove("confirmar");
        limpar.textContent = "Apagar todas";
      }, 4000);
      return;
    }
    clearTimeout(confirmar);
    limpar.classList.remove("confirmar");
    limpar.textContent = "Apagar todas";
    ofertas = [];
    guardar(CHAVES.ofertas, ofertas);
    mostrarOfertas();
  });

  // Abas e instalação
  $("#tab-calcular").addEventListener("click", () => abrirAba("calcular"));
  $("#tab-comparar").addEventListener("click", () => abrirAba("comparar"));
  avisoInstalar();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
}

iniciar();
