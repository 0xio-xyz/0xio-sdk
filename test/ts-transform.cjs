const ts = require('typescript');

module.exports = {
  process(source, fileName) {
    const { outputText } = ts.transpileModule(source, {
      fileName,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    return { code: outputText };
  },
};
