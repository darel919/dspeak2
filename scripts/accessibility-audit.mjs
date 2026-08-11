import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const baseUrl = process.env.ACCESSIBILITY_AUDIT_URL || "http://127.0.0.1:3000";
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const axePath = fileURLToPath(import.meta.resolve("axe-core/axe.min.ts"));
const profile = await mkdtemp(join(tmpdir(), "dspeak-a11y-"));
const user = {
  id: "user-a",
  name: "alex",
  display_name: "Alex Example",
  handle: "alex",
  email: "alex@example.test",
  avatar: "",
};
const member = {
  id: "user-b",
  name: "blair",
  display_name: "Blair Example",
  handle: "blair",
  email: "blair@example.test",
  avatar: "",
};
const room = {
  id: "room-a",
  name: "Accessibility Lab",
  desc: "WCAG validation room",
  accent: "cobalt",
  picture: "",
  headerImage: "",
  owner: user,
  members: [user, member],
  isOwner: true,
  permissions: [
    "channel.create",
    "channel.update",
    "channel.delete",
    "channel.manage_media_policy",
    "room.update",
    "room.manage_members",
    "room.manage_roles",
    "room.manage_invites",
    "room.manage_soundboard",
  ],
};
const channels = [
  {
    id: "text-a",
    roomId: room.id,
    name: "general",
    desc: "General discussion",
    isMedia: false,
    owner: user,
  },
  {
    id: "voice-a",
    roomId: room.id,
    name: "voice",
    desc: "Voice chat",
    isMedia: true,
    owner: user,
    participants: [],
    mediaPolicy: {},
  },
];
const defaultRoutes = [
  "/",
  "/settings",
  "/account",
  "/room/create",
  "/room/details?id=room-a",
  "/room/room-a/settings",
  "/room/room-a/text-a",
  "/room/room-a/voice-a",
];
const routes = process.env.ACCESSIBILITY_AUDIT_ROUTES
  ? process.env.ACCESSIBILITY_AUDIT_ROUTES.split(",")
  : defaultRoutes;
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
  { name: "reflow", width: 320, height: 720 },
];
const wcagTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
];
const findings = [];
let manualReviews = 0;
let cases = 0;
let browser;

function responseBody(path) {
  if (path === "/api/session") return { user: { user_metadata: user } };
  if (path === "/api/room" || path === "/api/room/") return [room];
  if (path === "/api/room/details") return room;
  if (path === "/api/channel" || path === "/api/channel/") return channels;
  if (path.includes("/api/chat/messages")) return { messages: [] };
  if (path.includes("/api/profile")) return user;
  if (path.startsWith("/api/")) return [];
  return undefined;
}

async function preparePage(theme, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const body = responseBody(new URL(request.url()).pathname);
    if (body === undefined) {
      request.continue();
      return;
    }
    request.respond({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.evaluateOnNewDocument((surfaceMode) => {
    localStorage.setItem(
      "dspeak_appearance",
      JSON.stringify({ surfaceMode, accent: "cobalt" }),
    );
  }, theme);
  return page;
}

async function audit(page, context) {
  await page.addScriptTag({ path: axePath });
  const report = await page.evaluate(async (tags) => {
    function relativeLuminance(color) {
      const channels = color
        .match(/\d+(?:\.\d+)?/g)
        ?.slice(0, 3)
        .map(Number);
      if (!channels || channels.length !== 3) return null;
      const [red, green, blue] = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    }

    function elementDetail(node) {
      const target = node.target.join(" ");
      const element = document.querySelector(target);
      const rectangle = element?.getBoundingClientRect();
      const style = element ? getComputedStyle(element) : null;
      const foreground = style?.color || null;
      const background = style?.backgroundColor || null;
      const foregroundLuminance = foreground
        ? relativeLuminance(foreground)
        : null;
      const backgroundLuminance = background
        ? relativeLuminance(background)
        : null;
      const contrastRatio =
        foregroundLuminance === null || backgroundLuminance === null
          ? null
          : (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      return {
        target,
        html: node.html,
        summary: node.failureSummary,
        rectangle: rectangle
          ? {
              x: rectangle.x,
              y: rectangle.y,
              width: rectangle.width,
              height: rectangle.height,
            }
          : null,
        color: foreground,
        backgroundColor: background,
        contrastRatio,
      };
    }

    const result = await axe.run(document, {
      runOnly: { type: "tag", values: tags },
    });
    const incomplete = [];
    const reviewed = [];
    for (const item of result.incomplete) {
      const details = item.nodes.slice(0, 8).map(elementDetail);
      const reviewedDetails = details.filter(
        (detail) =>
          item.id === "color-contrast" &&
          detail.target === ".toast-message" &&
          detail.contrastRatio >= 4.5,
      );
      const unresolvedDetails = details.filter(
        (detail) => !reviewedDetails.includes(detail),
      );
      if (reviewedDetails.length) {
        reviewed.push({
          id: item.id,
          reason: "Opaque toast overlay with verified computed contrast",
          details: reviewedDetails,
        });
      }
      if (unresolvedDetails.length) {
        incomplete.push({
          id: item.id,
          nodes: unresolvedDetails.length,
          details: unresolvedDetails,
        });
      }
    }
    return {
      violations: result.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        nodes: item.nodes.length,
        targets: item.nodes.slice(0, 8).map((node) => node.target.join(" ")),
        details: item.nodes.slice(0, 8).map(elementDetail),
      })),
      incomplete,
      reviewed,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  }, wcagTags);
  cases += 1;
  manualReviews += report.reviewed.length;
  if (
    report.violations.length ||
    report.incomplete.length ||
    report.horizontalOverflow
  ) {
    findings.push({
      ...context,
      violations: report.violations,
      incomplete: report.incomplete,
      horizontalOverflow: report.horizontalOverflow,
    });
  }
}

try {
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: profile,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  for (const theme of ["light", "dark"]) {
    for (const viewport of viewports) {
      const page = await preparePage(theme, viewport);
      for (const route of routes) {
        await page.goto(`${baseUrl}${route}`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.waitForFunction(
          (expectedTheme) =>
            document.documentElement.dataset.theme === expectedTheme &&
            !document.body.innerText.includes("Checking authentication"),
          { timeout: 15000 },
          theme,
        );
        await page.evaluate(
          () => new Promise((resolve) => window.setTimeout(resolve, 400)),
        );
        await audit(page, { theme, viewport: viewport.name, route });
      }
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await rm(profile, { recursive: true, force: true });
}

const failures = findings.filter(
  (finding) =>
    finding.violations.length ||
    finding.incomplete.length ||
    finding.horizontalOverflow,
);
console.log(JSON.stringify({ cases, manualReviews, findings }, null, 2));
if (failures.length) process.exitCode = 1;
