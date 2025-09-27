import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { MetadataEditorProps } from "./MetadataEditor";
import { getFieldHandler } from "./field-handler";
import type { MetadataFieldSchema, RenderProps } from "./types";

export const MemoizedInput = memo(function MemoizedInput({
  id,
  paths,
  value,
  className,
  onFocus,
  onBlur,
  onValueChange,
  schema,
}: RenderProps & { schema: MetadataFieldSchema }) {
  const { render } = getFieldHandler(schema.type);
  return render({
    id,
    paths,
    value,
    className,
    onFocus,
    onBlur,
    onValueChange,
  });
});

export interface MetadataInputProps extends MetadataEditorProps {
  paths: string[];
  schema: MetadataFieldSchema;
}
export const MetadataInput = ({
  paths,
  schema,
  metadata,
  setMetadata,
}: MetadataInputProps) => {
  const id = `meta-${paths.join("-")}`;

  const handler = useMemo(() => getFieldHandler(schema.type), [schema.type]);
  const value = useMemo(
    () => paths.reduce((obj, key) => obj?.[key], metadata),
    [metadata, paths],
  );

  const [isValid, setIsValid] = useState(true);
  useEffect(() => {
    setIsValid(handler.verify(value));
  }, [handler, value]);
  const setValue = useCallback(
    (newValue: any) => {
      setMetadata((metadata) => {
        if (paths.length === 1) {
          metadata[paths[0]] = newValue;
        } else {
          const lastKey = paths[paths.length - 1];
          let parent = metadata;
          for (const key of paths.slice(0, -1)) {
            parent = parent[key];
          }

          parent[lastKey] = newValue;
        }

        return { ...metadata };
      });
    },
    [paths],
  );

  const [isFocused, setIsFocused] = useState(false);

  const validationClass = !isValid
    ? isFocused
      ? "border-yellow-400"
      : "border-red-500"
    : "";
  return (
    <MemoizedInput
      id={id}
      paths={paths}
      value={String(value)}
      className={validationClass}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onValueChange={setValue}
      schema={schema}
    />
  );
};
