# Conta do Frete

App de celular (PWA) para a transportadora: antes de fechar um frete, mostra quanto sobra depois do diesel, dos 12% do motorista e do pedágio, e compara várias ofertas para apontar a melhor.

## Como funciona

- **Calcular:** cidade onde o caminhão está, onde pega a carga (opcional), destino, média (km/l), preço do diesel e valor do frete. Opcional: pedágio, volta vazio e km total já conhecido.
- **Comparar fretes:** anota as ofertas vistas na Fretebras; cada uma é calculada a partir de onde o caminhão está (km vazio até a carga + km com carga) e a lista é ordenada por maior ganho ou melhor ganho por km.
- **Conta:** `ganho = frete − 12% do frete − (km ÷ média × diesel) − pedágio`. Não inclui manutenção, pneus e seguro.
- **Distância:** pela estrada, no serviço público OSRM (mapa do OpenStreetMap), uma chamada por viagem e no máximo uma por segundo. Sem internet, usa a linha reta × 1,40 (até 800 km) ou × 1,29 (acima), fatores medidos em 60 rotas reais pelo Brasil.
- **Cidades:** os 5.570 municípios do IBGE com coordenadas, em `cidades.js` (fonte: [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros)).
- Tudo fica guardado só no aparelho (`localStorage`); não há servidor nem login.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | As duas telas |
| `estilo.css` | Visual (placa verde de rodovia, modo claro e escuro) |
| `app.js` | Busca de cidades, rotas, a conta e a comparação |
| `cidades.js` | Municípios: `nome|UF|lat|lon|capital` |
| `sw.js` | Guarda o app no aparelho para abrir sem internet |
| `manifest.webmanifest`, `icones/` | Instalação na tela de início |
| `fontes/` | Barlow e Barlow Semi Condensed (licença OFL) |

## Publicar no GitHub Pages

1. Crie o repositório público `calculadora-frete` em [github.com/new](https://github.com/new), sem README.
2. Na página do repositório, clique em **uploading an existing file** (ou **Add file › Upload files**), arraste **o conteúdo desta pasta** (os arquivos e as pastas `fontes` e `icones`, não a pasta inteira) e clique em **Commit changes**.
3. Em **Settings › Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`, e clique em **Save**.
4. Em um ou dois minutos o app fica em `https://matheulb.github.io/calculadora-frete/`.

## Publicar uma mudança

Aumente `VERSAO` em `sw.js` para os celulares baixarem a versão nova (ela aparece na segunda vez que o app abre).

## Instalar no iPhone

Abrir o endereço no **Safari**, tocar em **Compartilhar** e em **Adicionar à Tela de Início**.
