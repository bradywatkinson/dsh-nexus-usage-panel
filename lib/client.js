// dsh-nexus-usage-panel — client half.
// Renders the Fireworks Nexus usage dashboard ("This month — N% used · Resets
// …", "N% Current session · Resets at …") as a "Nexus Usage" settings page in
// the DSH Web GUI, mirroring the Nexus desktop app's Overview card. Reads the
// host half's /api/dsh-nexus-usage/usage route; no other data source.
window.__ModuleLoader__.load({
	id: "dsh-nexus-usage-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		const API_PREFIX = "/api/dsh-nexus-usage";

		// Nexus-dark palette; stays legible in either DSH theme.
		const COLORS = {
			cardBg: "rgba(147, 51, 104, 0.16)",
			cardBorder: "rgba(236, 72, 153, 0.22)",
			label: "var(--dsw-alias-label-primary, inherit)",
			muted: "var(--dsw-alias-label-tertiary, rgba(128,128,128,0.9))",
			pink: "#ec4899",
			pinkDim: "rgba(236, 72, 153, 0.25)",
		};

		const fetchUsage = () => fetch(`${API_PREFIX}/usage`, { credentials: "same-origin" })
			.then((r) => r.json());

		// Last successful usage snapshot, shared across mounts of the card so
		// reopening the settings page paints instantly and refreshes in the
		// background instead of showing a blank "Loading" state.
		const USAGE_CACHE_TTL_MS = 30_000; // within this window a refetch is skipped entirely
		let usageCache = null; // { usage, cachedAt }

		const isUsageCacheFresh = () => !!usageCache && Date.now() - usageCache.cachedAt < USAGE_CACHE_TTL_MS;

		/** Initial card state: cached data paints immediately when present. */
		function initialUsageState() {
			if (usageCache) {
				return { loading: false, refreshing: !isUsageCacheFresh(), usage: usageCache.usage, error: null };
			}
			return { loading: true, refreshing: false, usage: null, error: null };
		}

		/** "Thu, Dec 3" in the viewer's locale/timezone. */
		function formatResetDate(iso) {
			if (!iso) return "";
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return "";
			return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
		}

		/** "9:17 PM" in the viewer's locale/timezone. */
		function formatResetTime(iso) {
			if (!iso) return "";
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return "";
			return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
		}

		const percentLabel = (value) => `${(Number(value) || 0).toFixed(value != null && value < 10 ? 1 : 0).replace(/\.0$/, "")}%`;

		/** "$1.23" in the row's currency. */
		function moneyLabel(amount, currency = "USD") {
			try {
				return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount) || 0);
			} catch {
				return `$${(Number(amount) || 0).toFixed(2)}`;
			}
		}

		function Meter({ fraction, height = 6 }) {
			const pct = Math.max(0, Math.min(1, Number(fraction) || 0)) * 100;
			return react_jsx_runtime.jsx("div", {
				style: { background: COLORS.pinkDim, borderRadius: 999, height, overflow: "hidden", width: "100%" },
				children: react_jsx_runtime.jsx("div", {
					style: { background: COLORS.pink, borderRadius: 999, height: "100%", minWidth: pct > 0 ? 8 : 0, transition: "width .3s ease", width: `${pct}%` },
				}),
			});
		}

		function TierBadge({ tier }) {
			if (!tier) return null;
			const label = tier.charAt(0).toUpperCase() + tier.slice(1);
			return react_jsx_runtime.jsx("span", {
				style: {
					background: "rgba(236, 72, 153, 0.25)", borderRadius: 6, color: "#f9a8d4",
					fontSize: 11, fontWeight: 600, letterSpacing: "0.02em", padding: "2px 8px",
				},
				children: label,
			});
		}

		/** One window's row: percent big, "used · Resets …" beside it, meter below. */
		function WindowRow({ percent, resetAt, kind }) {
			const isSession = kind === "session";
			const reset = isSession ? formatResetTime(resetAt) : formatResetDate(resetAt);
			return react_jsx_runtime.jsxs("div", { children: [
				react_jsx_runtime.jsxs("div", { style: { alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 6 }, children: [
					react_jsx_runtime.jsx("span", {
						style: { color: COLORS.label, fontSize: isSession ? 15 : 24, fontWeight: 700 },
						children: `${percentLabel(percent)}${isSession ? "" : ""}`,
					}),
					react_jsx_runtime.jsxs("span", { style: { color: COLORS.muted, fontSize: 13 }, children: [
						isSession ? "Current session" : "used",
						reset ? ` · Resets ${isSession ? "at " : ""}${reset}` : "",
					] }),
				] }),
				react_jsx_runtime.jsx("div", { style: { marginTop: isSession ? 0 : 8 }, children:
					isSession
						? null
						: react_jsx_runtime.jsx(Meter, { fraction: (Number(percent) || 0) / 100 }),
				}),
			] });
		}

		/** Tiny per-day spend bars (live savings pipeline), tallest day full height. */
		function SpendTrend({ spend }) {
			const days = spend?.days ?? [];
			if (!days.length) return null;
			const max = Math.max(...days.map((d) => d.total)) || 1;
			return react_jsx_runtime.jsxs("div", { style: { marginTop: 10 }, children: [
				react_jsx_runtime.jsxs("div", { style: { color: COLORS.muted, display: "flex", fontSize: 11, gap: 6, justifyContent: "space-between" }, children: [
					react_jsx_runtime.jsx("span", { children: "Daily spend · live" }),
					react_jsx_runtime.jsx("span", { children: `${days[0].date.slice(5)} → ${days[days.length - 1].date.slice(5)}` }),
				] }),
				react_jsx_runtime.jsx("div", { style: { alignItems: "flex-end", display: "flex", gap: 3, height: 30, marginTop: 4 }, children:
					days.map(({ date, total }) => react_jsx_runtime.jsx("div", {
						style: {
							background: COLORS.pink, borderRadius: 3, flex: 1, minHeight: 3,
							opacity: 0.85, height: `${Math.max(4, (total / max) * 100)}%`,
						},
						title: `${date}: ${moneyLabel(total, spend.currency)}`,
					}, date)),
				}),
			] });
		}

		/** Per-model spend rows for the billing period (usageCosts DAY+MODEL, SELF).
		  * While Fireworks' attribution pipeline lags (INCOMPLETE, no rows yet), the
		  * live spend total + daily trend from the savings pipeline still show. */
		function BreakdownSection({ breakdown, spend }) {
			const hasSpend = !!spend?.days?.length;
			if (!breakdown || breakdown.error) {
				if (!hasSpend) return null;
				return react_jsx_runtime.jsx("div", { style: { borderTop: "1px solid rgba(236,72,153,0.18)", marginTop: 16, paddingTop: 14 }, children:
					react_jsx_runtime.jsx(SpendTrend, { spend }) });
			}
			const models = breakdown.models ?? [];
			const windowLabel = breakdown.widened ? "last 30 days" : "this period";
			const header = react_jsx_runtime.jsxs("div", { style: { alignItems: "baseline", display: "flex", gap: 8, justifyContent: "space-between" }, children: [
				react_jsx_runtime.jsx("span", { style: { fontSize: 13, fontWeight: 600, opacity: 0.9 }, children: "Spend by model" }),
				react_jsx_runtime.jsx("span", { style: { color: COLORS.muted, fontSize: 12 }, children: models.length
					? `${moneyLabel(breakdown.total, breakdown.currency)} ${windowLabel}`
					: hasSpend ? `${moneyLabel(spend.total, spend.currency)} this month · live` : null }),
			] });
			if (!models.length) {
				return react_jsx_runtime.jsxs("div", { style: { borderTop: "1px solid rgba(236,72,153,0.18)", marginTop: 16, paddingTop: 14 }, children: [
					header,
					react_jsx_runtime.jsx("div", { style: { color: COLORS.muted, fontSize: 12, marginTop: 6 }, children:
						"Model attribution pending — Fireworks fills in per-model spend with a few hours' billing lag." }),
					hasSpend ? react_jsx_runtime.jsx(SpendTrend, { spend }) : null,
				] });
			}
			const max = models[0]?.total || 1;
			return react_jsx_runtime.jsxs("div", { style: { borderTop: "1px solid rgba(236,72,153,0.18)", marginTop: 16, paddingTop: 14 }, children: [
				header,
				react_jsx_runtime.jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }, children:
					models.map(({ model, total }) => react_jsx_runtime.jsxs("div", { children: [
						react_jsx_runtime.jsxs("div", { style: { alignItems: "baseline", display: "flex", justifyContent: "space-between" }, children: [
							react_jsx_runtime.jsx("span", { style: { fontSize: 12, opacity: 0.9 }, children: model }),
							react_jsx_runtime.jsx("span", { style: { color: COLORS.muted, fontSize: 12 }, children: moneyLabel(total, breakdown.currency) }),
						] }),
						react_jsx_runtime.jsx("div", { style: { marginTop: 3 }, children: react_jsx_runtime.jsx(Meter, { fraction: total / max, height: 4 }) }),
					], key: model })),
				}),
				hasSpend ? react_jsx_runtime.jsx(SpendTrend, { spend }) : null,
			] });
		}

		/** Savings vs the baseline model + cache hit rate (usageSavings, SELF). */
		function SavingsLine({ savings }) {
			if (!savings || savings.status !== "ready" || !savings.month) return null;
			const { saved, savedFraction, cacheHitFraction, currency } = savings.month;
			if (!saved && cacheHitFraction == null) return null;
			const parts = [];
			if (saved) parts.push(`Est. savings ${moneyLabel(saved, currency)} vs ${savings.baselineLabel}`);
			if (savedFraction != null) parts.push(`${percentLabel(savedFraction * 100)} off`);
			if (cacheHitFraction != null) parts.push(`cache hit ${percentLabel(cacheHitFraction * 100)}`);
			return react_jsx_runtime.jsx("div", {
				style: { color: "#f9a8d4", fontSize: 12, marginTop: 14, opacity: 0.9 },
				children: parts.join(" · "),
			});
		}

		/** The card: "This month" header + tier badge, then month and session rows. */
		function UsageCard() {
			const [state, setState] = react.useState(initialUsageState);
			react.useEffect(() => {
				let alive = true;
				const tick = () => {
					setState((prev) => ({ ...prev, refreshing: true }));
					fetchUsage().then((usage) => {
						if (!alive) return;
						if (usage && usage.ok !== false) usageCache = { usage, cachedAt: Date.now() };
						setState({ loading: false, refreshing: false, usage, error: usage?.ok === false ? usage.error : null });
					}).catch((error) => {
						if (!alive) return;
						// A failed refresh keeps the cached card on screen; only a
						// cold start (no cached data) falls back to the error state.
						const message = String(error?.message ?? error);
						setState((prev) => prev.usage
							? { ...prev, refreshing: false }
							: { loading: false, usage: null, error: message });
					});
				};
				// Fresh cache: skip the refetch, the 60s poll picks it up soon enough.
				if (!isUsageCacheFresh()) tick();
				const timer = setInterval(tick, 60_000);
				return () => { alive = false; clearInterval(timer); };
			}, []);

			if (state.loading) {
				return react_jsx_runtime.jsx("div", { style: { color: COLORS.muted, padding: 24 }, children: "Loading Nexus usage…" });
			}

			const usage = state.usage;
			const seat = usage?.seat;
			const plan = usage?.plan && !usage.plan.error ? usage.plan : null;

			if (!usage || usage.ok === false || (!seat && !plan)) {
				return react_jsx_runtime.jsxs("div", { style: { color: COLORS.muted, padding: 24 }, children: [
					"Couldn't read Nexus usage.",
					(usage?.planError?.error || usage?.seatError?.error || state.error)
						? react_jsx_runtime.jsx("div", { style: { fontSize: 12, marginTop: 6 }, children: usage?.planError?.error || usage?.seatError?.error || state.error })
						: null,
					react_jsx_runtime.jsx("div", { style: { fontSize: 12, marginTop: 6 }, children: "Sign in to the Nexus desktop app first — this panel reads the same key." }),
				] });
			}

			return react_jsx_runtime.jsx("div", {
				style: {
					background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 16,
					color: COLORS.label, maxWidth: 760, padding: "20px 24px",
				},
				children: react_jsx_runtime.jsxs("div", { children: [
					react_jsx_runtime.jsxs("div", { style: { alignItems: "center", display: "flex", justifyContent: "space-between" }, children: [
						react_jsx_runtime.jsx("span", { style: { fontSize: 14, fontWeight: 600, opacity: 0.9 }, children: "This month" }),
						react_jsx_runtime.jsxs("span", { style: { alignItems: "center", display: "flex", gap: 8 }, children: [
							state.refreshing ? react_jsx_runtime.jsx("span", {
								style: { color: COLORS.muted, fontSize: 11 },
								children: "⟳ Updating…",
							}) : null,
							react_jsx_runtime.jsx(TierBadge, { tier: plan?.tier }),
						] }),
					] }),
					plan?.error ? react_jsx_runtime.jsx("div", { style: { color: COLORS.muted, fontSize: 12, marginTop: 4 }, children: plan.error }) : null,
					react_jsx_runtime.jsx("div", { style: { marginTop: 8 }, children: seat
						? react_jsx_runtime.jsx(WindowRow, { kind: "monthly", percent: seat.monthly?.usedPercent, resetAt: seat.monthly?.endTime })
						: react_jsx_runtime.jsx("div", { style: { color: COLORS.muted, fontSize: 13 }, children: seat?.error || "No seat usage reported." }) }),
					seat?.session ? react_jsx_runtime.jsxs("div", { style: {
						borderTop: "1px solid rgba(236,72,153,0.18)", marginTop: 16, paddingTop: 14,
						alignItems: "center", display: "flex", gap: 16,
					}, children: [
						react_jsx_runtime.jsx("div", { style: { flex: "0 0 auto" }, children:
							react_jsx_runtime.jsx(WindowRow, { kind: "session", percent: seat.session.usedPercent, resetAt: seat.session.endTime }) }),
						react_jsx_runtime.jsx("div", { style: { flex: 1 }, children: react_jsx_runtime.jsx(Meter, { fraction: (Number(seat.session.usedPercent) || 0) / 100 }) }),
					] }) : null,
					react_jsx_runtime.jsx(BreakdownSection, { breakdown: usage.breakdown, spend: usage.savings?.spend }),
					react_jsx_runtime.jsx(SavingsLine, { savings: usage.savings }),
				] }),
			});
		}

		//#region client plugin
		/** Required services (cordis fiber inject): the settings page slot ledger. */
		const inject = ["slots"];

		/** Register the "Nexus Usage" settings page once the slot ledger is up. */
		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-nexus-usage-panel",
				order: 40,
				label: () => "Nexus Usage",
			}, UsageCard));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		// Test hooks only: seed/clear the usage snapshot cache from test scripts.
		exports.__testing = {
			setUsageCache: (usage, cachedAt = Date.now()) => { usageCache = { usage, cachedAt }; },
			clearUsageCache: () => { usageCache = null; },
		};
		return module.exports;
	}
});
