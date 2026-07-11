// Wrapper around @earendil-works/pi-coding-agent. Re-exports everything
// from the real package but swaps SessionManager for a recording stub.
// cd.ts only imports { SessionManager } from this package, so the real
// runtime side effects are not exercised by the cd-no-preserve test —
// we just need SessionManager to be reachable.
//
// Used as the jiti alias target in cd-no-preserve.cjs.
const path = require("node:path");
const os = require("node:os");

const { execSync } = require("node:child_process");
const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const PI_ROOT = path.join(globalRoot, "@earendil-works", "pi-coding-agent");

// Pull in the real package's exports. This re-exports SessionManager
// and all the other named exports.
const realPkg = require(PI_ROOT);

// Recording stub. Use globalThis so jiti-cached and require-cached copies
// of this module see the same recorder object.
if (!globalThis.__aftcTestSessionCalls) {
	globalThis.__aftcTestSessionCalls = {
		create: [],
		continueRecent: [],
		inMemory: [],
		open: [],
	};
}
const sessionManagerCalls = globalThis.__aftcTestSessionCalls;
if (!globalThis.__aftcTestSessionId) globalThis.__aftcTestSessionId = 1;
let nextSessionId = globalThis.__aftcTestSessionId;
function makeStubFile(id) {
	return path.join(os.tmpdir(), `aftc-test-${id}.jsonl`);
}

function nextId() {
	const id = `sess-${nextSessionId}`;
	nextSessionId++;
	globalThis.__aftcTestSessionId = nextSessionId;
	return id;
}

const SessionManagerStub = {
	create(cwd) {
		sessionManagerCalls.create.push({ cwd });
		const id = nextId();
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
		const file = makeStubFile("recent");
		return {
			_sessionId: "recent-stub",
			_sessionFile: file,
			_sessionDir: os.tmpdir(),
			getSessionFile: function () { return this._sessionFile; },
			getSessionId: function () { return this._sessionId; },
			getSessionDir: function () { return this._sessionDir; },
		};
	},
	inMemory(cwd) { sessionManagerCalls.inMemory.push({ cwd }); return {}; },
	open(p) { sessionManagerCalls.open.push({ p }); return {}; },
};

// Override the SessionManager export. The real pkg's exports may be
// frozen, so copy onto a new object plus an explicit override.
const out = Object.assign({}, realPkg, {
	SessionManager: SessionManagerStub,
	__test_sessionManagerCalls: sessionManagerCalls,
});

module.exports = out;
console.log("[STUB] wrapper loaded at", __filename);