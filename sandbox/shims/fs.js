// Sistema de arquivos em memória (arquivos de importação enviados durante a sessão de testes).
export const files = new Map();
const fs = {
  mkdirSync() {},
  writeFileSync(path, data) { files.set(path, data); },
  existsSync(path) { return files.has(path); },
  readFileSync(path) { return files.get(path); },
  rm(path, _opts, cb) { files.delete(path); cb?.(); },
  readdirSync() { return []; },
};
export default fs;
export const { mkdirSync, writeFileSync, existsSync, readFileSync, rm, readdirSync } = fs;
