export type ExternalObject = Record<string, unknown>;

export type ExternalValue =
  object | string | number | boolean | bigint | symbol | null | undefined;

export type MediaCommandResult = void | ExternalValue;
export type ExternalFunction = (...args: never[]) => ExternalValue;

export function isExternalNumber<T>(value: T): value is T & number {
  try {
    const number = Number.prototype.valueOf.call(value);
    return Object.is(value, number) && Number.isFinite(number);
  } catch {
    return false;
  }
}

export function isExternalBoolean<T>(value: T): value is T & boolean {
  return value === true || value === false;
}

export function isExternalRecord<T>(value: T): value is T & ExternalObject {
  const tag = Object.prototype.toString.call(value);
  return (
    value !== null &&
    Object(value) === value &&
    !Array.isArray(value) &&
    tag !== "[object String]" &&
    tag !== "[object Number]" &&
    tag !== "[object Boolean]" &&
    tag !== "[object BigInt]" &&
    tag !== "[object Symbol]"
  );
}

export function isExternalString<T>(value: T): value is T & string {
  try {
    return String.prototype.valueOf.call(value) === value;
  } catch {
    return false;
  }
}

export function isExternalFunction<T>(value: T): value is T & ExternalFunction {
  return value instanceof Function;
}
