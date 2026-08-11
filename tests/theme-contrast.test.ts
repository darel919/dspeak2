import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function rgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  );
}

function luminance(color) {
  const channels = color
    .map((channel) => channel / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const foregroundLuminance = luminance(rgb(foreground));
  const backgroundLuminance = luminance(rgb(background));
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function declaration(block, property) {
  const match = block.match(
    new RegExp(`${property.replaceAll("-", "\\-")}:\\s*(#[0-9a-fA-F]{6})`),
  );
  assert.ok(match, `${property} must use an auditable six-digit hex color`);
  return match[1];
}

test("room accents meet text and focus contrast in both surface modes", async () => {
  const css = await readFile("app/assets/app.css", "utf8");
  const darkSurface = declaration(
    css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)[1],
    "--color-base-100",
  );
  const lightSurface = "#ffffff";
  const accentBlocks = [
    ...css.matchAll(
      /^(?:\[data-accent="([^"]+)"\]|:root,\s*\[data-accent="([^"]+)"\])\s*\{([\s\S]*?)\}/gm,
    ),
  ];

  assert.equal(accentBlocks.length, 6);
  for (const match of accentBlocks) {
    const name = match[1] || match[2];
    const block = match[3];
    const accent = declaration(block, "--metro-accent");
    const content = declaration(block, "--metro-accent-content");
    assert.ok(
      contrast(content, accent) >= 4.5,
      `${name} accent text must meet WCAG AA`,
    );
    assert.ok(
      contrast(accent, lightSurface) >= 3,
      `${name} focus indicator must contrast with the light surface`,
    );
    assert.ok(
      contrast(accent, darkSurface) >= 3,
      `${name} focus indicator must contrast with the dark surface`,
    );
  }
});

test("dark room accents meet text and focus contrast", async () => {
  const css = await readFile("app/assets/app.css", "utf8");
  const darkBlock = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)[1];
  const darkSurface = declaration(darkBlock, "--color-base-100");
  const accentBlocks = [
    ...css.matchAll(
      /^\[data-theme="dark"\]\[data-accent="([^"]+)"\]\s*\{([\s\S]*?)\}/gm,
    ),
  ];

  assert.equal(accentBlocks.length, 6);
  for (const match of accentBlocks) {
    const name = match[1];
    const block = match[2];
    const accent = declaration(block, "--metro-accent");
    const content = declaration(block, "--metro-accent-content");
    assert.ok(
      contrast(content, accent) >= 4.5,
      `${name} dark accent text must meet WCAG AA`,
    );
    assert.ok(
      contrast(accent, darkSurface) >= 4.5,
      `${name} dark accent text must contrast with the dark surface`,
    );
  }
});

test("dark theme base surfaces maintain normal-text contrast", async () => {
  const css = await readFile("app/assets/app.css", "utf8");
  const block = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)[1];
  const content = declaration(block, "--color-base-content");

  for (const property of [
    "--color-base-100",
    "--color-base-200",
    "--color-base-300",
    "--color-neutral",
  ]) {
    assert.ok(
      contrast(content, declaration(block, property)) >= 4.5,
      `${property} must maintain WCAG AA text contrast`,
    );
  }
});

test("hero text meets normal-text contrast in both surface modes", async () => {
  const css = await readFile("app/assets/app.css", "utf8");
  const lightHero = declaration(
    css.match(/@theme\s*\{([\s\S]*?)\}/)[1],
    "--color-hero",
  );
  const darkBlock = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)[1];
  const darkHero = declaration(darkBlock, "--color-hero");

  assert.ok(
    contrast(lightHero, "#ffffff") >= 4.5,
    "light theme hero text must meet WCAG AA",
  );
  assert.ok(
    contrast(darkHero, declaration(darkBlock, "--color-base-100")) >= 4.5,
    "dark theme hero text must meet WCAG AA",
  );
});

test("semantic status colors meet normal-text contrast", async () => {
  const css = await readFile("app/assets/app.css", "utf8");
  const lightBlock = css.match(/\[data-theme="light"\]\s*\{([\s\S]*?)\}/)[1];
  const darkBlocks = [
    ...css.matchAll(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/g),
  ];
  const darkBlock = darkBlocks.at(-1)[1];

  for (const [mode, block, surface] of [
    ["light", lightBlock, "#ffffff"],
    ["dark", darkBlock, "#111214"],
  ]) {
    for (const name of ["error", "info", "success", "warning"]) {
      const color = declaration(block, `--color-${name}`);
      const content = declaration(block, `--color-${name}-content`);
      assert.ok(
        contrast(color, surface) >= 4.5,
        `${name} text must contrast with the ${mode} surface`,
      );
      assert.ok(
        contrast(content, color) >= 4.5,
        `${name} content must contrast with its ${mode} background`,
      );
    }
  }
});
