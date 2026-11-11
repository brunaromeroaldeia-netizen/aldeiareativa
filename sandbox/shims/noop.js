// Módulos de servidor sem uso na versão de testes (e-mail, limite de requisições, processos, variáveis de ambiente).
const passthrough = () => (_req, _res, next) => next();
export default passthrough;
export const createTransport = () => ({ sendMail: async () => {} });
export const spawn = () => { throw new Error('Indisponível na versão de testes.'); };
export const spawnSync = spawn;
