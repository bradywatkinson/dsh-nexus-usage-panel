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
			const pct = Math.max(0, Math.min(100, fraction));
			return jsx_runtime.jsx("div", {
				style: { background: COLORS.pinkDim, borderRadius: 999, height, overflow: "hidden", width: "100%" },
				children: jsx_runtime.jsx("div", {
					style: { background: COLORS.pink, borderRadius: 999, height: "100%", minWidth: pct > 0 ? 8 : 0, transition: "width .3s ease", width: `${pct}%` },
				}),
			});
		}

		function TierBadge({ tier }) {
			if (!tier) return null;
			const label = tier.charAt(0).toUpperCase() + tier.slice(1);
			return jsx_runtime.jsx("span", {
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
			return jsx_runtime.jsxs("div", { children: [
				jsx_runtime.jsxs("div", { style: { alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 6 }, children: [
					jsx_runtime.jsx("span", {
						style: { color: COLORS.label, fontSize: isSession ? 15 : 24, fontWeight: 700 },
						children: `${percentLabel(percent)}${isSession ? "" : ""}`,
					}),
					jsx_runtime.jsxs("span", { style: { color: COLORS.muted, fontSize: 13 }, children: [
						isSession ? "Current session" : "used",
						reset ? ` · Resets ${isSession ? "at " : ""}${reset}` : "",
					] }),
				] }),
				jsx_runtime.jsx("div", { style: { marginTop: isSession ? 0 : 8 }, children:
					isSession
						? null
						: jsx_runtime.jsx(Meter, { fraction: (Number(percent) || 0) / 100 }),
				}),
			] });
		}

		/** Per-model spend rows for the billing period (usageCosts DAY+MODEL, SELF). */
		function BreakdownSection({ breakdown }) {
			if (!breakdown || breakdown.error) return null;
			const models = breakdown.models ?? [];
			if (!models.length) {
				return jsx_runtime.jsxs("div", { style: { borderTop: "1px solid rgba(236,72,153,0.18)", marginTop: 16, paddingTop: 14 }, children: [
					jsx_runtime.jsx("div", { style: { fontSize: 13, fontWeight: 600, opacity: 0.9 }, children: "Spend by model" }),
					jsx_runtime.jsx("div", { style: { color: COLORS.muted, fontSize: 12, marginTop: 6 }, children:
						"Breakdown appears after Fireworks attributes spend — it lags the meters by a few hours." }),
				] });
			}
			const max = models[0]?.total || 1;
			return jsx_runtime.jsxs("div", { style: { borderTop: "1px solid rgba(236,72,153,0.18)", marginTop: 16, paddingTop: 14 }, children: [
				jsx_runtime.jsxs("div", { style: { alignItems: "baseline", display: "flex", gap: 8 }, children: [
					jsx_runtime.jsx("span", { style: { fontSize: 13, fontWeight: 600, opacity: 0.9 }, children: "Spend by model" }),
					jsx_runtime.jsx("span", { style: { color: COLORS.muted, fontSize: 12 }, children: `${moneyLabel(breakdown.total, breakdown.currency)} this period` }),
				] }),
				jsx_runtime.jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }, children:
					models.map(({ model, total }) => jsx_runtime.jsxs("div", { children: [
						jsx_runtime.jsxs("div", { style: { alignItems: "baseline", display: "flex", justifyContent: "space-between" }, children: [
							jsx_runtime.jsx("span", { style: { fontSize: 12, opacity: 0.9 }, children: model }),
							jsx_runtime.jsx("span", { style: { color: COLORS.muted, fontSize: 12 }, children: moneyLabel(total, breakdown.currency) }),
						] }),
						jsx_runtime.jsx("div", { style: { marginTop: 3 }, children: jsx_runtime.jsx(Meter, { fraction: (total / max) * 100, height: 4 }) }),
					], key: model })),
				}),
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
			return jsx_runtime.jsx("div", {
				style: { color: "#f9a8d4", fontSize: 12, marginTop: 14, opacity: 0.9 },
				children: parts.join(" · "),
			});
		}

		/** The card: "This month" header + tier badge, then month and session rows. */
		function UsageCard() {
			const [state, setState] = react.useState({ loading: true, usage: null, error: null });
			react.useEffect(() => {
				let alive = true;
				const tick = () => {
					fetchUsage().then((usage) => {
						if (alive) setState({ loading: false, usage, error: usage?.ok === false ? usage.error : null });
					}).catch((error) => {
						if (alive) setState({ loading: false, usage: null, error: String(error?.message ?? error) });
					});
				};
				tick();
				const timer = setInterval(tick, 60_000);
				return () => { alive = false; clearInterval(timer); };
			}, []);

			if (state.loading) {
				return jsx_runtime.jsx("div", { style: { color: COLORS.muted, padding: 24 }, children: "Loading Nexus usage…" });
			}

			const usage = state.usage;
			const seat = usage?.seat;
			const plan = usage?.plan && !usage.plan.error ? usage.plan : null;

			if (!usage || usage.ok === false || (!seat && !plan)) {
				return jsx_runtime.jsxs("div", { style: { color: COLORS.muted, padding: 24 }, children: [
					"Couldn't read Nexus usage.",
					(usage?.planError?.error || usage?.seatError?.error || state.error)
						? jsx_runtime.jsx("div", { style: { fontSize: 12, marginTop: 6 }, children: usage?.planError?.error || usage?.seatError?.error || state.error })
						: null,
					jsx_runtime.jsx("div", { style: { fontSize: 12, marginTop: 6 }, children: "Sign in to the Nexus desktop app first — this panel reads the same key." }),
				] });
			}

			return jsx_runtime.jsx("div", {
				style: {
					background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 16,
					color: COLORS.label, maxWidth: 760, padding: "20px 24px",
				},
				children: jsx_runtime.jsxs("div", { children: [
					jsx_runtime.jsxs("div", { style: { alignItems: "center", display: "flex", justifyContent: "space-between" }, children: [
						jsx_runtime.jsx("span", { style: { fontSize: 14, fontWeight: 600, opacity: 0.9 }, children: "This month" }),
						jsx_runtime.jsx(TierBadge, { tier: plan?.tier }),
					] }),
					plan?.error ? jsx_runtime.jsx("div", { style: { color: COLORS.muted, fontSize: 12, marginTop: 4 }, children: plan.error }) : null,
					jsx_runtime.jsx("div", { style: { marginTop: 8 }, children: seat
						? jsx_runtime.jsx(WindowRow, { kind: "monthly", percent: seat.monthly?.usedPercent, resetAt: seat.monthly?.endTime })
						: jsx_runtime.jsx("div", { style: { color: COLORS.muted, fontSize: 13 }, children: seat?.error || "No seat usage reported." }) }),
					seat?.session ? jsx_runtime.jsxs("div", { style: {
						borderTop: "1px solid rgba(236,72,153,0.18)", marginTop: 16, paddingTop: 14,
						alignItems: "center", display: "flex", gap: 16,
					}, children: [
						jsx_runtime.jsx("div", { style: { flex: "0 0 auto" }, children:
							jsx_runtime.jsx(WindowRow, { kind: "session", percent: seat.session.usedPercent, resetAt: seat.session.endTime }) }),
						jsx_runtime.jsx("div", { style: { flex: 1 }, children: jsx_runtime.jsx(Meter, { fraction: (Number(seat.session.usedPercent) || 0) / 100 }) }),
					] }) : null,
					jsx_runtime.jsx(BreakdownSection, { breakdown: usage.breakdown }),
					jsx_runtime.jsx(SavingsLine, { savings: usage.savings }),
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
		return module.exports;
	}
});
