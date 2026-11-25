import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { fechamento, centavos, numero, hojeSP, metas, FAIXA } from './public/calculos.js';
import { caminhoBanco, prepararAuth, transporte, lerSessao, definirCookie, entrar } from './auth.js';

mkdirSync(dirname(caminhoBanco), { recursive: true });
const db = new DatabaseSync(caminhoBanco);
db.exec(`
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS configuracao (
    id INTEGER PRIMARY KEY CHECK (id = 1), preco REAL, semanal INTEGER, mensal INTEGER, dias TEXT
  );
  CREATE TABLE IF NOT EXISTS fechamentos (
    id INTEGER PRIMARY KEY, data TEXT UNIQUE, faturamento INTEGER, km REAL, consumo REAL,
    unidade TEXT, preco REAL, despesas INTEGER, observacao TEXT, litros REAL,
    gasolina INTEGER, reserva INTEGER, liquido INTEGER, passe INTEGER, faixa INTEGER
  );
  CREATE TABLE IF NOT EXISTS pagamentos (id INTEGER PRIMARY KEY, data TEXT, valor INTEGER);
  CREATE TABLE IF NOT EXISTS abastecimentos (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    valor INTEGER NOT NULL CHECK (valor > 0),
    litros REAL CHECK (litros > 0)
  );
`);
prepararAuth(db);

const inserir = db.prepare(`INSERT INTO fechamentos
  (data, faturamento, km, consumo, unidade, preco, despesas, observacao, litros, gasolina, reserva, liquido, passe, faixa)
  VALUES (:data, :faturamento, :km, :consumo, :unidade, :preco, :despesas, :observacao, :litros, :gasolina, :reserva, :liquido, :passe, :faixa)`);
const editar = db.prepare(`UPDATE fechamentos SET data=:data, faturamento=:faturamento, km=:km,
  consumo=:consumo, unidade=:unidade, preco=:preco, despesas=:despesas, observacao=:observacao,
  litros=:litros, gasolina=:gasolina, reserva=:reserva, liquido=:liquido, passe=:passe, faixa=:faixa WHERE id=:id`);

db.prepare("INSERT OR IGNORE INTO configuracao VALUES (1, 6.39, 0, 0, '[1,2,3,4,5]')").run();

class EntradaInvalida extends Error {}

function validar(fn) {
  try { return fn(); } catch (erro) { throw new EntradaInvalida(erro.message); }
}

function dataValida(data, hoje) {
  const instante = new Date(data + 'T00:00:00Z');
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)
    || !Number.isFinite(instante.getTime()) || instante.toISOString().slice(0, 10) !== data || data > hoje) {
    throw new EntradaInvalida('Informe uma data válida até hoje.');
  }
  return data;
}

async function corpo(req) {
  if (req.headers['content-type'] !== 'application/json') throw new EntradaInvalida('Envie dados em JSON.');
  let tamanho = 0;
  const partes = [];
  for await (const parte of req) {
    tamanho += parte.length;
    if (tamanho <= 16384) partes.push(parte);
  }
  if (tamanho > 16384) throw new EntradaInvalida('Os dados excedem o tamanho permitido.');
  return validar(() => {
    let dados;
    try { dados = JSON.parse(Buffer.concat(partes).toString()); } catch { throw new Error('JSON inválido.'); }
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new Error('Dados inválidos.');
    return dados;
  });
}

function painel(hoje) {
  const dias = db.prepare('SELECT * FROM fechamentos ORDER BY data DESC').all();
  const pagamentos = db.prepare('SELECT * FROM pagamentos ORDER BY data DESC, id DESC').all();
  const abastecimentos = db.prepare('SELECT * FROM abastecimentos ORDER BY data DESC, id DESC').all();
  const { preco, semanal, mensal, dias: planejados } = db.prepare('SELECT * FROM configuracao WHERE id=1').get();
  const config = { preco, semanal, mensal, dias: JSON.parse(planejados) };
  const totais = dias.reduce((total, dia) => ({
    faturamento: total.faturamento + dia.faturamento, liquido: total.liquido + dia.liquido
  }), { faturamento: 0, liquido: 0 });
  const abastecido = abastecimentos.reduce((total, registro) => total + registro.valor, 0);
  return { dias, pagamentos, abastecimentos, config, totais: { ...totais, abastecido }, hoje, metas: metas(dias, config, hoje),
    progresso: totais.faturamento % FAIXA, faixas: Math.floor(totais.faturamento / FAIXA) };
}

const arquivos = new Map([
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/login.js', ['login.js', 'text/javascript; charset=utf-8']],
  ['/modo-app.js', ['modo-app.js', 'text/javascript; charset=utf-8']],
  ['/calculos.js', ['calculos.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ...[180, 192, 512].map(tamanho => [`/icon-${tamanho}.png`, [`icon-${tamanho}.png`, 'image/png']])
]);

createServer(async (req, res) => {
  const caminho = req.url.split('?')[0];
  const metodo = req.method;
  const json = (status, dados) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(dados));
  };
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const canal = transporte(req);
    if (!canal) return json(400, { erro: 'Endereço inválido.' });
    const redirecionar = (status, destino) => {
      res.writeHead(status, { Location: destino, 'Cache-Control': 'no-store' });
      res.end();
    };
    if (canal.redirecionar) {
      if (!['GET', 'HEAD'].includes(metodo)) return json(403, { erro: 'Use o endereço HTTPS.' });
      return redirecionar(308, canal.origem + caminho);
    }
    const leitura = metodo === 'GET' || metodo === 'HEAD';
    if (leitura && caminho === '/health') return json(200, { ok: true });
    const estatico = arquivos.get(caminho);
    if (estatico && leitura) {
      const [nome, tipo] = estatico;
      const bytes = await readFile(new URL(`./public/${nome}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-cache' });
      return res.end(metodo === 'HEAD' ? undefined : bytes);
    }
    const sessao = lerSessao(db, req, canal);
    if (leitura && (caminho === '/' || caminho === '/login')) {
      if (!sessao && caminho === '/') return redirecionar(302, '/login');
      if (sessao && caminho === '/login') return redirecionar(302, '/');
      const nome = sessao ? 'index.html' : 'login.html';
      const bytes = await readFile(new URL(`./public/${nome}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(metodo === 'HEAD' ? undefined : bytes);
    }
    if (caminho.startsWith('/api/')) {
      if (metodo === 'POST' && caminho === '/api/login') {
        if (req.headers.origin !== canal.origem) return json(403, { erro: 'Origem inválida.' });
        const resultado = await entrar(db, await corpo(req), canal.ip, sessao);
        if (resultado.status === 429) {
          res.setHeader('Retry-After', resultado.aguardar);
          return json(429, { erro: 'Muitas tentativas. Tente novamente mais tarde.' });
        }
        if (resultado.status === 401) return json(401, { erro: 'Usuário ou senha incorretos.' });
        definirCookie(res, canal, resultado.token);
        return json(200, { ok: true });
      }
      if (!sessao) return json(401, { erro: 'Entre para acessar o painel.' });
      if (!leitura && req.headers.origin !== canal.origem) return json(403, { erro: 'Origem inválida.' });
      if (metodo === 'POST' && caminho === '/api/logout') {
        db.prepare('DELETE FROM sessoes_uber WHERE token_hash=?').run(sessao);
        definirCookie(res, canal);
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        return res.end();
      }
    }
    const hoje = hojeSP();
    if (metodo === 'GET' && caminho === '/api/painel') return json(200, painel(hoje));
    const id = caminho.match(/^\/api\/dias\/([1-9]\d*)$/)?.[1];
    if ((metodo === 'POST' && caminho === '/api/dias') || (metodo === 'PUT' && id)) {
      const dados = await corpo(req);
      const data = dataValida(dados.data, hoje);
      const observacao = String(dados.observacao ?? '').trim();
      if (observacao.length > 1000) throw new EntradaInvalida('Use até 1.000 caracteres nas observações.');
      const anterior = id && db.prepare('SELECT passe, faixa FROM fechamentos WHERE id=?').get(id);
      if (id && !anterior) return json(404, { erro: 'Fechamento não encontrado.' });
      const duplicado = db.prepare('SELECT id FROM fechamentos WHERE data=?').get(data);
      if (duplicado && String(duplicado.id) !== id) return json(409, { erro: 'Já existe um fechamento nessa data.' });
      const registro = { data, observacao, ...validar(() => fechamento(dados, anterior?.passe, anterior?.faixa)) };
      if (id) editar.run({ ...registro, id });
      else inserir.run(registro);
      return json(id ? 200 : 201, painel(hoje));
    }
    if (metodo === 'POST' && caminho === '/api/pagamentos') {
      const dados = await corpo(req);
      const data = dataValida(dados.data, hoje);
      const valor = validar(() => centavos(numero(dados.valor, 'o pagamento', 2)));
      if (valor <= 0) throw new EntradaInvalida('O pagamento precisa ser maior que zero.');
      db.prepare('INSERT INTO pagamentos (data, valor) VALUES (?, ?)').run(data, valor);
      return json(201, painel(hoje));
    }
    const idAbastecimento = caminho.match(/^\/api\/abastecimentos\/([1-9]\d*)$/)?.[1];
    if ((metodo === 'POST' && caminho === '/api/abastecimentos') || (metodo === 'PUT' && idAbastecimento)) {
      const dados = await corpo(req);
      const data = dataValida(dados.data, hoje);
      const valor = validar(() => centavos(numero(dados.valor, 'o valor abastecido', 2)));
      const volume = String(dados.litros ?? '').trim();
      const litros = volume === '' ? null : validar(() => numero(volume, 'os litros abastecidos', 3));
      if (valor <= 0) throw new EntradaInvalida('O valor abastecido precisa ser maior que zero.');
      if (litros === 0) throw new EntradaInvalida('Informe um volume maior que zero ou deixe os litros em branco.');
      if (idAbastecimento) {
        const resultado = db.prepare('UPDATE abastecimentos SET data=?, valor=?, litros=? WHERE id=?')
          .run(data, valor, litros, idAbastecimento);
        if (!resultado.changes) return json(404, { erro: 'Abastecimento não encontrado.' });
      } else {
        db.prepare('INSERT INTO abastecimentos (data, valor, litros) VALUES (?, ?, ?)').run(data, valor, litros);
      }
      return json(idAbastecimento ? 200 : 201, painel(hoje));
    }
    if (metodo === 'PUT' && caminho === '/api/config') {
      const dados = await corpo(req);
      const { preco, semanal, mensal } = validar(() => ({
        preco: numero(dados.preco, 'o preço da gasolina'),
        semanal: centavos(numero(dados.semanal, 'a meta semanal', 2)),
        mensal: centavos(numero(dados.mensal, 'a meta mensal', 2))
      }));
      if (!Array.isArray(dados.dias) || dados.dias.some(dia => !Number.isInteger(dia) || dia < 0 || dia > 6)) {
        throw new EntradaInvalida('Selecione dias da semana válidos.');
      }
      db.prepare('UPDATE configuracao SET preco=?, semanal=?, mensal=?, dias=? WHERE id=1')
        .run(preco, semanal, mensal, JSON.stringify([...new Set(dados.dias)]));
      return json(200, painel(hoje));
    }
    json(404, { erro: 'Página não encontrada.' });
  } catch (erro) {
    if (erro instanceof EntradaInvalida) return json(400, { erro: erro.message });
    console.error(erro);
    json(500, { erro: 'Ocorreu um erro ao acessar os dados.' });
  }
}).listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', function () {
  console.log(`Gestão Uber em http://${this.address().address}:${this.address().port}`);
});
