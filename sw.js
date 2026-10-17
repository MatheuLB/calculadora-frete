// Guarda o app no aparelho para abrir mesmo sem internet.
// Ao publicar mudanças, aumente VERSAO para os celulares baixarem a nova.
const VERSAO = "conta-do-frete-v1";
const ARQUIVOS = [
  "./",
  "index.html",
  "estilo.css",
  "app.js",
  "cidades.js",
  "manifest.webmanifest",
  "icones/apple-touch-icon.png",
  "icones/icone-192.png",
  "icones/icone-512.png",
  "fontes/barlow-400.woff2",
  "fontes/barlow-500.woff2",
  "fontes/barlow-600.woff2",
  "fontes/barlow-semi-condensed-600.woff2",
  "fontes/barlow-semi-condensed-700.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((cache) => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Arquivos do app: abre na hora com a cópia guardada (sinal ruim na estrada)
// e atualiza a cópia por trás; a versão nova aparece na próxima vez que abrir.
// O serviço de rotas fica de fora: sem internet o app estima a distância sozinho.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSAO).then(async (cache) => {
      const guardada = await cache.match(e.request, { ignoreSearch: true });
      const daRede = fetch(e.request)
        .then((resposta) => {
          if (resposta.ok) cache.put(e.request, resposta.clone());
          return resposta;
        })
        .catch(() => guardada || cache.match("index.html"));
      if (guardada) {
        e.waitUntil(daRede);
        return guardada;
      }
      return daRede;
    })
  );
});
