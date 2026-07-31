import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const amazonSource = readFileSync("amazon.js", "utf8");
const youtubeSource = readFileSync("youtube.js", "utf8");

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background, undefined, "background worker must remain absent");
assert.equal(manifest.permissions, undefined, "extension must not request general permissions");
assert.equal(manifest.host_permissions, undefined, "host permissions must remain content-script scoped");
assert.equal(manifest.update_url, undefined, "custom update URLs are not allowed");

const scriptMatches = manifest.content_scripts.flatMap((entry) => entry.matches ?? []);
assert(scriptMatches.some((match) => match.includes("primevideo.com")));
assert(scriptMatches.some((match) => match.includes("youtube.com")));

for (const [name, source] of [["amazon.js", amazonSource], ["youtube.js", youtubeSource]]) {
  execFileSync(process.execPath, ["--check", name], { stdio: "inherit" });
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "browser.storage", "chrome.storage"]) {
    assert(!source.includes(forbidden), `${name} contains forbidden outbound or storage API: ${forbidden}`);
  }
}

class ElementStub {}
class VideoStub extends ElementStub {}
class ButtonStub extends ElementStub {}

const sandbox = {
  __PRIME_AD_SKIPPER_TEST__: true,
  console,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  RegExp,
  Boolean,
  HTMLElement: ElementStub,
  HTMLVideoElement: VideoStub,
  HTMLButtonElement: ButtonStub,
  MutationObserver: class {
    observe() {}
  },
  getComputedStyle() {
    return { display: "block", visibility: "visible", opacity: "1" };
  },
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
  queueMicrotask() {},
  document: {
    documentElement: null,
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  }
};

vm.createContext(sandbox);
vm.runInContext(amazonSource, sandbox, { filename: "amazon.js" });
const helpers = sandbox.__primeAdSkipperTest;
assert(helpers, "Prime Video test helpers were not exposed");

assert.equal(helpers.parseRemainingSeconds("Ad 00:30"), 30);
assert.equal(helpers.parseRemainingSeconds("01:02:03 remaining"), 3723);
assert.equal(helpers.parseRemainingSeconds("Advertisement"), null);
assert.equal(helpers.computeSeekSeconds(30), 29.25);
assert.equal(helpers.computeSeekSeconds(0.75), 0);
assert.equal(helpers.computeSeekSeconds(120), 90);
assert.equal(helpers.constants.TARGET_REMAINING_SECONDS, 0.75);
assert(helpers.constants.IDLE_CHECK_INTERVAL_MS > helpers.constants.ACTIVE_CHECK_INTERVAL_MS);
assert(helpers.constants.ACTIVE_CHECK_INTERVAL_MS <= 50);

console.log("All tests passed");
