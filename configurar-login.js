import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { caminhoBanco, credenciaisValidas, hashSenha, prepararAuth } from './auth.js';

const usuario = process.argv[2];
const senha = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (!credenciaisValidas(usuario, senha) || senha.length < 12) {
  console.error('Informe o usuário no argumento e uma senha de pelo menos 12 caracteres pela entrada padrão.');
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
const hash = (await hashSenha(senha, salt)).toString('hex');
mkdirSync(dirname(caminhoBanco), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(caminhoBanco);
db.exec('PRAGMA busy_timeout = 5000');
prepararAuth(db);
db.exec('BEGIN IMMEDIATE');
try {
  db.prepare(`INSERT INTO usuario_uber (id, nome, salt, senha_hash) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, salt=excluded.salt, senha_hash=excluded.senha_hash`)
    .run(usuario, salt, hash);
  db.exec('DELETE FROM sessoes_uber; DELETE FROM tentativas_uber; COMMIT');
} catch (erro) {
  db.exec('ROLLBACK');
  throw erro;
} finally {
  db.close();
}
console.log('Login configurado.');
