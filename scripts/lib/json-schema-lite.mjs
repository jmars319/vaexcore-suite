export function validateJsonSchema(schema, value, options = {}) {
  const errors = [];
  validateNode(schema, value, options.path ?? "$", errors);
  return errors;
}

function validateNode(schema, value, path, errors) {
  if (!schema || typeof schema !== "object") {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}.`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}.`);
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path} must be ${Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type}.`);
    return;
  }

  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} characters.`);
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      errors.push(`${path} must be a valid date-time string.`);
    }
    if (schema.format === "uri" || schema.format === "uri-reference") {
      try {
        new URL(value);
      } catch {
        errors.push(`${path} must be a valid URL.`);
      }
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}.`);
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} items.`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateNode(schema.items, item, `${path}[${index}]`, errors));
    }
  }

  if (isPlainObject(value)) {
    const required = schema.required ?? [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${path}.${key} is required.`);
      }
    }

    const properties = schema.properties ?? {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateNode(childSchema, value[key], `${path}.${key}`, errors);
      }
    }
  }
}

function matchesType(value, type) {
  if (Array.isArray(type)) {
    return type.some((candidate) => matchesType(value, candidate));
  }
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
