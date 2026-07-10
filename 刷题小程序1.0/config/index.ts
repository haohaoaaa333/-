// config/index.ts
import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import path from 'path';

const config: UserConfigExport<'webpack5'> = {
  projectName: 'examprep-miniprogram',
  date: '2026-7-2',
  designWidth: 375,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
    375: 2 / 1,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [
    '@tarojs/plugin-platform-weapp',
    '@tarojs/plugin-platform-h5',
  ],
  defineConstants: {},
  copy: {
    patterns: [
      {
        from: path.resolve(__dirname, '..', 'assets', 'tabbar'),
        to: path.resolve(__dirname, '..', 'dist', 'assets', 'tabbar'),
      },
    ],
    options: {},
  },
  framework: 'react',
  compiler: 'webpack5',
  cache: {
    enable: false,
  },
  mini: {
    enableSourceMap: false,
    optimizeMainPackage: {
      enable: true,
    },
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
    webpackChain(chain) {
      chain.resolve.alias.set('@', path.resolve(__dirname, '..', 'src'));
      if (process.env.NODE_ENV === 'production') {
        chain.optimization.minimize(true);
      }
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
    },
  },
};

export default defineConfig<'webpack5'>(config);
