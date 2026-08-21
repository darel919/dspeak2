import type {
  ExternalObject as BoundaryExternalObject,
  ExternalValue as BoundaryExternalValue,
} from "../shared/types/boundary.ts";
import {
  isExternalNumber,
  isExternalString,
} from "../shared/types/boundary.ts";
import type { ExternalField } from "../../shared/types/external.ts";

export type ExternalObject = BoundaryExternalObject;
export type ExternalMapValue = ReadonlyMap<unknown, unknown>;
export type ExternalValue = BoundaryExternalValue | Error | ExternalMapValue;
export type ParsedExternalObject = {
  [key: string]: ExternalValue;
};

type ExternalPrimitive =
  string | number | boolean | bigint | symbol | null | undefined;

export class ParsedExternalError extends Error {
  override code?: string;
  override details?: ExternalValue;

  constructor(message: string) {
    super(message);
    this.name = "ParsedExternalError";
  }
}

function parseExternalMap(value: ExternalMapValue): BoundaryExternalObject {
  return Object.fromEntries(
    [...value.entries()].flatMap(([key, entry]) => {
      if (!isExternalString(key) && !isExternalNumber(key)) return [];
      return [[String(key), parseExternalValue(entry)]];
    }),
  );
}

function parseExternalErrorRecord(value: Error): BoundaryExternalObject {
  const entries: Array<[string, ExternalValue]> = [
    ["name", value.name],
    ["message", value.message],
  ];
  for (const property of Object.getOwnPropertyNames(value)) {
    if (property === "name" || property === "message") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    if (descriptor && "value" in descriptor)
      entries.push([property, parseExternalValue(descriptor.value)]);
  }
  return Object.fromEntries(entries);
}

function isExternalPrimitive(value: ExternalField): value is ExternalPrimitive {
  if (value === null || value === undefined) return true;
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object String]") return isExternalString(value);
  if (tag === "[object Number]") return Object(value) !== value;
  if (tag === "[object Boolean]") return value === true || value === false;
  if (tag === "[object BigInt]") return Object(value) !== value;
  return tag === "[object Symbol]" && Object(value) !== value;
}

function isExternalObjectValue(value: ExternalField): value is object {
  return value !== null && Object(value) === value;
}

export function parseExternalValue(value: ExternalField): ExternalValue {
  if (isExternalPrimitive(value)) return value;
  if (!isExternalObjectValue(value)) return value;
  if (value instanceof Error) return value;
  if (value instanceof Map) return parseExternalMap(value);
  const tag = Object.prototype.toString.call(value);
  if (tag !== "[object Object]" && tag !== "[object Array]") return value;
  if (Array.isArray(value))
    return value.map((entry) => parseExternalValue(entry));
  return Object.fromEntries(
    Object.entries(Object(value)).map(([key, entry]) => [
      key,
      parseExternalValue(entry),
    ]),
  );
}

export function parseExternalString(value: ExternalValue): string | null {
  return isExternalString(value) ? value : null;
}

export function parseExternalNumber(value: ExternalValue): number | null {
  if (isExternalNumber(value)) return value;
  if (!isExternalString(value) || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseExternalBoolean(value: ExternalValue): boolean | null {
  return value === true || value === false ? value : null;
}

export function readExternalProperty(
  value: ExternalValue,
  property: string,
): ExternalValue | null {
  const record = parseExternalRecord(value);
  if (!record || !Object.prototype.hasOwnProperty.call(record, property))
    return null;
  return parseExternalValue(record[property]);
}

export function parseExternalRecord(
  value: ExternalField,
): BoundaryExternalObject | null {
  const parsed = parseExternalValue(value);
  if (parsed instanceof Error) return parseExternalErrorRecord(parsed);
  if (
    parsed === null ||
    Array.isArray(parsed) ||
    Object.prototype.toString.call(parsed) !== "[object Object]"
  )
    return null;
  return Object.fromEntries(
    Object.entries(Object(parsed)).map(([key, entry]) => [
      key,
      parseExternalValue(entry),
    ]),
  );
}

export function parseExternalError(value: ExternalValue): ParsedExternalError {
  const message =
    value instanceof Error
      ? value.message
      : (parseExternalString(readExternalProperty(value, "message")) ??
        parseExternalString(value) ??
        "Unknown error");
  const error = new ParsedExternalError(message);
  const code = parseExternalString(readExternalProperty(value, "code"));
  if (code !== null) error.code = code;
  const details = readExternalProperty(value, "details");
  if (details !== null) error.details = details;
  return error;
}

export function parseThrownError<T>(value: T): ParsedExternalError {
  return parseExternalError(parseExternalValue(value));
}
