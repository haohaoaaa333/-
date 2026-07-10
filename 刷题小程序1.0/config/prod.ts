// config/prod.ts
import type { UserConfigExport } from '@tarojs/cli';

export default {
  mini: {
    miniCssExtractPluginOption: {
      ignoreOrder: true,
    },
  },
  h5: {},
} satisfies UserConfigExport<'webpack5'>;
