// Settings normalisation. Run via:  npm test
import assert from "node:assert";
import { DEFAULT_SETTINGS, normalizeSettings, sectionsWith } from "../packages/shared/src/settings.ts";

assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
assert.deepEqual(normalizeSettings("garbage"), DEFAULT_SETTINGS);
assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);

{
  const s = normalizeSettings({
    refreshMinutes: 0,
    graceSeconds: 9999,
    staleDays: "12",
    groupName: "   ",
    groupColor: "magenta",
    liveGroup: "yes",
    sections: { review: { group: false }, bogus: { popup: false } },
  });
  assert.equal(s.refreshMinutes, 1);
  assert.equal(s.graceSeconds, 600);
  assert.equal(s.staleDays, 12);
  assert.equal(s.groupName, "Pull requests");
  assert.equal(s.groupColor, "grey");
  assert.equal(s.liveGroup, true);
  assert.deepEqual(s.sections.review, { popup: true, badge: true, group: false });
  assert.equal("bogus" in s.sections, false);
}

assert.equal(normalizeSettings({ refreshMinutes: 2.6 }).refreshMinutes, 3);
assert.equal(normalizeSettings({ refreshMinutes: NaN }).refreshMinutes, 2);
assert.equal(normalizeSettings({ graceSeconds: 0 }).graceSeconds, 0);
assert.equal(normalizeSettings({ groupName: "  PRs  " }).groupName, "PRs");
assert.equal(normalizeSettings({ groupColor: "cyan" }).groupColor, "cyan");
assert.equal(normalizeSettings({ badgeColor: "#CF222E" }).badgeColor, "#CF222E");
assert.equal(normalizeSettings({ badgeColor: "red" }).badgeColor, "#0969da");
assert.equal(normalizeSettings({ badgeColor: "#fff" }).badgeColor, "#0969da");
assert.equal("token" in normalizeSettings({ token: "ghp_secret" }), false);

assert.deepEqual([...sectionsWith(DEFAULT_SETTINGS, "group")], ["review", "team"]);
assert.deepEqual([...sectionsWith(DEFAULT_SETTINGS, "badge")], ["review", "team", "action", "ready"]);

console.log("settings: ok");
