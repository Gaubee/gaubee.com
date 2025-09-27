export type MetadataFieldType =
  | "text"
  | "date"
  | "datetime"
  | "number"
  | "url"
  | "tel"
  | "color"
  | "object";

export type MetadataFieldSchema = {
  type: MetadataFieldType;
  isArray: boolean;
  order: number;
  description: string;
};

export type EditorMetadata = {
  __editor_metadata?: Record<string, MetadataFieldSchema>;
  [key: string]: any;
};