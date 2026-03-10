import typescript from '@rollup/plugin-typescript';
import { dts } from 'rollup-plugin-dts';
import replace from '@rollup/plugin-replace';

const external = [];

const plugins = [
  replace({
    'process.env.NODE_ENV': JSON.stringify('production'),
    preventAssignment: true
  }),
  typescript({
    tsconfig: './tsconfig.json',
    declaration: false, // We'll generate declarations separately
  })
];

export default [
  // ESM build
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
  
  // CommonJS build
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
  
  // UMD build for browsers
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
  
  // Type definitions
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts'
    },
    plugins: [dts()]
  }
];