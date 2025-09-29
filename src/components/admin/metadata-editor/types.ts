import type { ChangeEvent } from "react";

export type MetadataFieldType =
  | "text"
  | "date"
  | "datetime"
  | "number"
  | "url"
  | "tel"
  | "color"
  | "object";
  // TODO: Add 'enum-select' type for future enhancement.
  // This would allow selecting from a predefined list of options,
  // which could be configured globally or per-field via the schema.

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

// --- Core Renderer & Handler Interfaces ---

export interface RenderProps {
  id: string;
  name: string;
  value: string;
  className: string;
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
}

export interface MetadataFieldHandler<T = any> {
  typeName: MetadataFieldType;
  verify: (value: any) => boolean;
  format: (value: T) => T;
  render: (props: RenderProps) => React.ReactNode;
}