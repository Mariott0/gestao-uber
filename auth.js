import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const caminhoBanco = resolve(process.env.DB_PATH || fileURLToPath(new URL('./data/uber.sqlite', import.meta.url)));
const derivar = promisify(scrypt);
const duracaoSessao = 7 * 24 * 60 * 60;
const janela = 10 * 60 * 1000;
const cookieSeguro = '__Host-uber_sessao';
const cookieLocal = 'uber_sessao_local';

export function prepararAuth(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuario_uber (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      nome TEXT NOT NULL,
      salt TEXT NOT NULL,
      senha_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessoes_uber (
      token_hash TEXT PRIMARY KEY NOT NULL,
      expira INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tentativas_uber (
      chave TEXT PRIMARY KEY NOT NULL,
      total INTEGER NOT NULL,
      expira INTEGER NOT NULL
    );
  `);
}

export function hashSenha(senha, salt) {
  return derivar(senha, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 3, maxmem: 40 * 1024 ** 2 });
}

export function credenciaisValidas(usuario, senha) {
  return typeof usuario === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(usuario)
    && typeof senha === 'string' && senha.length > 0 && Buffer.byteLength(senha) <= 256;
}

export function transporte(req) {
  const host = req.headers.host;
  const endereco = host?.match(/^(?:[\da-z.-]+|\[::1\])(?::(\d+))?$/i);
  if (!endereco || Number(endereco[1]) > 65535) return null;
  const tunnel = typeof req.headers['cf-ray'] === 'string';
  const local = !tunnel && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  const origem = new URL(`${local ? 'http' : 'https'}://${host}`).origin;
  return {
    origem, local, cookie: local ? cookieLocal : cookieSeguro,
    redirecionar: !local && req.headers['x-forwarded-proto'] === 'http',
    ip: tunnel && isIP(req.headers['cf-connecting-ip'] || '') ? req.headers['cf-connecting-ip'] : req.socket.remoteAddress
  };
}

const tokenHash = token => createHash('sha256').update(token).digest('hex');

export function lerSessao(db, req, canal) {
  const match = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${canal.cookie}=([a-f0-9]{64})(?:;|$)`));
  if (!match) return null;
  const hash = tokenHash(match[1]);
  return db.prepare('SELECT token_hash FROM sessoes_uber WHERE token_hash = ? AND expira > ?')
    .get(hash, Date.now())?.token_hash ?? null;
}

export function definirCookie(res, canal, token = '') {
  const maxAge = token ? duracaoSessao : 0;
  res.setHeader('Set-Cookie', `${canal.cookie}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${canal.local ? '' : '; Secure'}`);
}

const saltFicticio = randomBytes(16).toString('hex');
let validando = 0;

export async function entrar(db, { usuario, senha }, ip, sessao) {
  if (!credenciaisValidas(usuario, senha)) return { status: 401 };
  const agora = Date.now();
  const chaveIp = `ip:${ip}`;
  db.prepare('DELETE FROM tentativas_uber WHERE expira <= ?').run(agora);
  const obter = db.prepare('SELECT total, expira FROM tentativas_uber WHERE chave=?');
  const ipAtual = obter.get(chaveIp);
  const global = obter.get('global');
  const bloqueio = Math.max(ipAtual?.total >= 8 ? ipAtual.expira : 0, global?.total >= 30 ? global.expira : 0);
  if (bloqueio || validando >= 2) return { status: 429, aguardar: bloqueio ? Math.ceil((bloqueio - agora) / 1000) : 2 };
  const incrementar = db.prepare(`INSERT INTO tentativas_uber VALUES (?, 1, ?)
    ON CONFLICT(chave) DO UPDATE SET total = total + 1`);
  incrementar.run(chaveIp, agora + janela);
  incrementar.run('global', agora + janela);

  const conta = db.prepare('SELECT salt, senha_hash FROM usuario_uber WHERE nome=?').get(usuario);
  validando++;
  let hash;
  try {
    hash = await hashSenha(senha, conta?.salt ?? saltFicticio);
  } finally {
    validando--;
  }
  if (!conta || !timingSafeEqual(hash, Buffer.from(conta.senha_hash, 'hex'))) return { status: 401 };
  const token = randomBytes(32).toString('hex');
  // Uma troca de senha enquanto o hash era calculado invalida esta tentativa.
  const criada = db.prepare(`INSERT INTO sessoes_uber
    SELECT ?, ? FROM usuario_uber WHERE nome=? AND senha_hash=?`)
    .run(tokenHash(token), Date.now() + duracaoSessao * 1000, usuario, conta.senha_hash);
  if (!criada.changes) return { status: 401 };
  db.prepare('DELETE FROM sessoes_uber WHERE expira <= ? OR token_hash = ?').run(Date.now(), sessao);
  db.prepare("DELETE FROM tentativas_uber WHERE chave = ? OR chave = 'global'").run(chaveIp);
  return { status: 200, token };
}
