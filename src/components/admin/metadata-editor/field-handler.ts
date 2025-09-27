import { colorHandler } from "./inputs/ColorInput";
import { dateHandler, datetimeHandler } from "./inputs/DateInput";
import { numberHandler } from "./inputs/NumberInput";
import { objectHandler } from "./inputs/ObjectInput";
import { telHandler } from "./inputs/Telnput";
import { textHandler } from "./inputs/TextInput";
import { urlHandler } from "./inputs/UrlInput";
import type { MetadataFieldHandler, MetadataFieldType } from "./types";

// TODO: 未来支持 enum-select
// import { enumHandler } from "./renderers/EnumRenderer";

export const fieldHandlers: Record<
  MetadataFieldType,
  MetadataFieldHandler<any>
> = {
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
