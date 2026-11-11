// O arquivo já chega em req.file (montado pelo adaptador de requisições); aplica as mesmas validações.
function multer(opts = {}) {
  return {
    single: () => (req, _res, next) => {
      if (!req.file) return next();
      const max = opts.limits?.fileSize;
      if (max && req.file.size > max) return next(Object.assign(new Error('Arquivo grande demais'), { code: 'LIMIT_FILE_SIZE' }));
      if (opts.fileFilter) return opts.fileFilter(req, req.file, (err, ok) => (err ? next(err) : ok ? next() : next(new Error('Arquivo recusado'))));
      return next();
    },
  };
}
multer.memoryStorage = () => ({});
export default multer;
