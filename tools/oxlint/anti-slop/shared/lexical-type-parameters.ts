import type { ESTree } from "@oxlint/plugins";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;
type NodePropertyValue =
  ESTree.Node | readonly ESTree.Node[] | null | undefined;

function isNode<T>(value: T): value is T & ESTree.Node {
  if (value === null || value === undefined || Array.isArray(value))
    return false;
  const nodeType = Object.getOwnPropertyDescriptor(
    Object(value),
    "type",
  )?.value;
  return (
    Object.prototype.toString.call(value) === "[object Object]" &&
    Object.prototype.toString.call(nodeType) === "[object String]" &&
    String(nodeType) === nodeType
  );
}

function isNodeArray<T>(value: T): value is T & readonly ESTree.Node[] {
  return Array.isArray(value) && value.every((child) => isNode(child));
}

function propertyValue(value: ESTree.Node, key: string): NodePropertyValue {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (isNode(descriptor.value)) return descriptor.value;
  if (isNodeArray(descriptor.value)) return descriptor.value;
  return undefined;
}

function collectInferTypeParameterNames(
  node: ESTree.Node,
  visitorKeys: VisitorKeys,
  names: Set<string>,
): void {
  if (node.type === "TSInferType") names.add(node.typeParameter.name.name);
  for (const key of visitorKeys[node.type] ?? []) {
    const value = propertyValue(node, key);
    if (isNode(value)) {
      collectInferTypeParameterNames(value, visitorKeys, names);
      continue;
    }
    if (!isNodeArray(value)) continue;
    for (const child of value)
      collectInferTypeParameterNames(child, visitorKeys, names);
  }
}

export function lexicalTypeParameterNames(
  node: ESTree.Node,
  visitorKeys: VisitorKeys,
): ReadonlySet<string> {
  const names = new Set<string>();
  let descendant: ESTree.Node = node;
  let current: ESTree.Node | null = node;
  while (current !== null && current.type !== "Program") {
    if ("typeParameters" in current) {
      for (const parameter of current.typeParameters?.params ?? []) {
        names.add(parameter.name.name);
      }
    }
    if (
      current.type === "TSMappedType" &&
      (descendant === current.nameType || descendant === current.typeAnnotation)
    ) {
      names.add(current.key.name);
    }
    if (
      current.type === "TSConditionalType" &&
      descendant === current.trueType
    ) {
      collectInferTypeParameterNames(current.extendsType, visitorKeys, names);
    }
    descendant = current;
    current = current.parent;
  }
  return names;
}
