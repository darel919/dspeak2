import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { baseParse, NodeTypes } from "@vue/compiler-dom";
import { parse } from "@vue/compiler-sfc";
import test from "node:test";
import { listSourceFiles } from "./helpers/source-files.ts";

function attributes(node) {
  return new Map(
    node.props
      .filter((property) => property.type === NodeTypes.ATTRIBUTE)
      .map((property) => [property.name, property.value?.content || ""]),
  );
}

function directives(node) {
  return node.props.filter((property) => property.type === NodeTypes.DIRECTIVE);
}

function hasDynamicAttribute(nodeDirectives, name) {
  return nodeDirectives.some((directive) => directive.arg?.content === name);
}

function hasText(node) {
  if (node.type === NodeTypes.TEXT) return Boolean(node.content.trim());
  if (node.type === NodeTypes.INTERPOLATION) return true;
  return Boolean(node.children?.some(hasText));
}

function inspectTemplate(file, template) {
  const findings = [];
  const root = baseParse(template);

  function walk(node, ancestors = []) {
    if (node.type !== NodeTypes.ELEMENT) {
      for (const child of node.children || []) walk(child, ancestors);
      return;
    }

    const nodeAttributes = attributes(node);
    const nodeDirectives = directives(node);
    const line = node.loc.start.line;
    const dynamic = (name) => hasDynamicAttribute(nodeDirectives, name);
    const report = (message) => findings.push(`${file}:${line} ${message}`);

    if (node.tag === "img" && !nodeAttributes.has("alt") && !dynamic("alt")) {
      report("image is missing alt text");
    }

    if (
      node.tag === "button" &&
      !nodeAttributes.has("aria-label") &&
      !nodeAttributes.has("aria-labelledby") &&
      !nodeAttributes.has("title") &&
      !dynamic("aria-label") &&
      !dynamic("aria-labelledby") &&
      !dynamic("title") &&
      !hasText(node)
    ) {
      report("icon-only button has no accessible name");
    }

    if (
      ["input", "select", "textarea"].includes(node.tag) &&
      nodeAttributes.get("type") !== "hidden" &&
      !nodeAttributes.has("aria-label") &&
      !nodeAttributes.has("aria-labelledby") &&
      !dynamic("aria-label") &&
      !dynamic("aria-labelledby") &&
      !nodeAttributes.has("id") &&
      !dynamic("id") &&
      !ancestors.some((ancestor) => ancestor.tag === "label")
    ) {
      report(`${node.tag} has no accessible label`);
    }

    if (node.tag === "a" && !nodeAttributes.has("href") && !dynamic("href")) {
      report("anchor without href must be a semantic button");
    }

    const classes = nodeAttributes.get("class") || "";
    if (
      classes.split(/\s+/).includes("modal-open") &&
      !["dialog", "alertdialog"].includes(nodeAttributes.get("role"))
    ) {
      report("open modal is missing a dialog role");
    }

    if (
      ["dialog", "alertdialog"].includes(nodeAttributes.get("role")) &&
      !nodeAttributes.has("aria-label") &&
      !nodeAttributes.has("aria-labelledby") &&
      !dynamic("aria-label") &&
      !dynamic("aria-labelledby")
    ) {
      report("dialog has no accessible name");
    }

    for (const child of node.children) walk(child, [...ancestors, node]);
  }

  walk(root);
  return findings;
}

test("Vue templates retain basic accessible names and semantics", async () => {
  const files = await listSourceFiles(["app"], [".vue"]);
  const findings = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const template = parse(source).descriptor.template?.content;
    if (template) findings.push(...inspectTemplate(file, template));
  }

  assert.deepEqual(findings, []);
});

test("the document declares its content language", async () => {
  const source = await readFile("nuxt.config.ts", "utf8");

  assert.match(source, /htmlAttrs:\s*\{\s*lang:\s*"en"/);
});
