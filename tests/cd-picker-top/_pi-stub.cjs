// Wrapper around @earendil-works/pi-coding-agent. Re-exports everything
// from the real package but swaps SessionManager for a recording stub.
// Used as the jiti alias target in cd-picker-top.cjs. (Identical to
// the one in cd-no-preserve/ but kept self-contained per test.)
const path = require("node:path");
const os = require("node:os");

const { execSync } = require("node:child_process");
const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const PI_ROOT = path.join(globalRoot, "@earendil-works", "pi-coding-agent");

const realPkg = require(PI_ROOT);

const sessionManagerCalls = { create: [], continueRecent: [], inMemory: [], open: [] };
let nextSessionId = 1;
function makeStubFile(id) {
	return path.join(os.tmpdir(), `aftc-test-${id}.jsonl`);
}

const SessionManagerStub = {
	create(cwd) {
		sessionManagerCalls.create.push({ cwd });
		const id = `sess-${nextSessionId++}`;
		const file = makeStubFile(id);
		return {
			_sessionId: id,
			_sessionFile: file,
			_sessionDir: os.tmpdir(),
			getSessionFile: function () { return this._sessionFile; },
			getSessionId: function () { return this._sessionId; },
			getSessionDir: function () { return this._sessionDir; },
		};
	},
	continueRecent(cwd) {
		sessionManagerCalls.continueRecent.push({ cwd });
		return {
			_sessionId: "recent-stub",
			_sessionFile: makeStubFile("recent"),
			_sessionDir: os.tmpdir(),
			getSessionFile: function () { return this._sessionFile; },
			getSessionId: function () { return this._sessionId; },
			getSessionDir: function () { return this._sessionDir; },
		};
	},
	inMemory(cwd) { sessionManagerCalls.inMemory.push({ cwd }); return {}; },
	open(p) { sessionManagerCalls.open.push({ p }); return {}; },
};

const out = Object.assign({}, realPkg, {
	SessionManager: SessionManagerStub,
	__test_sessionManagerCalls: sessionManagerCalls,
});

module.exports = out;