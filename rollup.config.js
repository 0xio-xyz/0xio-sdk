import typescript from '@rollup/plugin-typescript';
import { dts } from 'rollup-plugin-dts';
import replace from '@rollup/plugin-replace';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const external = [];

const plugins = [
  replace({
    'process.env.NODE_ENV': JSON.stringify('production'),
    __SDK_VERSION__: JSON.stringify(pkg.version),
    preventAssignment: true
  }),
  typescript({
    tsconfig: './tsconfig.json',
    declaration: false,
  })
];

export default [
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.esm.js',
      format: 'esm',
      sourcemap: true
    },
    external,
    plugins
  },
  
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'named'
    },
    external,
    plugins
  },
  
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'ZeroXIOWalletSDK',
      sourcemap: true,
      globals: {}
    },
    external,
    plugins
  },
  
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts'
    },
    plugins: [dts()]
  }
];