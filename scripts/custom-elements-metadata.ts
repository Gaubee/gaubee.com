export interface CustomElementsJson {
  modules: CustomElementsJson.Module[];
}
export namespace CustomElementsJson {
  /**
   * TypeScript type definitions for custom elements metadata
   */

  export interface TypeInfo {
    text: string;
  }

  export interface Parameter {
    name: string;
    description?: string;
    type: TypeInfo;
  }

  export interface Method {
    kind: 'method';
    name: string;
    description?: string;
    privacy?: 'private' | 'protected' | 'public';
    static?: boolean;
    parameters: Parameter[];
    return?: {
      type: TypeInfo;
    };
  }

  export interface Field {
    kind: 'field';
    name: string;
    attribute?: string;
    description?: string;
    type?: TypeInfo;
    default?: string;
    privacy?: 'private' | 'protected';
    static?: boolean;
    readonly?: boolean;
  }

  export interface Attribute {
    name: string;
    description?: string;
    type: TypeInfo;
    default?: string;
  }

  export interface Event {
    name: string;
    description?: string;
    type?: {text: string};
  }

  export interface Slot {
    name: string;
    description?: string;
  }

  export interface CssPart {
    name: string;
    description?: string;
  }

  export interface CssProperty {
    name: string;
    description?: string;
  }

  export interface ClassDeclaration {
    kind: 'class';
    name: string;
    tagName: string;
    description?: string;
    attributes?: Attribute[];
    members: (Method | Field)[];
    events?: Event[];
    slots?: Slot[];
    cssParts?: CssPart[];
    cssProperties?: CssProperty[];
    customElement?: boolean;
    superclass?: {
      name: string;
      package?: string;
    };
  }
  export interface VariableDeclaration {
    kind: 'variable';
    name: string;
  }
  export type Declaration = ClassDeclaration | VariableDeclaration;

  export interface Module {
    kind: 'javascript-module';
    path: string;
    declarations: Declaration[];
  }
}

import fs from 'node:fs';
import path from 'node:path';
export const readCustomElements = () => {
  const customElementsMetadata = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../custom-elements.json'), 'utf-8')) as CustomElementsJson;
  return customElementsMetadata;
};
// Export a type-safe customElements object
export const customElementsMetadata = readCustomElements();

export const customElementDeclarations = customElementsMetadata.modules
  .filter((m) => m.path.startsWith('src/components/'))
  .map((m) => m.declarations)
  .flat()
  .filter((d) => d.kind === 'class' && d.customElement) as CustomElementsJson.ClassDeclaration[];

console.log(
  'all customElement tagsName',
  customElementDeclarations.map((d) => d.tagName)
);

export const getComponentsEntry = () => {
  const componentsDir = path.resolve(import.meta.dirname, '../src/components/');
  const distDir = path.resolve(import.meta.dirname, '../dist/');

  const inputFiles = fs
    .readdirSync(componentsDir)
    .map((comName) => {
      return {
        componentName: comName,
        bundle: `/bundle/${comName}.js`,
        src: path.join(componentsDir, comName, comName + '.ts'),
        dist: path.join(distDir, 'components', comName, comName + '.js'),
      };
    })
    .filter((entry) => {
      return fs.existsSync(entry.src);
    });
  return inputFiles;
};
