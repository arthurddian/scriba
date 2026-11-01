# Scriba — como colocar no ar

Site 100% estático (sem servidor, sem banco de dados). Tudo fica no navegador de quem usa.

## Arquivos (todos juntos, na mesma pasta)
index.html · style.css · script.js · i18n.js · boot.js · sw.js · manifest.webmanifest · _headers · pasta icons/

## Testar no seu computador
- Abrir o `index.html` com duplo clique já funciona (sem modo offline/instalação — isso exige https).
- Para testar como PWA: na pasta, rode `python3 -m http.server 8000` e abra http://localhost:8000

## Publicar (Netlify — o caminho mais simples)
1. Crie uma conta grátis em https://app.netlify.com (necessária para o site não expirar).
2. Em "Add new site" → "Deploy manually", arraste a PASTA `scriba` (não o .zip) para a área indicada.
3. Em ~30 segundos você recebe um endereço `https://nome-aleatorio.netlify.app`. Em "Site configuration → Change site name" escolha um nome melhor.
4. Para atualizar: arraste a pasta de novo em "Deploys".

## Alternativa: Cloudflare Pages
Workers & Pages → Create → Pages → "Upload assets" → envie a pasta. Também lê o arquivo `_headers`.

## Instalar como app
- Android/Chrome/Edge (computador): botão "Instalar app" no rodapé do site ou ícone de instalar na barra de endereço.
- iPhone/iPad (Safari): Compartilhar → "Adicionar à Tela de Início".

## Arquivo `_headers`
Não precisa editar nem criar: já vem pronto. Só mantenha o nome exato (com underline, sem extensão) na pasta publicada.
Ele ativa as proteções do servidor (CSP completa, anti-framing, HTTPS forçado). Funciona no Netlify e Cloudflare Pages; o GitHub Pages ignora.

## Depois de publicado
- Teste: abra o site, ative o modo avião e recarregue — deve continuar funcionando.
- Verificação de segurança: https://securityheaders.com (cole o endereço do site).
- Privacidade: os dados ficam só no navegador de cada pessoa. Faça backup pela aba Dados.
