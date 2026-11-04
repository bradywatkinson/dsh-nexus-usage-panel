// dsh-nexus-usage-panel — host half.
// Serves the Fireworks Nexus usage data that the Nexus desktop app's Overview
// card shows ("This month — N% used · Resets …", "N% Current session · Resets
// at …") to this plugin's client half, which renders it as a DSH panel.
//
// Data source (see docs/research-api.md): the private REST API on Fireworks'
// public gateway that nexus.fireworks.ai and the Nexus desktop app read:
//   GET {base}/v1/accounts/{account}/nexusPlans
//   GET {base}/v1/accounts/{account}/users/{user}/nexusPlanUsage
// Auth is the per-machine Nexus key the desktop app minted at sign-in, stored
// in the macOS login keychain (service "FireworksAI", account
// "fireworks-api-key"). The key never leaves this process: errors are
// sanitized before they reach the client.
//
// Node builtins only; no runtime dependencies.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

const execFileAsync = promisify(execFile)

const API_PREFIX = "/api/dsh-nexus-usage"
const KEYCHAIN_SERVICE = "FireworksAI"
const KEYCHAIN_ACCOUNT = "fireworks-api-key"
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000

const inject = ["webServer"]

const TIERS = { PRO: "pro", TEAMS: "teams", ENTERPRISE: "enterprise" }

// ---------------------------------------------------------------------------
// credential + account discovery
// ---------------------------------------------------------------------------

/** The stored Nexus key, read fresh on 401. Never logged, never returned. */
async function readKeychainKey() {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s", KEYCHAIN_SERVICE,
      "-a", KEYCHAIN_ACCOUNT,
      "-w",
    ], { timeout: 60_000 })
    const key = String(stdout).trim()
    if (!key) throw new Error("keychain item is empty")
    return key
  } catch (error) {
    // security's stderr carries the reason (e.g. "User interaction is not
    // allowed" when the item's ACL requires a prompt from this process). The
    // key itself never appears on stderr.
    const stderr = String(error?.stderr ?? "").trim()
    const detail = stderr ? ` (${stderr})` : ""
    throw new Error(`Nexus keychain key unreadable${detail}`)
  }
}

/** The account id and user path the key was minted for. */
export async function readNexusIdentity(home = homedir()) {
  const result = { accountId: undefined, userName: undefined }
  try {
    const minted = JSON.parse(await readFile(join(home, ".nexus", "minted-key.json"), "utf8"))
    if (typeof minted?.userName === "string" && minted.userName) result.userName = minted.userName
    if (typeof minted?.keyId === "string" && minted.keyId) result.keyId = minted.keyId
  } catch {}
  if (result.userName && !result.accountId) {
    const account = result.userName.match(/^accounts\/([^/]+)\//)
    if (account) result.accountId = account[1]
  }
  if (!result.accountId) {
    // Fallback: the desktop app's own profile lists the account name.
    try {
      const profile = JSON.parse(await readFile(
        join(home, "Library", "Application Support", "Nexus", "profile.json"), "utf8"))
      const name = (profile?.accounts ?? []).find((a) => typeof a?.name === "string")?.name
      const id = typeof name === "string" ? name.match(/^accounts\/([^/]+)$/)?.[1] : undefined
      if (id) result.accountId = id
    } catch {}
  }
  return result
}

/** The REST base the CLI uses: its gateway override, else Fireworks. */
export function gatewayBase(env = process.env) {
  const base = env.NEXUS_GATEWAY_URL?.trim() || "https://api.fireworks.ai"
  return base.replace(/\/+$/, "")
}

// ---------------------------------------------------------------------------
// response shaping (mirrors the desktop app's usage.mjs semantics)
// ---------------------------------------------------------------------------

/** The plan that hasn't ended, if any: an account has at most one. */
export function currentPlan(plans) {
  const plan = (plans ?? []).find((candidate) => candidate?.state && candidate.state !== "ENDED")
  if (!plan || !TIERS[plan.tier]) return null
  return {
    tier: TIERS[plan.tier],
    state: plan.state,
    periodStart: plan.currentPeriodStartTime ?? null,
    periodEnd: plan.currentPeriodEndTime ?? null,
  }
}

const windowOf = (window) => (window
  ? {
      usedPercent: Number(window.usedPercent ?? 0),
      startTime: window.startTime ?? null,
      endTime: window.endTime ?? null,
    }
  : null)

/** Pro/Teams seat usage: monthly + 5-hour rolling (session) window percents. */
export function seatUsage(usage) {
  if (!usage?.monthly) return null
  return { monthly: windowOf(usage.monthly), session: windowOf(usage.rollingWindow) }
}

/** gRPC status code in an error body; 9 = FAILED_PRECONDITION. */
async function apiError(response) {
  const body = await response.json().catch(() => null)
  const error = new Error(
    response.status === 401 || response.status === 403
      ? "Fireworks didn't accept this key for usage."
      : `Fireworks answered ${response.status}.`)
  error.status = response.status
  error.code = body?.code
  return error
}

/**
 * Read Overview's numbers with the stored key. Every part is read on its own,
 * so one failing read leaves the others on screen — the same per-part failure
 * policy as the desktop app's Overview.
 */
export async function readUsage({ key, accountId, userName, fetch: fetchImpl = globalThis.fetch, base = gatewayBase(), now = new Date() } = {}) {
  const failed = (error) => ({ error: error?.name === "TimeoutError" ? "Fireworks took too long to answer." : error?.message || "Couldn't reach Fireworks." })

  const call = async (path, init = {}) => {
    const headers = { Authorization: `Bearer ${key}` }
    if (init.body) headers["Content-Type"] = "application/json"
    const response = await fetchImpl(`${base}/v1/${path}`, {
      ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw await apiError(response)
    return response.json()
  }

  const result = { ok: true, checkedAt: now.toISOString(), plan: null, planError: null, seat: null, seatError: null }
  const account = accountId ? `accounts/${accountId}` : undefined
  const user = userName && /^accounts\/[^/]+\/users\/[^/]+$/.test(userName) ? userName : undefined

  const planPromise = account
    ? call(`${account}/nexusPlans?pageSize=10`).then((body) => currentPlan(body.nexusPlans)).catch(failed)
    : Promise.resolve({ error: "No Nexus account found on this machine." })
  result.plan = await planPromise

  const tier = result.plan && !result.plan.error ? result.plan.tier : null
  // Pro and Teams show the month and the session. Fireworks answers Enterprise
  // FAILED_PRECONDITION ("no active Pro or Team plan"), so it isn't asked.
  const seat = (tier === "pro" || tier === "teams")
    ? (user
        ? call(`${user}/nexusPlanUsage`).then((body) => seatUsage(body)).catch(failed)
        : Promise.resolve({ error: "No Nexus user path known; sign in with the Nexus app." }))
    : Promise.resolve(null)

  result.seat = await seat
  return result
}

// ---------------------------------------------------------------------------
// web routes
// ---------------------------------------------------------------------------

function sendJson(res, code, payload) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(payload))
}

export function apply(ctx, config) {
  const cfg = config ?? {}
  if (cfg.enabled === false) return

  let cache = { at: 0, value: null }
  let inflight = null
  let key = undefined

  async function ensureKey() {
    if (key) return key
    key = cfg.apiKey || process.env.FIREWORKS_NEXUS_KEY || await readKeychainKey()
    return key
  }

  async function snapshot() {
    const now = new Date()
    if (cache.value && now.getTime() - cache.at < CACHE_TTL_MS) return cache.value
    if (!inflight) {
      inflight = (async () => {
        try {
          const identity = await readNexusIdentity()
          const value = await readUsage({
            key: await ensureKey(),
            accountId: identity.accountId,
            userName: identity.userName,
            base: cfg.gatewayBase || gatewayBase(),
          })
          cache = { at: Date.now(), value }
          return value
        } finally {
          inflight = null
        }
      })()
    }
    return inflight
  }

  const routes = [
    {
      kind: "exact",
      path: `${API_PREFIX}/usage`,
      handler: async (req, res) => {
        try {
          const value = await snapshot()
          // A stored key can be revoked; forget it so the next read re-mints from the keychain.
          if (value?.seatError?.status === 401 || value?.planError?.status === 401) key = undefined
          sendJson(res, 200, value)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    },
  ]

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

const __testing = { currentPlan, seatUsage, gatewayBase, readNexusIdentity, readUsage }

export { __testing, API_PREFIX, inject }
