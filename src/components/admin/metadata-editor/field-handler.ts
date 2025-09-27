import type { MetadataFieldHandler, MetadataFieldType } from "./types";
import { dateHandler, datetimeHandler } from "./renderers/DateRenderer";
import { objectHandler } from "./renderers/ObjectRenderer";
import { textHandler } from "./renderers/TextRenderer";
import { colorHandler } from "./renderers/ColorRenderer";
import { numberHandler } from "./renderers/NumberRenderer";
import { telHandler } from "./renderers/TelRenderer";
import { urlHandler } from "./renderers/UrlRenderer";

// TODO: 未来支持 enum-select
// import { enumHandler } from "./renderers/EnumRenderer";

export const fieldHandlers: Record<MetadataFieldType, MetadataFieldHandler<any>> = {
  text: textHandler,
  date: dateHandler,
  datetime: datetimeHandler,
  number: numberHandler,
  object: objectHandler,
  color: colorHandler,
  tel: telHandler,
  url: urlHandler,
};

export const getFieldHandler = (type: MetadataFieldType) => {
  return fieldHandlers[type] || textHandler; // Fallback to textHandler
};