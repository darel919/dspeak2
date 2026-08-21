export type ExternalRecord = {
  readonly [key: string]: unknown;
};

export type ExternalValue =
  string | number | boolean | null | ExternalRecord | readonly ExternalValue[];

export type ExternalField = ExternalRecord[string];
export type ExternalError = Error | ExternalField;

export type ExternalErrorDetails = {
  readonly statusCode: number | null;
  readonly status: number | null;
  readonly message: string | null;
};

export function parseExternalString(
  value: ExternalField | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return value === text ? text : null;
}

export function parseExternalNumber(
  value: ExternalField | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseExternalNumberLiteral(
  value: ExternalField | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return value === number && Number.isFinite(number) ? number : null;
}

export function parseExternalBoolean(
  value: ExternalField | undefined,
): boolean | null {
  return value === true || value === false ? value : null;
}

export function parseExternalDate(
  value: ExternalField | undefined,
): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const text = parseExternalString(value);
  const number = parseExternalNumber(value);
  const date = new Date(text !== null ? text : (number ?? Number.NaN));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function parseExternalRecord<T>(
  value: T | undefined,
): ExternalRecord | null {
  if (value === null || value === undefined || Array.isArray(value))
    return null;
  const tag = Object.prototype.toString.call(value);
  if (tag !== "[object Object]" && tag !== "[object Error]") return null;
  return Object.fromEntries(Object.entries(Object(value)));
}

export function parseExternalError(value: ExternalError): ExternalErrorDetails {
  const record = parseExternalRecord(value);
  return {
    statusCode: parseExternalNumber(record?.statusCode),
    status: parseExternalNumber(record?.status),
    message:
      value instanceof Error
        ? value.message
        : parseExternalString(record?.message),
  };
}
