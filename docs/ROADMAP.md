# Roadmap — next development phase

Ordered by player impact vs. risk.

1. **Telegram field test** — run the Mini App inside Telegram with a test bot; polish touch gestures and
   haptics; add deep links to clan invites.
2. **Art & audio pass** — replace procedural sprites (`client/src/render/sprites.tsx`) with illustrated tiles
   keeping the same API; battle effects and sound.
3. **Defending troops & troop research** — a garrison from the Barracks that defends, and per-troop upgrades
   (engine already supports stat multipliers).
4. **Live updates** — WebSockets/SSE for clan chat, war score and incoming-attack notifications (currently
   polling).
5. **Speed-ups and builder economy** — optional (non-purchasable at first) speed-ups from missions to reduce the
   hard dependence on being online at timer end.
6. **Automated E2E tests** — Playwright suite in CI for registration, building, battle replay and clan flows.
7. **Operational hardening** — Redis rate limiting, structured logs/metrics, alerting on `error_logs`,
   batched season reset, archive restore tool.
8. **Account recovery** — optional e-mail or platform login linking, password reset.
9. **Store & season pass** — only after platform payment requirements, receipt verification, refunds and legal
   review; cosmetics only, no pay-to-win.
10. **Token integration** — separate, audited payout service (see SECURITY.md); keep the simulated ledger as
    the source of truth for allocations.

## Balancing backlog

* Watch real telemetry for days-to-HQ-10 (target ~90) and adjust `productionMultiplier` / HQ costs.
* Late campaign stages (8–10) are tuned for HQ 7+ armies; check clear rates.
* Territory garrisons 1–3 are easy by design (neutral land); strategic territories may need +1 garrison level.
