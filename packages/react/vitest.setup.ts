// Vitest runs with a NODE_ENV of 'test' by default, which would flip the
// hook + provider into their prod no-op paths. Force 'development' so the
// production-guard branches don't run and hide real bugs.
process.env['NODE_ENV'] = 'development';
