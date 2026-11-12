# GraphQL review and path to B

Reviewed 2026-10-24 at commit `0be9923803c8b1989ce887f2acf99a712c00b2b8`.

## 1. Current implementation grade: C+ — 78/100

This is a source review with focused local tests, not a production load test or exhaustive security audit. No implementation changes were made. Existing untracked files were left alone.

The grading scale for the next review is A = 90–100, B = 80–89, C = 70–79, D = 60–69. Target **85 or higher** to leave room above the B threshold. A confirmed cross-user disclosure, privilege bypass, or destructive-operation correctness bug blocks a B until repaired, regardless of the numerical total.

| Category | Current | Maximum |
| --- | ---: | ---: |
| Authentication, authorization, session isolation | 22 | 25 |
| Schema, input and error contracts | 15 | 20 |
| Query cost, pagination and data access | 12 | 20 |
| Mutation and subscription reliability | 17 | 20 |
| Tests, reproducibility and diagnostics | 12 | 15 |
| Total | 78 | 100 |

### What earns credit

- `backend/internal/api/server.go` authenticates WebSockets, checks revocation and token version, bounds HTTP bodies, and applies query depth and static complexity budgets. Public requests and sensitive public resolvers have rate limits.
- Subscription contexts derive identity from authentication; session watchdogs and client session resets address long-lived session leakage.
- Resource reads commonly use user-scoped DB access; instance-administrator privileges are checked separately from the role label.
- Upgrade work has explicit shutdown tracking, locking, rollback-related code and regression tests. Idempotency claims have release logic for failures before work starts.
- `client/src/graphql/__tests__/schemaContract.test.js` validates client documents and representative variable coercion. CI runs client tests, Go vet and backend tests.

### Findings that hold the grade down

1. **High: static cost does not reflect list fan-out or remote work.** The executable schema is built with resolvers but no custom complexity functions in `backend/internal/api/server.go:205`. A field counted once may return hundreds of objects and invoke nested resolvers for each. The complexity regression at `backend/internal/api/graphql_test.go:2024` exercises thousands of aliases, not cardinality-sensitive nested work. Depth and body limits help, but do not prove a useful execution budget. This is an architectural exposure, not a measured production outage.
2. **High: pagination can bound output while leaving work unbounded.** `backend/graph/schema.resolvers.go:2762` loads all persisted containers, merges live runner inventory, deduplicates and filters before slicing. `first: 1` still pays for the full inventory. `backend/graph/helpers.go:1122` defaults grouped connections to the full list, bypassing the normal 500-item ceiling when first is omitted. Several root lists have no pagination at all. Nested relation hydration also repeats DB reads: `backend/graph/sourceHydrate.go` fetches runners and intents separately for each field resolution. No request-scoped batching/memoization was found.
3. **Medium: errors lack a consistent machine-readable boundary.** The schema defines ErrorCode, but many resolvers return plain errors and the server has no custom error presenter. DB errors can reach that default error path. Other operations use success/message/error envelopes. Clients consequently face several failure conventions. Add explicit safe public messages and stable codes; preserve GraphQL partial-data semantics.
4. **Medium: storage failures are sometimes discarded.** Examples include read-after-write lookups in CreateTrackedApp/UpdateTrackedApp/CreateIntent/UpdateIntent and public status reads at `backend/graph/schema.resolvers.go:2710` and `:2729`. A failed lookup can become a nil result or a false status rather than an intentional error. Ignored best-effort telemetry writes are a separate concern; prioritize authoritative data and mutation outcomes.
5. **Medium: reproducibility and performance guarantees are incomplete.** Existing CI runs substantial tests, but no schema regeneration cleanliness gate or schema breaking-change check was found. The client contract scanner reads GraphQL-comment templates from queries.js only; the raw logout document in client.js demonstrates a document outside that scanner. No GraphQL operation-level telemetry or query-count budgets were found. These are missing assurances, not evidence that every untested operation is broken.

## 2. Potential security exploits and required mitigations

These are source-supported abuse scenarios and investigation targets. They are not claims of a demonstrated breach. Verify them with isolated test databases and mock runners; production exploitation is not required to earn credit. Priorities express remediation order, not CVSS scores.

### SEC-1 — Authenticated query amplification (P1; observed architectural gap)

**Precondition and impact:** An authenticated user can submit a small query whose list results trigger repeated relation lookups or runner inventory calls. Static field cost understates the actual work. Repetition can exhaust DB capacity, network connections or goroutines, affecting other users. A small first argument does not prevent the full inventory merge.

**Evidence:** `backend/internal/api/server.go` constructs the schema without custom complexity functions; `backend/graph/schema.resolvers.go` slices containers after inventory collection; `backend/graph/containerLiveHelpers.go` starts a goroutine per enabled runner on each merge.

**Required work:** Implement cardinality-aware cost, bounded default lists, per-user operation/concurrency budgets, a bounded runner worker pool and request-scoped inventory reuse. Apply execution deadlines to finite queries and remote calls without terminating accepted background upgrades. Keep subscription lifetimes separate from finite query deadlines.

**Proof of completion:** Tests submit nested lists, distinct aliases and variable page sizes against mock runners. Over-budget requests make zero downstream calls; accepted aliases reuse inventory; active calls never exceed the configured concurrency cap. Cancellation releases workers. A second user's normal query completes while the first user's excess work is rejected. Record the configured budgets and observed call counts.

### SEC-2 — Subscription resource exhaustion (P1 verification target)

**Precondition and impact:** A valid token can open long-lived subscriptions. Connection rate limiting does not by itself cap active subscriptions on an existing socket. Each subscription can retain a hub entry, buffers and a watchdog. No explicit active-subscription ceiling was identified in the reviewed application setup.

**Required work:** First measure any existing transport limits. Add limits where missing for active sockets per user and active operations per socket/user, plus bounded init/message sizes and an initialization timeout. Release admission slots on rejection, disconnect, expiry and cancellation. Preserve legitimate multiplexing.

**Proof of completion:** A local WS test opens the configured maximum, verifies the next operation is rejected, closes the connection and verifies slots and hub subscriber counts return to baseline. Repeat after invalid auth, session revocation and abrupt disconnect. Run lifecycle tests with the Go race detector. Do not mark this confirmed exploitable solely from the absence of an application-level setting.

### SEC-3 — Internal error disclosure (P2; unsafe error path observed)

**Precondition and impact:** An operation encounters a storage or upstream error. Plain errors returned through the default GraphQL presenter may disclose implementation details. The exact leaked content depends on the failing dependency; credential disclosure has not been demonstrated.

**Required work:** Add a safe error presenter with typed codes, sanitized internal messages and a correlation ID. Retain useful diagnostics in redacted server logs. Audit HTTP, WS, multipart and background-operation error messages, not just successful resolver payloads.

**Proof of completion:** Inject errors containing a fake token, SQL text, internal URL and filesystem path. None appear in the response or unredacted logs. Expected validation errors retain actionable messages and stable codes. Verify partial data survives an unrelated nullable-field failure.

### SEC-4 — Foreign-ID access and broadcast leakage (P1 verification target; no bypass established)

**Precondition and impact:** A user supplies another user's entity ID or subscribes while another user's task runs. Missing authorization on one relation or an incorrectly broadcast event could expose data or permit a destructive operation.

**Evidence and existing controls:** Many DB reads already include user IDs. However, User relation resolvers derive the target ID from their parent, relying on authorized parent construction. `backend/internal/events/hub.go` deliberately delivers audience ID zero to every subscriber. These are trust boundaries to test, not proof of a current access-control bug.

**Required work:** Enumerate all sensitive roots, relations and event publishers. Ensure parent-derived access is protected by a documented invariant or a shared ownership/admin guard. Audit every zero-audience publication; only intentionally public, non-sensitive invalidation may be broadcast. Test owner scoping on runner actions, image deletion, tokens, history, operations and subscriptions.

**Proof of completion:** A two-user fixture plus a role-only administrator and an instance administrator exercises foreign IDs at roots and through nested selections. Unauthorized reads expose no private fields, writes make no DB/runner changes, and private events reach only the owner. Document deliberately permitted instance-admin access.

### Security completion gate

- Close SEC-1 and SEC-3 with code and regression evidence.
- Resolve SEC-2 and SEC-4 through tests and inspection; fix any demonstrated gap. A disproven scenario is closed with evidence, without unnecessary code changes.
- Any confirmed cross-user leak, privilege bypass or destructive correctness bug blocks B. Unresolved high-impact resource amplification also fails this report's no-high-severity-findings acceptance condition.
- Keep the existing protections for auth rate limiting, revocation, token versions, subscription revalidation, body limits and upgrade locking passing throughout.

## 3. Technical debt backlog to reach and retain B

This backlog turns the five implementation stages below into reviewable deliverables. Security and debt entries overlap: a shared fix earns credit once in the weighted rubric. Assign a named owner and link a PR plus test/benchmark output to every required row before re-review.

| ID / priority | Deliverable and location | Done when | Grade linkage |
| --- | --- | --- | --- |
| TD-1 / P1 | Request-scoped loaders and shared inventory in graph helpers and API operation context | Repeated references to the same runner/intent reuse one load; inventory aliases reuse one collection; different users/requests remain isolated | Performance; SEC-1 |
| TD-2 / P1 | Bounded pagination in schema, DB queries, graph helpers and client hooks | Persisted small pages avoid full-table materialization; grouped defaults are bounded; clients accumulate pages; mutable-history cursor behavior passes insertion/deletion tests | Performance |
| TD-3 / P1 | Typed errors and authoritative DB error propagation in resolvers/API/client | Failure injection covers ignored read-after-write/status reads; stable codes replace message matching; committed writes remain reconcilable; internal details stay private | Contracts; SEC-3 |
| TD-4 / P1 | Authorization and subscription lifecycle matrix in backend API/graph/events tests | SEC-2/SEC-4 evidence exists; revocation/disconnect frees resources; foreign-ID actions cannot affect another user's runners or data | Security and reliability |
| TD-5 / P1 | Reproducible schema generation and complete document validation in CI | Pinned generation leaves no tracked diff; every shipped document including inline logout is validated; an intentionally breaking schema fixture fails the compatibility check | Tests/reproducibility |
| TD-6 / P2 | Operation diagnostics and benchmark fixtures | Bounded-label timing/error/call-count metrics exist; secrets are redacted; fixed fixtures record p50/p95, memory and downstream calls against an agreed budget | Diagnostics and performance |
| TD-7 / P2 | Extract cohesive resolver services from schema.resolvers.go | Move inventory, authorization, operation orchestration and error mapping into focused helpers/services as those areas change; generation preserves handwritten logic and existing behavior tests pass | Maintainability; supports TD-1/TD-3 |
| TD-8 / P2 | Scalar boundary tests in graph/model | BigInt rejects fractional/out-of-range numeric inputs; its wire format preserves values beyond JavaScript's safe integer range with client compatibility tests; JSON's documented accepted shape matches implementation | Contract hardening |
| TD-9 / P2 | Event-loss recovery contract in events and client subscription hooks | Force hub buffer overflow and reconnect; client reconciles terminal state by query; dropped-event telemetry is usable and a lost event cannot leave the UI indefinitely running | Reliability |

**Additional source observations:** `backend/graph/model/scalars.go` currently casts float64 to BigInt without integral/range validation and serializes BigInt as a JSON number, which can lose precision in JavaScript. JSON accepts objects despite its broader schema description. `backend/internal/events/hub.go` intentionally drops events when consumer buffers fill and already counts/logs drops; the remaining obligation is to verify client recovery. These are contract/reliability debt, not demonstrated security exploits.

**Execution order:** TD-1 and TD-2 with SEC-1 first; TD-3 next; TD-4 with the remaining security checks; TD-5 and TD-6 establish the lasting regression gate. Do TD-7 while touching those areas rather than starting a broad rewrite. Include TD-8 and TD-9 in the contract/lifecycle acceptance pass. None of these rows earns points merely by being checked off; the linked evidence must demonstrate the behavior.

**B-grade completion checklist:**

- [ ] Required security scenarios are closed with tests or documented evidence that existing controls suffice.
- [ ] TD-1 through TD-6 acceptance criteria pass; touched services preserve generation and behavioral tests.
- [ ] Scalar contracts and event-loss recovery are tested; any remaining TD-7/TD-8/TD-9 work has a named owner and an explicit explanation of why it does not violate the acceptance criteria.
- [ ] Focused GraphQL tests, full client/backend suites, Go vet and relevant race tests pass on the reviewed commit.
- [ ] CI generation/document/compatibility gates pass and representative benchmark results meet the recorded budgets.
- [ ] Re-review scores at least 85/100 under the original rubric, with no unresolved high-severity findings. Record residual debt explicitly instead of silently changing the standard.

## Full path to a durable B

Complete these in order. Expected score gains are rubric targets, not automatic credit for adding files.

### 1. Bound actual execution cost — target 15/20 for performance

- Configure list complexity using the effective bounded page size, including defaults. Weight remote runner calls and expensive root fields explicitly. Ensure aliases and nested connections multiply the expected work.
- Add request-scoped runner/intent loaders or memoization, scoped to the authenticated user. Cache no data across users or requests.
- Share inventory collection within an operation so containers, groups and summary do not repeat the same runner fetches.
- Test nested list queries, aliases, fragments and variable/default page sizes. Assert rejection occurs before DB/network execution for over-budget work. Assert a normal dashboard operation remains accepted.
- Add query/call counters: 100 container source references to one runner must cause at most one hydration fetch per operation; two different users must never share loader results.

### 2. Make pagination bounded and predictable — target 16/20 for performance

- Move filtering, ordering and limits into DB queries for persisted lists. Where live inventory is required, define a bounded snapshot/cache strategy and avoid one full remote inventory fetch per page or alias.
- Give grouped connections bounded defaults and migrate clients to consume all needed pages. Introduce paginated alternatives for potentially large root lists, preserving a deliberate compatibility period.
- Define deterministic ordering and cursor behavior. Prefer stable keyset cursors for mutable histories; numeric offsets alone can skip or duplicate entries during inserts/deletes.
- Specify first=0, negative/oversized first, malformed cursors, empty results and end-of-list behavior. Validate them consistently rather than silently treating every invalid value as a default.
- Acceptance: a 10,000-row fixture returns no more than the configured page size; querying a small persisted page does not materialize the full table. Test inserts/deletes between pages against the documented consistency contract. Exercise actual client page accumulation.

### 3. Standardize errors and authoritative failure handling — target 18/20 for contracts

- Introduce typed domain errors mapped to extensions.code, with safe messages, request IDs and server-side diagnostic logging. Distinguish unauthenticated, forbidden, validation, missing resource, conflict, rate limit and internal failure.
- Do not forward SQL, filesystem details or credentials in internal-error messages. Ensure logging redacts tokens and sensitive variables.
- Update clients to use codes and handle partial data intentionally. Document business validation payloads versus execution errors, and use that distinction consistently.
- Check and propagate authoritative reads/writes currently ignored. Test failures after a successful write so a client is not told an operation failed without a way to reconcile the committed result.
- Acceptance: injected storage failures produce an intentional safe error, never a false healthy/status result; HTTP and WS return consistent codes; representative forms display actionable errors without matching English text.

### 4. Turn security and lifecycle expectations into a matrix — target 23/25 and 18/20

- Inventory every root operation and sensitive relation: public, owner, other user, role-only administrator and instance administrator. Exercise foreign IDs in nested relations as well as root lookups.
- Test subscriptions across logout, password change, expiry, deleted users, reconnect and concurrent users. Verify all six event streams remain scoped and clean up their hub subscribers.
- Verify successful mutation completion against persisted data and subsequent query/subscription results. Include duplicate/retried requests, disconnects, dependency failure and process cancellation for destructive upgrades.
- Acceptance: no unauthorized data or events; no destructive duplicate execution; terminal operation states agree between polling, subscriptions and storage. Preserve existing rollback/locking regressions.

### 5. Enforce the standard continuously — target 13/15 or higher

- Pin/document the gqlgen generation command and tool version. Regenerate in CI and fail on unexpected tracked diffs.
- Validate every shipped operation document, including inline transport helpers. Use an explicit document registry or extraction that fails when a new document escapes validation.
- Add a schema compatibility check against the base branch and require intentional approval/migration for breaking changes.
- Add operation-name/type/duration/error-code telemetry and DB/runner call counts without logging sensitive variables. Use bounded metric labels.
- Run representative dashboard and nested-relation benchmarks with fixed dataset size, hardware and concurrency. Record p50/p95, query/call counts and memory. Set a measured budget before comparing revisions; this review does not invent a production latency SLA.

These targets yield **88/100** if demonstrated: 23 + 18 + 16 + 18 + 13. That is a strong B, with room for minor findings on re-review.

## Validation performed

- `cd backend && go test ./graph ./internal/api ./internal/events`: all three packages passed (cached).
- `cd client && npm test -- src/graphql`: 6 files and 128 tests passed.
- Read schema, transport/auth setup, representative query/mutation/relation resolvers, scalar/pagination helpers, client session handling, contract tests and CI workflows.

Not performed: production requests, full repository test suite, browser end-to-end execution, race detection or load benchmarks. Passing focused tests supports the current grade; it does not establish production-scale performance.

## Re-review contract

Regrade the resulting implementation against the same weighted categories and blocker policy. Require tests and measurements for each claimed fix. Aim for 85+, with all five stages addressed and no unresolved high-severity findings. A plan alone does not improve the grade; reviewed implementation and evidence do.
