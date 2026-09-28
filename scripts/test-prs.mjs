// PR URL matching. Run via:  npm test
import assert from "node:assert";
import { prKey } from "../packages/shared/src/prs.ts";

assert.equal(prKey("https://github.com/acme/api/pull/88"), "acme/api#88");
assert.equal(prKey("https://github.com/Acme/API/pull/88/files"), "acme/api#88");
assert.equal(prKey("https://github.com/acme/api/pull/88/commits/abc123"), "acme/api#88");
assert.equal(prKey("https://github.com/acme/api/pull/88#discussion_r1"), "acme/api#88");
assert.equal(prKey("https://github.com/acme/api/pull/88?w=1"), "acme/api#88");
assert.notEqual(prKey("https://github.com/acme/api/pull/89"), prKey("https://github.com/acme/api/pull/88"));
assert.notEqual(prKey("https://github.com/acme/web/pull/88"), prKey("https://github.com/acme/api/pull/88"));
assert.equal(prKey("https://github.com/acme/api/pull/88x"), undefined);
assert.equal(prKey("https://github.com/acme/api/issues/88"), undefined);
assert.equal(prKey("https://github.com/acme/api/pulls"), undefined);
assert.equal(prKey("http://github.com/acme/api/pull/88"), undefined);
assert.equal(prKey("https://gist.github.com/acme/api/pull/88"), undefined);
assert.equal(prKey("https://evil.example/github.com/acme/api/pull/88"), undefined);
assert.equal(prKey("javascript:alert(1)"), undefined);
assert.equal(prKey(""), undefined);
assert.equal(prKey(undefined), undefined);

console.log("prs: ok");
