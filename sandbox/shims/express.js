// Roteador compatível com o subconjunto do Express usado pelas rotas do servidor,
// para executar as mesmas rotas dentro do navegador na versão de testes.

function compile(path) {
  if (!path || path === '/') return { re: /^\/?/, keys: [], prefix: true, root: true };
  const keys = [];
  const src = path.replace(/\/$/, '').replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { re: new RegExp(`^${src}`), keys };
}

function matchLayer(layer, path) {
  const m = layer.match.re.exec(path);
  if (!m) return null;
  const rest = path.slice(m[0].length);
  if (layer.method) {
    // rota final: precisa casar o caminho inteiro
    if (rest !== '' && rest !== '/') return null;
  } else if (!layer.match.root && rest !== '' && !rest.startsWith('/')) return null;
  const params = {};
  layer.match.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  return { params, rest: rest || '/' };
}

export function Router() {
  const layers = [];
  const router = (req, res, next) => router.handle(req, res, next);
  router.isRouter = true;
  router.use = (...args) => {
    const path = typeof args[0] === 'string' ? args.shift() : '/';
    for (const fn of args) layers.push({ match: compile(path), fn, method: null });
    return router;
  };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    router[method] = (path, ...fns) => {
      for (const fn of fns) layers.push({ match: compile(path), fn, method: method.toUpperCase() });
      return router;
    };
  }
  router.handle = (req, res, done) => {
    let i = 0;
    const basePath = req.path;
    const baseParams = req.params;
    const next = (err) => {
      req.path = basePath;
      req.params = baseParams;
      while (i < layers.length) {
        const layer = layers[i++];
        if (layer.method && layer.method !== req.method) continue;
        const m = matchLayer(layer, basePath);
        if (!m) continue;
        const isErrorHandler = layer.fn.length === 4;
        if (err && !isErrorHandler) continue;
        if (!err && isErrorHandler) continue;
        req.params = { ...baseParams, ...m.params };
        if (!layer.method) req.path = m.rest;
        try {
          const out = err ? layer.fn(err, req, res, next) : layer.fn(req, res, next);
          if (out && typeof out.catch === 'function') out.catch(next);
        } catch (e) { next(e); }
        return;
      }
      done(err);
    };
    next();
  };
  return router;
}

function express() { return Router(); }
express.Router = Router;
express.json = () => (_req, _res, next) => next();
export default express;
