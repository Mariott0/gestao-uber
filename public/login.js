import './modo-app.js';

const form = document.getElementById('login-form');
const botao = form.querySelector('button[type="submit"]');
const erro = document.getElementById('login-erro');

botao.disabled = false;
form.addEventListener('submit', async evento => {
  evento.preventDefault();
  if (botao.disabled) return;
  botao.disabled = true;
  botao.textContent = 'Entrando…';
  erro.hidden = true;
  let mensagem = 'Não foi possível entrar. Tente novamente.';
  try {
    const dados = Object.fromEntries(new FormData(form));
    const resposta = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
      cache: 'no-store'
    });
    if (resposta.ok) {
      form.reset();
      location.replace('/');
      return;
    }
    if (resposta.status === 401) mensagem = 'Usuário ou senha incorretos.';
    if (resposta.status === 429) mensagem = 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.';
  } catch {
    mensagem = 'Conexão indisponível. Tente novamente.';
  }
  erro.textContent = mensagem;
  erro.hidden = false;
  botao.textContent = 'Entrar';
  botao.disabled = false;
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(console.error);
