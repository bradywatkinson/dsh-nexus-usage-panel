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

		// Daily-spend display style: "grid" (GitHub-style event grid, the
		// default) or "table". The saved choice is read once per page load and
		// POSTed on change; until it lands the card shows the grid default.
		const fetchConfig = () => fetch(`${API_PREFIX}/config`, { credentials: "same-origin" })
			.then((r) => r.json());

		const saveConfig = (spendStyle) => fetch(`${API_PREFIX}/config`, {
			credentials: "same-origin", method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ spendStyle }),
		}).then((r) => r.json());

		// The in-page choice made through the picker: it wins over the saved
		// config for this page load, so the toggle works even while the host
		// half (which persists the setting) is not yet serving the route.
		let sessionStyle = null;
		let styleConfigPromise = null;
		const loadStyleConfig = () => {
			if (sessionStyle) return Promise.resolve(sessionStyle);
			if (!styleConfigPromise) {
				styleConfigPromise = fetchConfig()
					.then((config) => (config?.spendStyle === "table" ? "table" : "grid"))
					.catch(() => "grid");
			}
			return styleConfigPromise;
		};

		// Last successful usage snapshot, shared across mounts of the card so
		// reopening the settings page paints instantly and refreshes in the
		// background instead of showing a blank "Loading" state.
		const USAGE_CACHE_TTL_MS = 30_000; // within this window a refetch is skipped entirely
		let usageCache = null; // { usage, cachedAt }

		const isUsageCacheFresh = () => !!usageCache && Date.now() - usageCache.cachedAt < USAGE_CACHE_TTL_MS;

		/** Initial card state: cached data paints immediately when present. */
		function initialUsageState() {
			if (usageCache) {
				return { loading: false, refreshing: !isUsageCacheFresh(), usage: usageCache.usage, error: null, spendStyle: sessionStyle };
			}
			return { loading: true, refreshing: false, usage: null, error: null, spendStyle: sessionStyle };
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

		/** "Thu, Dec 3" for a YYYY-MM-DD day key (noon-anchored so TZ shifts can't move the date). */
		function formatDayLabel(iso) {
			const date = new Date(`${iso}T12:00:00`);
			if (Number.isNaN(date.getTime())) return iso;
			return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
		}

		// Contribution-grid palette: Nexus pink, five intensity steps (0 = no spend).
		const GRID_LEVELS = [
			"rgba(236, 72, 153, 0.08)",
			"rgba(236, 72, 153, 0.35)",
			"rgba(236, 72, 153, 0.60)",
			"#ec4899",
			"#be185d",
		];
		const GRID_CELL = 13; // square cell px, GitHub-style
		const GRID_GAP = 3;

		/** Local YYYY-MM-DD for a Date, matching the host's day keys. */
		function dayKeyOf(date) {
			return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		}

		/** Weeks (columns) of 7 day cells covering the spend window, Sunday-aligned like GitHub's grid. Days outside the window render as placeholders. */
		function spendWeeks(days) {
			const totals = new Map(days.map((day) => [day.date, Number(day.total) || 0]));
			const first = new Date(`${days[0].date}T12:00:00`);
			const last = new Date(`${days[days.length - 1].date}T12:00:00`);
			const start = new Date(first);
			start.setDate(start.getDate() - start.getDay());
			const weeks = [];
			for (let cursor = new Date(start); cursor <= last; cursor.setDate(cursor.getDate() + 7)) {
				const week = [];
				for (let offset = 0; offset < 7; offset += 1) {
					const day = new Date(cursor);
					day.setDate(day.getDate() + offset);
					const key = dayKeyOf(day);
					week.push({ key, total: totals.get(key) ?? 0, inWindow: day >= first && day <= last });
				}
				weeks.push(week);
			}
			return weeks;
		}

		/** Intensity bucket 0–4 for a day's spend against the window max. */
		function spendLevel(total, max) {
			if (!total) return 0;
			const ratio = total / (max || 1);
			if (ratio <= 0.25) return 1;
			if (ratio <= 0.5) return 2;
			if (ratio <= 0.75) return 3;
			return 4;
		}

		/** Hover-tooltip CSS for the grid cells, injected once per page. */
		let tooltipStylesReady = false;
		function ensureTooltipStyles() {
			if (tooltipStylesReady || typeof document === "undefined" || !document.head) return;
			tooltipStylesReady = true;
			const style = document.createElement("style");
			style.id = "dsh-nexus-usage-tooltip";
			style.textContent = [
				".dsh-nexus-tip{position:relative}",
				".dsh-nexus-tip:hover{z-index:2}",
				".dsh-nexus-tip::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 5px);left:50%;transform:translateX(-50%);"
					+ "background:rgba(59,15,42,0.96);border:1px solid rgba(236,72,153,0.4);border-radius:6px;"
					+ "box-shadow:0 4px 12px rgba(0,0,0,0.35);color:#f9a8d4;font-size:11px;font-weight:500;"
					+ "line-height:1.4;padding:3px 7px;white-space:nowrap;opacity:0;pointer-events:none;"
					+ "transition:opacity .12s ease .18s}",
				".dsh-nexus-tip:hover::after{opacity:1}",
			].join("\n");
			document.head.appendChild(style);
		}

		/** GitHub-style contribution grid of the daily spend, Nexus-pink heat levels. */
		function SpendGrid({ spend }) {
			const days = spend?.days ?? [];
			if (!days.length) return null;
			ensureTooltipStyles();
			const weeks = spendWeeks(days);
			const max = Math.max(...days.map((day) => Number(day.total) || 0)) || 1;
			const cell = (level) => ({ background: GRID_LEVELS[level], borderRadius: 3, height: GRID_CELL, width: GRID_CELL });
			// Month labels appear above the column where the month changes, as on GitHub.
			const monthLabels = [];
			let previousMonth = null;
			const columns = weeks.map((week, index) => {
				const monthStart = new Date(`${week[0].key}T12:00:00`);
				const month = monthStart.getMonth();
				monthLabels.push(month !== previousMonth ? monthStart.toLocaleDateString(undefined, { month: "short" }) : "");
				previousMonth = month;
				return react_jsx_runtime.jsx("div", { style: { display: "flex", flexDirection: "column", gap: GRID_GAP }, children:
					week.map(({ key, total, inWindow }) => (inWindow
						? react_jsx_runtime.jsx("div", {
							className: "dsh-nexus-tip",
							"data-tip": `${formatDayLabel(key)} · ${total ? moneyLabel(total, spend.currency) : "no spend"}`,
							style: cell(spendLevel(total, max)),
						}, key)
						: react_jsx_runtime.jsx("div", { style: { ...cell(0), background: "transparent" } }, key))),
				}, `week-${index}`);
			});
			const weekdayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];
			return react_jsx_runtime.jsxs("div", {
				style: { display: "flex", flexDirection: "column", gap: 4, marginTop: 6 },
				children: [
					react_jsx_runtime.jsxs("div", { style: { display: "flex", gap: GRID_GAP }, children: [
						react_jsx_runtime.jsx("div", { style: { display: "flex", flexDirection: "column", gap: GRID_GAP, width: 26 }, children:
							weekdayLabels.map((label, index) => react_jsx_runtime.jsx("div", {
								style: { color: COLORS.muted, fontSize: 9, height: GRID_CELL, lineHeight: `${GRID_CELL}px` },
								children: label,
							}, `weekday-${index}`)) }),
						react_jsx_runtime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [
							react_jsx_runtime.jsxs("div", { style: { display: "flex", gap: GRID_GAP }, children: [
								react_jsx_runtime.jsx("div", { style: { width: 0 }, children: "" }),
								...monthLabels.map((label, index) => react_jsx_runtime.jsx("div", {
									style: { color: COLORS.muted, fontSize: 9, overflow: "visible", whiteSpace: "nowrap", width: GRID_CELL },
									children: label,
								}, `month-${index}`)),
							] }),
							react_jsx_runtime.jsx("div", { role: "img", "aria-label": `Daily spend ${days[0].date} through ${days[days.length - 1].date}`, style: { display: "flex", gap: GRID_GAP }, children: columns }),
						] }),
					] }),
					react_jsx_runtime.jsxs("div", { style: { alignItems: "center", display: "flex", gap: 6, justifyContent: "space-between", marginTop: 2 }, children: [
						react_jsx_runtime.jsx("span", { style: { color: COLORS.muted, fontSize: 11, fontVariantNumeric: "tabular-nums" }, children: `Total ${moneyLabel(spend.total, spend.currency)}` }),
						react_jsx_runtime.jsxs("div", { style: { alignItems: "center", display: "flex", gap: 3 }, children: [
							react_jsx_runtime.jsx("span", { style: { color: COLORS.muted, fontSize: 10 }, children: "Less" }),
							...GRID_LEVELS.map((color, index) => react_jsx_runtime.jsx("div", { style: { background: color, borderRadius: 2, height: 9, width: 9 } }, `legend-${index}`)),
							react_jsx_runtime.jsx("span", { style: { color: COLORS.muted, fontSize: 10 }, children: "More" }),
						] }),
					] }),
				],
			});
		}

		/** Grid/Table picker for the daily-spend section. */
		function StyleToggle({ style, onStyleChange }) {
			const option = (value, glyph, label) => react_jsx_runtime.jsx("button", {
				"aria-label": label,
				"aria-pressed": style === value,
				onClick: () => onStyleChange(value),
				style: {
					background: style === value ? "rgba(236, 72, 153, 0.25)" : "transparent",
					border: `1px solid ${style === value ? COLORS.pink : COLORS.pinkDim}`,
					borderRadius: 6, color: style === value ? "#f9a8d4" : COLORS.muted,
					cursor: "pointer", fontSize: 10, lineHeight: 1, padding: "3px 6px",
				},
				title: label,
				type: "button",
				children: glyph,
			}, value);
			return react_jsx_runtime.jsxs("div", { style: { display: "flex", gap: 4 }, children: [
				option("grid", "▦", "Grid view"),
				option("table", "☰", "Table view"),
			] });
		}

		/** Per-day spend table (live savings pipeline), newest day last. */
		function SpendTable({ spend }) {
			const days = spend?.days ?? [];
			if (!days.length) return null;
			const rowStyle = { display: "flex", justifyContent: "space-between", padding: "3px 0" };
			return react_jsx_runtime.jsx("div", {
				style: { borderTop: "1px solid rgba(236,72,153,0.18)", fontSize: 12, marginTop: 6 },
				role: "table",
				children: [
					react_jsx_runtime.jsxs("div", { role: "row", style: { ...rowStyle, color: COLORS.muted, fontSize: 11 }, children: [
						react_jsx_runtime.jsx("span", { role: "columnheader", children: "Day" }),
						react_jsx_runtime.jsx("span", { role: "columnheader", children: "Spend" }),
					] }, "header"),
					days.map(({ date, total }) => react_jsx_runtime.jsxs("div", { role: "row", style: { ...rowStyle, borderBottom: "1px solid rgba(236,72,153,0.12)" }, children: [
						react_jsx_runtime.jsx("span", { role: "cell", children: formatDayLabel(date) }),
						react_jsx_runtime.jsx("span", { role: "cell", style: { color: COLORS.muted, fontVariantNumeric: "tabular-nums" }, children: moneyLabel(total, spend.currency) }),
					] }, date)),
					react_jsx_runtime.jsxs("div", { role: "row", style: { ...rowStyle, fontWeight: 600 }, children: [
						react_jsx_runtime.jsx("span", { role: "cell", children: "Total" }),
						react_jsx_runtime.jsx("span", { role: "cell", style: { fontVariantNumeric: "tabular-nums" }, children: moneyLabel(spend.total, spend.currency) }),
					] }, "total"),
				],
			});
		}

		/** Daily spend section (live savings pipeline): GitHub-style grid by
		  * default, table on the saved preference; the picker persists the choice. */
		function SpendTrend({ spend, style, onStyleChange }) {
			const days = spend?.days ?? [];
			if (!days.length) return null;
			return react_jsx_runtime.jsxs("div", { style: { marginTop: 10 }, children: [
				react_jsx_runtime.jsxs("div", { style: { color: COLORS.muted, display: "flex", fontSize: 11, gap: 6, justifyContent: "space-between" }, children: [
					react_jsx_runtime.jsx("span", { children: "Daily spend · live" }),
					react_jsx_runtime.jsxs("div", { style: { alignItems: "center", display: "flex", gap: 8 }, children: [
						react_jsx_runtime.jsx("span", { children: `${days[0].date.slice(5)} → ${days[days.length - 1].date.slice(5)}` }),
						react_jsx_runtime.jsx(StyleToggle, { style, onStyleChange }),
					] }),
				] }),
				style === "table"
					? react_jsx_runtime.jsx(SpendTable, { spend })
					: react_jsx_runtime.jsx(SpendGrid, { spend }),
			] });
		}

		/** Per-model spend rows for the billing period (usageCosts DAY+MODEL, SELF).
		  * While Fireworks' attribution pipeline lags (INCOMPLETE, no rows yet), the
		  * live spend total + daily trend from the savings pipeline still show. */
		function BreakdownSection({ breakdown, spend, spendStyle, onSpendStyleChange }) {
			const hasSpend = !!spend?.days?.length;
			if (!breakdown || breakdown.error) {
				if (!hasSpend) return null;
				return react_jsx_runtime.jsx("div", { style: { borderTop: "1px solid rgba(236,72,153,0.18)", marginTop: 16, paddingTop: 14 }, children:
					react_jsx_runtime.jsx(SpendTrend, { spend, style: spendStyle, onStyleChange: onSpendStyleChange }) });
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
					hasSpend ? react_jsx_runtime.jsx(SpendTrend, { spend, style: spendStyle, onStyleChange: onSpendStyleChange }) : null,
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
				hasSpend ? react_jsx_runtime.jsx(SpendTrend, { spend, style: spendStyle, onStyleChange: onSpendStyleChange }) : null,
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
				// The saved display style is read once per page load; a POST from
				// this card updates local state directly, so no poll is needed.
				loadStyleConfig().then((spendStyle) => {
					if (!alive) return;
					setState((prev) => ({ ...prev, spendStyle: prev.spendStyle ?? spendStyle }));
				});
				const tick = () => {
					setState((prev) => ({ ...prev, refreshing: true }));
					fetchUsage().then((usage) => {
						if (!alive) return;
						if (usage && usage.ok !== false) usageCache = { usage, cachedAt: Date.now() };
						// Spread prev: a poll landing must not drop the chosen display style.
						setState((prev) => ({ ...prev, loading: false, refreshing: false, usage, error: usage?.ok === false ? usage.error : null }));
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
			const spendStyle = state.spendStyle === "table" ? "table" : "grid";
			/** Switch the daily-spend display. The choice always applies for this
			  * page (sessionStyle); persisting it host-side is best-effort, so a
			  * failed save (e.g. the host half not yet restarted) never reverts. */
			const changeSpendStyle = (style) => {
				sessionStyle = style;
				setState((prev) => ({ ...prev, spendStyle: style }));
				saveConfig(style).catch(() => {});
			};

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
					react_jsx_runtime.jsx(BreakdownSection, { breakdown: usage.breakdown, spend: usage.savings?.spend, spendStyle, onSpendStyleChange: changeSpendStyle }),
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
