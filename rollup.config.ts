/**
 * @license
 * Copyright 2025 Gaubee
 * License: MIT
 */
import 'tsx';

import {iter_map_not_null} from '@gaubee/util';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import {bold, gray, green, yellow} from '@std/fmt/colors';
import fs from 'node:fs';
import path from 'node:path';
import {defineConfig} from 'rollup';
import {minifyTemplateLiterals} from 'rollup-plugin-minify-template-literals';
import summary from 'rollup-plugin-summary';
import {match, P} from 'ts-pattern';

// 这里利用tsx来加载ts文件，但是需要用 await import来让 commonjs 支持 esm 的导入
const {getComponentsEntry} = await import('./scripts/custom-elements-metadata.ts');

const inputFiles = getComponentsEntry().map((entry) => entry.dist);
export default defineConfig((env) => {
  return {
    input: ['./dist/index.js', './dist/react.js', ...inputFiles],
    output: {
      dir: 'bundle',
      format: 'esm',
    },
    onwarn(warning) {
      warning.plugin;
      const canLog = match(warning)
        .with(
          // ignores
          {code: 'THIS_IS_UNDEFINED'},
          {
            code: 'CIRCULAR_DEPENDENCY',
            ids: [P.string.includes('/node_modules/culori/'), ...P.array()],
          },
          () => false
        )
        .otherwise(() => true);
      if (canLog) {
        console.warn(yellow(`${bold('(!)')} ${gray(iter_map_not_null([warning.code, warning.plugin]).join(' '))} ${warning.message}`));
      }
    },
    plugins: [
      {
        name: 'empty-output-dir',
        buildStart(options) {
          fs.rmSync(path.resolve(import.meta.dirname, './bundle'), {
            recursive: true,
            force: true,
          });
        },
      },
      replace({preventAssignment: false, 'Reflect.decorate': 'undefined'}),
      resolve(),
      // /**
      //  * This minification setup serves the static site generation.
      //  * For bundling and minification, check the README.md file.
      //  */
      // terser({
      //   // ecma: 2020,
      //   module: true,
      //   compress: false,
      //   mangle: {
      //     properties: {
      //       regex: /^__/,
      //     },
      //   },
      // }),
      minifyTemplateLiterals({}),
      summary(),
      {
        name: 'generate-react-types',
        async buildEnd(error) {
          const {doWrite} = await import('./scripts/react-generator');
          doWrite(true);
          console.log(green('./src/react.ts generated!!'));
        },
      },
    ],
  };
});
