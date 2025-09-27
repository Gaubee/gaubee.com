import { textHandler } from "./renderers/TextRenderer";
import { dateHandler } from "./renderers/DateRenderer";
import { objectHandler } from "./renderers/ObjectRenderer";
import { numberHandler } from "./renderers/NumberRenderer";
import { colorHandler } from "./renderers/ColorRenderer";
import { urlHandler } from "./renderers/UrlRenderer";
import { telHandler } from "./renderers/TelRenderer";
import type { MetadataFieldHandler, MetadataFieldType } from "./types";

const registry = new Map<MetadataFieldType, MetadataFieldHandler<any>>();

// Register all the default handlers
[
  textHandler,
  dateHandler,
  objectHandler,
  numberHandler,
  colorHandler,
  urlHandler,
  telHandler,
].forEach(handler => {
  registry.set(handler.typeName, handler);
});

// TODO: In the future, we can add a function here to allow dynamic registration
// of custom types, for example, from a plugin system.

/**
 * Retrieves the handler for a given metadata field type.
 * If the specific handler is not found, it safely falls back to the 'text' handler.
 * @param type The type of the metadata field.
 * @returns The corresponding MetadataFieldHandler.
 */
export function getFieldHandler(type: MetadataFieldType): MetadataFieldHandler<any> {
  return registry.get(type) || textHandler;
}