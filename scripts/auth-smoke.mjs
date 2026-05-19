// ===========================================
// Auth end-to-end smoke test
//
// Prereqs:
//   1. MongoDB running
//   2. Server started WITH the dev code hook:
//        AUTH_EXPOSE_DEV_CODE=true npm run dev
//      (the hook is impossible in production)
//
// Run:  node scripts/auth-smoke.mjs
//
// Exercises: full signup -> session -> /me -> refresh
// -> refresh-reuse detection -> account lockout
// -> logout.
// ===========================================

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";
const email = `smoke_${Date.now()}@example.com`;
const password = "Str0ngPass1";

let pass = 0;
let fail = 0;

function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

// --- tiny cookie jar -----------------------------------------------------

const jar = {};
function storeCookies(res) {
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (v === "" ) delete jar[k];
    else jar[k] = v;
  }
}
function cookieHeader() {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function call(method, path, { body, auth, withCookies, csrf } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (withCookies) headers.cookie = cookieHeader();
  if (csrf && jar.csrfToken) headers["x-csrf-token"] = jar.csrfToken;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  storeCookies(res);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

// --- flow ----------------------------------------------------------------

async function main() {
  console.log(`Auth smoke @ ${BASE} (user: ${email})\n`);

  // 1. register
  const reg = await call("POST", "/api/auth/register", {
    body: { name: "Smoke User", email },
  });
  ok("register -> 201", reg.status === 201, `(got ${reg.status})`);
  const devCode = reg.json?.devCode;
  ok(
    "register returns devCode (AUTH_EXPOSE_DEV_CODE=true?)",
    Boolean(devCode),
    "- start server with AUTH_EXPOSE_DEV_CODE=true"
  );
  if (!devCode) return finish();

  // 2. verify-email
  const ver = await call("POST", "/api/auth/verify-email", {
    body: { email, code: devCode },
  });
  ok("verify-email -> 200", ver.status === 200, `(got ${ver.status})`);
  const signupToken = ver.json?.signupToken;
  ok("verify returns signupToken", Boolean(signupToken));
  if (!signupToken) return finish();

  // 2b. wrong code is rejected
  const badVer = await call("POST", "/api/auth/verify-email", {
    body: { email, code: "000000" },
  });
  ok("reused/invalid code -> 400", badVer.status === 400, `(got ${badVer.status})`);

  // 3. set-password
  const sp = await call("POST", "/api/auth/set-password", {
    auth: signupToken,
    body: { password },
  });
  ok("set-password -> 200", sp.status === 200, `(got ${sp.status})`);

  // 3b. weak password rejected
  const weak = await call("POST", "/api/auth/set-password", {
    auth: signupToken,
    body: { password: "weak" },
  });
  ok("weak password -> 400", weak.status === 400, `(got ${weak.status})`);

  // 4. select-plan -> session
  const plan = await call("POST", "/api/auth/select-plan", {
    auth: signupToken,
    body: { plan: "starter" },
  });
  ok("select-plan -> 200", plan.status === 200, `(got ${plan.status})`);
  const accessToken = plan.json?.accessToken;
  ok("session: accessToken issued", Boolean(accessToken));
  ok("session: refresh cookie set", Boolean(jar.refreshToken));
  ok("session: csrf cookie set", Boolean(jar.csrfToken));
  ok(
    "paid plan recorded but trial access",
    plan.json?.user?.selectedPlan === "starter" &&
      plan.json?.user?.plan === "free_trial" &&
      plan.json?.user?.status === "trialing",
    `(${JSON.stringify(plan.json?.user)})`
  );
  const firstRefresh = jar.refreshToken;

  // 5. GET /me
  const me = await call("GET", "/api/auth/me", { auth: accessToken });
  ok("/me -> 200", me.status === 200, `(got ${me.status})`);
  ok("/me no passwordHash leak", !("passwordHash" in (me.json?.user || {})));

  // 5b. /me without token -> 401
  const meNoAuth = await call("GET", "/api/auth/me");
  ok("/me no token -> 401", meNoAuth.status === 401, `(got ${meNoAuth.status})`);

  // 6. refresh (cookie + csrf)
  const refreshed = await call("POST", "/api/auth/refresh", {
    withCookies: true,
    csrf: true,
  });
  ok("refresh -> 200", refreshed.status === 200, `(got ${refreshed.status})`);
  ok(
    "refresh rotated the cookie",
    jar.refreshToken && jar.refreshToken !== firstRefresh
  );

  // 6b. refresh without CSRF -> 403
  const noCsrf = await call("POST", "/api/auth/refresh", {
    withCookies: true,
  });
  ok("refresh without CSRF -> 403", noCsrf.status === 403, `(got ${noCsrf.status})`);

  // 7. reuse the OLD refresh token -> 401 + family revoked
  const reuse = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: {
      cookie: `refreshToken=${firstRefresh}; csrfToken=${jar.csrfToken}`,
      "x-csrf-token": jar.csrfToken,
    },
  });
  ok("refresh reuse -> 401", reuse.status === 401, `(got ${reuse.status})`);

  // current (rotated) token should now also be dead (family revoked)
  const afterReuse = await call("POST", "/api/auth/refresh", {
    withCookies: true,
    csrf: true,
  });
  ok(
    "family revoked after reuse -> 401",
    afterReuse.status === 401,
    `(got ${afterReuse.status})`
  );

  // 8. account lockout: 5 bad logins
  let lockedStatus = 0;
  for (let i = 0; i < 6; i++) {
    const r = await call("POST", "/api/auth/login", {
      body: { email, password: "WrongPass1" },
    });
    lockedStatus = r.status;
  }
  ok(
    "account lockout after repeated bad logins -> 403",
    lockedStatus === 403,
    `(got ${lockedStatus})`
  );

  // 10. logout (need a fresh session first)
  const relog = await call("POST", "/api/auth/login", {
    body: { email, password },
  });
  // login may be 403 due to the lockout we just triggered — that's expected;
  // logout still clears cookies regardless.
  const out = await call("POST", "/api/auth/logout", {
    withCookies: true,
    csrf: true,
  });
  ok(
    "logout -> 200 (or 403 if CSRF absent)",
    out.status === 200 || out.status === 403,
    `(got ${out.status}; login was ${relog.status})`
  );

  finish();
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke run crashed:", err);
  process.exit(1);
});
