const norm = (p) => p.replace(/\/+/g, '/');
export const join = (...a) => norm(a.filter(Boolean).join('/'));
export const resolve = (...a) => norm(`/${a.filter(Boolean).join('/')}`).replace(/\/[^/]+\/\.\.(?=\/|$)/g, '');
export const dirname = (p) => p.replace(/\/[^/]*$/, '') || '/';
export const basename = (p) => p.replace(/^.*\//, '');
export default { join, resolve, dirname, basename };
