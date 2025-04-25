import type {CustomElementsJson} from '../scripts/custom-elements-metadata';

export interface EleventyData {
  title?: string;
  page: {
    url: string;
    [key: string]: unknown;
  };
  tags?: string | string[];
  scripts?: string[];
  links?: string[];
  content: string;
  collections?: {
    article?: Array<{
      url: string;
      data: EleventyArticleData;
    }>;
    event?: Array<{
      url: string;
      data: EleventyEventData;
    }>;
    [key: string]: unknown;
  };
  description?: string;
  customElements?: CustomElementsJson;
}

type MaybeArray<T> = T | T[];
export interface EleventyArticleData extends EleventyData {
  tags: MaybeArray<'article' | (string & {})>;
  title: string;
  date: Date;
  updated: Date;
}
export interface EleventyEventData extends EleventyData {
  tags: MaybeArray<'event' | (string & {})>;
  name: string;
  date: Date;
}

export type Slots<K extends string> = {[slotName in K]?: string};
