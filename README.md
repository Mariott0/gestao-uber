# Gestão Uber

PWA para acompanhar a renda de um motorista de aplicativo. Feita com Node.js, HTML, CSS, JavaScript e SQLite.

- Fechamento diário com estimativa de combustível, reserva do passe, despesas e ganho líquido.
- Abastecimentos e pagamentos do passe no histórico, com metas semanais e mensais.
- Tema automático e layout responsivo para navegador e Tela de Início do iPhone.
- Acesso por uma conta configurada no servidor, com senha armazenada como hash scrypt com salt.

## Rodar

Com [Node.js 24](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) ou superior, execute na pasta do projeto:

```sh
npm install
```

Configure a conta única pelo terminal. O comando abaixo, em Bash, lê a senha sem exibir. Use o mesmo comando para trocar a senha e encerrar as sessões existentes.

```sh
read -rsp 'Senha: ' senha && printf '\n'
printf '%s' "$senha" | node configurar-login.js seu_usuario
unset senha
npm start
```

Abra [http://localhost:3000](http://localhost:3000). Uma nova instalação começa com o histórico vazio em `data/uber.sqlite`. O preço inicial da gasolina é R$ 6,39/L. As metas começam desativadas, com segunda a sexta selecionadas.

## Serviço Linux

Copie o projeto para `/opt/gestao-uber` e instale o serviço abaixo em `/etc/systemd/system/gestao-uber.service`. Crie o usuário de serviço `gestao-uber` e dê a ele permissão de leitura no projeto e de escrita na pasta `data`. Ajuste o caminho de `npm` conforme necessário.

```ini
[Unit]
Description=Gestão Uber
After=network.target

[Service]
User=gestao-uber
WorkingDirectory=/opt/gestao-uber
ExecStart=/usr/bin/npm start
Restart=on-failure
UMask=0077

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now gestao-uber
sudo journalctl -u gestao-uber -n 30
```

## S10 com Termux e Cloudflare Tunnel

No Android com Termux, instale o Node.js 24 ou superior e use [termux-services](https://github.com/termux/termux-services) para supervisionar o processo. Se usar o [Termux:Boot](https://github.com/termux/termux-boot), abra o complemento uma vez e configure-o para iniciar o supervisor após reiniciar o aparelho.

Se a porta 3000 já estiver ocupada, use `PORT=3036 npm start`. No túnel conectado ao S10, crie uma rota para o subdomínio desejado com o serviço HTTP `127.0.0.1:3036` (ou a porta escolhida). O Cloudflare fornece o endereço HTTPS. [Guia do Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/)

## HTTPS com Caddy na VPS Linux

Instale o Caddy, aponte um subdomínio para a VPS e permita acesso ao Caddy nas portas 80 e 443 para a emissão automática do certificado. Acrescente este bloco ao `/etc/caddy/Caddyfile`, substitua o domínio e execute `sudo systemctl reload caddy`. [Guia do Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy)

```caddyfile
uber.seudominio.com.br {
    reverse_proxy 127.0.0.1:3000
}
```

## Acesso pessoal e iPhone

O painel exige a conta configurada no servidor. Use o endereço HTTPS para entrar pelo navegador ou pelo app instalado.

No Safari do iPhone, abra o endereço HTTPS, toque em **Compartilhar → Adicionar à Tela de Início**, ative **Abrir como App da Web** quando essa opção aparecer e toque em **Adicionar**. Os dados e os lançamentos precisam de conexão com a VPS. [Guia do iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)

## Backup

Com o utilitário `sqlite3` instalado, faça uma cópia consistente mesmo com o app rodando. Execute na pasta do projeto e guarde a cópia fora da VPS.

```sh
sqlite3 data/uber.sqlite ".backup 'uber-backup.sqlite'"
```

Para restaurar, pare o serviço, preserve uma cópia do banco atual, coloque o backup em `data/uber.sqlite` com as permissões do usuário de serviço e reinicie o serviço.
