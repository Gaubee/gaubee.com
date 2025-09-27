import * as YAML from "js-yaml";

export const validateField = (value: any): boolean => {
  if (typeof value === "object" && value !== null) {
    return true; // Already a valid object/array
  }
  // For string values, try to parse as JSON or YAML
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return true;
    } catch (jsonError) {
      try {
        YAML.load(value);
        return true;
      } catch (yamlError) {
        return false;
      }
    }
  }
  // For other primitive types, consider them valid
  return true;
};