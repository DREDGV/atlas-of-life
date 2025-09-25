module.exports = {
  rules: {
    'import/no-default-export': 'error',
  },
};
module.exports = {
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['import'],
  rules: {
    'import/no-default-export': 'error'
  }
};


