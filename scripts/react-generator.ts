import {readCustomElements} from '../scripts/custom-elements-metadata.ts';
const ts = String.raw;
let intrinsicElementsCode = ts``;
let generateCode = ts``;
const importCodes = new Map([
  //
  ['navigation', `/// <reference types="@types/dom-navigation"/>`],
  ['createComponent', `import { createComponent } from '@lit/react';`],
  ['React', `import * as React from 'react';`],
]);
const buildinTypes = new Set(['string', 'number', 'boolean', 'symbol', 'bigint', 'undefined', 'object', 'function', 'Event', 'ErrorEvent', 'Window', 'HTMLTemplateElement']);

const buildinImportMap = new Map([
  //
  ['Property', 'csstype'],
]);
const isBuildinTypes = (type: string) => {
  return buildinTypes.has(type);
};
const isStringLiteral = (type: string) => /^[\'\"]/.test(type);
const isNumberLiteral = (type: string) => /^\d/.test(type) || /^0[xb]/i.test(type);
const isBooleanLiteral = (type: string) => /^(true|false)/.test(type);
const isObjectLiteral = (type: string) => /^(\{\}|null)/.test(type);
// const isSymbolLiteral = (type: string) => type === 'unique symbol';
const isLiteral = (type: string) => {
  return isBooleanLiteral(type) || isNumberLiteral(type) || isStringLiteral(type) || isObjectLiteral(type);
};

const addImport = (typeOnly: boolean, typeText?: string | null, from = './index') => {
  if (typeText) {
    const types = typeText.split(/[\<,\s\|\&\>\[\]]+/).filter(Boolean);
    for (let _type of types) {
      const type = _type.split('.')[0];
      if (importCodes.has(type)) {
        // skip dupication
        continue;
      }
      /// 内置的 import 规则
      const importFrom = buildinImportMap.get(type);
      if (importFrom) {
        importCodes.set(type, `import ${typeOnly ? 'type' : ''} {${type}} from '${importFrom}';`);
      }

      if (
        _type.includes('.') || // skip namespace
        isBuildinTypes(type) || // skip global type
        isLiteral(type) // skip literal
      ) {
        continue;
      }
      importCodes.set(type, `import ${typeOnly ? 'type' : ''} {${type}} from '${from}';`);
    }
  }
  return typeText;
};

const moduleDeclarations = readCustomElements().modules.map((module) => {
  return {
    module,
    declarations: module.declarations
      .filter((dec) => dec.kind === 'class')
      .filter((dec) => {
        return dec.customElement && module.path.startsWith('src/components/');
      }),
  };
});
moduleDeclarations.forEach(({module, declarations}) => {
  declarations.forEach((dec) => {
    try {
      addImport(false, dec.name, module.path.replace(/^src/, '.').replace(/.ts$/, ''));
      generateCode += ts`
export const ${dec.name.replace(/Element$/, '')} = createComponent({react:React,tagName:'${dec.tagName}',elementClass:${dec.name}, events: {
  ${dec.events?.map((e) => `on${e.name.replace(/-/g, '')}:'${e.name}'`).join(',\n  ') ?? ''}
}});

`;
    } catch (e) {
      console.error(dec, e);
    }
  });
});

moduleDeclarations.forEach(({module, declarations}) => {
  declarations.forEach((dec) => {
    const codes = [
      `React.DetailedHTMLProps<React.HTMLAttributes<${dec.name}>, ${dec.name}>`,
      `{
        ${dec.members
          .filter((p) => p.kind === 'field')
          // 寻找可配置的属性
          .filter((p) => p.privacy !== 'private' && p.privacy !== 'protected' && !p.static && !p.readonly)

          .map((p) => {
            if (!p.type) {
              console.warn('unknown filed type', p);
            }
            const isEvent = p.name.startsWith('on') && p.type?.text.startsWith('PropertyEventListener');
            return `
            /**
             * ${p.description?.split('\n').join('\n* ') ?? p.name}
             * ${p.default != null ? '@default ' + p.default : ''}
             */ 
            ${p.name}?: ${isEvent ? 'string|' : ''}${addImport(true, p.type?.text) ?? 'unknown'}`;
          })
          .join('\n')}
      }`,
      /// 这里 events 相关的都通过 @eventProperty 来提供了
      // dec.events
      //   ? `{
      //     ${dec.events
      //       .map((e) => {
      //         return `
      //       /**
      //        * ${e.description ?? e.name}
      //        */
      //       on${e.name.replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/-[a-z]/g, (c) => c.slice(1).toUpperCase())}: (event: ${addImportType(e.type?.text) ?? 'Event'}) => void`;
      //       })
      //       .join('\n')}
      //    }`
      //   : null,
    ].filter(Boolean);
    intrinsicElementsCode += `'${dec.tagName}': ${codes.join(' & ')};\n`;
  });
});
intrinsicElementsCode = ts`
declare global {
  namespace React.JSX {
    interface IntrinsicElements {
      ${intrinsicElementsCode}
    }
  }
}`;
generateCode = [
  //
  [...importCodes.values()],
  generateCode,
  intrinsicElementsCode,
]
  .flat()
  .join('\n');

import {import_meta_ponyfill} from 'import-meta-ponyfill';
import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';
import prettierconfig from '../.prettierrc.json' with {type: 'json'};
export const doWrite = async (format: boolean) => {
  fs.writeFileSync(
    path.resolve(import.meta.dirname, '../src/react.ts'),
    format
      ? await prettier.format(generateCode, {
          parser: 'typescript',
          ...(prettierconfig as any),
        })
      : generateCode
  );
};

if (import_meta_ponyfill(import.meta).main) {
  await doWrite(false);
}

// fs.writeFileSync;

// import {generateSolidJsTypes} from 'custom-element-solidjs-integration';
// generateSolidJsTypes(customElementsMetadata, {
//   outdir: path.resolve(import.meta.dirname, '../src'),
//   fileName: 'react-types.d.ts',
// });
