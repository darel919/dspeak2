import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

const baseUrl = process.env.RESPONSIVE_CHECK_URL || "http://localhost:3000";
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const profile = await mkdtemp(join(tmpdir(), "dspeak-responsive-"));
const browser = await puppeteer.launch({
  executablePath,
  headless: false,
  userDataDir: profile,
  args: ["--no-first-run", "--no-default-browser-check"],
});

const page = await browser.newPage();
const errors = [];
const apiRequests = [];
const apiResponses = [];
await page.setBypassServiceWorker(true);
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("response", (response) => {
  const url = new URL(response.url());
  if (url.hostname === "localhost" && url.pathname.startsWith("/api/"))
    apiResponses.push({ url: response.url(), status: response.status() });
});

await page.setRequestInterception(true);
await page.setExtraHTTPHeaders({
  Authorization: "Bearer responsive-test-token",
});
const user = {
  id: "user-a",
  name: "alex",
  display_name: "Alex Example",
  handle: "alex",
  email: "alex@example.test",
  avatar: "",
};
const room = {
  id: "room-a",
  name: "Accessibility Lab",
  desc: "Responsive validation room",
  accent: "cobalt",
  picture: "",
  headerImage: "",
  owner: user,
  members: [user],
  isOwner: true,
  permissions: ["channel.create", "room.update"],
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
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.hostname === "localhost")
    apiRequests.push({ url: request.url(), method: request.method() });
  if (url.pathname === "/auth") {
    request.continue();
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    let body = [];
    if (url.pathname === "/api/auth/session")
      body = { user: { user_metadata: user } };
    if (url.pathname === "/api/room" || url.pathname === "/api/room/")
      body = [room];
    if (url.pathname.startsWith("/api/room/details")) body = room;
    if (url.pathname === "/api/channel" || url.pathname === "/api/channel/")
      body = channels;
    if (url.pathname.includes("/api/chat/messages")) body = { messages: [] };
    if (url.pathname.includes("/api/profile")) body = user;
    request.respond({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    return;
  }
  if (
    url.hostname.includes("supabase") &&
    url.pathname.startsWith("/auth/v1")
  ) {
    request.respond({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "responsive-test-access-token",
        refresh_token: "responsive-test-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: user.id, user_metadata: user },
      }),
    });
    return;
  }
  if (url.hostname.includes("supabase")) {
    request.abort();
    return;
  }
  request.continue();
});

await page.evaluateOnNewDocument((sessionUser) => {
  localStorage.setItem("userData", JSON.stringify(sessionUser));
  localStorage.setItem(
    "sb-crmucqnebwlssqzthnek-auth-token",
    JSON.stringify({
      access_token: "responsive-test-access-token",
      refresh_token: "responsive-test-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: sessionUser.id,
        aud: "authenticated",
        role: "authenticated",
        email: sessionUser.email,
        email_confirmed_at: new Date().toISOString(),
        app_metadata: { provider: "google", providers: ["google"] },
        user_metadata: sessionUser,
      },
    }),
  );
}, user);

const viewports = [
  { name: "1024", width: 1024, height: 768 },
  { name: "768", width: 768, height: 768 },
];
const results = [];
const route = "/room/room-a/text-a";

for (const viewport of viewports) {
  await page.setViewport({ width: viewport.width, height: viewport.height });
  await page.evaluateOnNewDocument((sessionUser) => {
    localStorage.setItem("userData", JSON.stringify(sessionUser));
    localStorage.setItem(
      "dspeak_appearance",
      JSON.stringify({ surfaceMode: "light", accent: "cobalt" }),
    );
  }, user);
  await page.goto(`${baseUrl}${route}`, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  await page.evaluate(() => {
    document.cookie = "dspeak_session=responsive-test; path=/";
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 700));
  await page.screenshot({
    path: `/tmp/dspeak-responsive-${viewport.name}.png`,
  });
  results.push({
    viewport: viewport.name,
    url: page.url(),
    title: await page.title(),
    viewport: await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    })),
    document: await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    })),
    visible: await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            rect.width > 0 && rect.height > 0 && style.visibility !== "hidden"
          );
        })
        .slice(0, 200)
        .map((element) => ({
          tag: element.tagName,
          className:
            typeof element.className === "string" ? element.className : "",
          rect: (() => {
            const rect = element.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          })(),
        }))
        .filter((item) => item.rect.x + item.rect.width > viewport.width + 1),
    ),
    controls: await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".metro-navbar-end > *, .metro-call-dock, .metro-icon-btn, .metro-call-icon, .profile-button",
        ),
      ].map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          className:
            typeof element.className === "string" ? element.className : "",
          text: element.textContent?.trim().replace(/\s+/g, " "),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          minHeight: style.minHeight,
          overflow: style.overflow,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
        };
      }),
    ),
  });
}

console.log(
  JSON.stringify({ results, errors, apiRequests, apiResponses }, null, 2),
);
await browser.close();
await rm(profile, { recursive: true, force: true });
