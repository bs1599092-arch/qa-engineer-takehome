# QA Engineer Take-Home Assessment

**Implementation:** Playwright + TypeScript, Node.js mock services, CSV test matrix.  
**Scope:** Part 1–4 of the supplied QA assessment, grounded in the supplied Android App Specification, Survey Builder Capabilities and Sample Survey Schema.

> **Important scope note:** This repository is a runnable QA demonstration, not an integration against the employer's private application or backend. The API and web pages are local mock fixtures. Replace the mock endpoints/selectors with the real staging environment before claiming product-level coverage.

## 1. Repository structure

```text
.
├── README.md
├── package.json
├── playwright.config.ts
├── src/
│   ├── mock-sync-api.js
│   └── skip-logic-fixture.js
├── tests/
│   ├── api/sync-survey.spec.ts
│   ├── web/skip-logic.spec.ts
│   ├── web/hfc-engine.spec.ts
│   └── fixtures/skip-logic.html
├── test-cases/test-matrix.csv
└── docs/
    ├── android-debugging-runbook.md
    └── qa-process.md
```

## 2. Setup and execution

Requirements: Node.js 20+ and npm.

```bash
npm install
npx playwright install chromium
npm test
```

Run by area:

```bash
npm run test:api
npm run test:web
```

The Playwright configuration starts two local services automatically:
- Mock sync API: `http://127.0.0.1:4174`
- Dynamic skip-logic fixture: `http://127.0.0.1:4173/survey/hobbies`

The API service stores records in memory for demonstration. It resets when restarted. It is not production storage and does not model real database transactions or 50,000-client load.

## 3. Part 1 — Hands-on technical inspection and automation

### Scenario A — Offline sync and data collision

#### API contract and identity strategy

A local ID such as `School_1` is only unique inside a device's local database. It must never be treated as a globally unique server key. The server should retain the client identity and issue its own immutable ID.

Recommended request fields:

```json
{
  "workerId": "ankit",
  "deviceId": "device-A",
  "clientEventId": "event-ankit-001",
  "localSurveyId": "School_1",
  "survey": {
    "schoolName": "Govt Primary School",
    "village": "Rampur"
  }
}
```

- `clientEventId` is generated once per logical submission and reused for every retry.
- Enforce a database unique constraint on `(worker_id, client_event_id)`.
- Generate a server-side UUID for every accepted event.
- Do not deduplicate by `localSurveyId`; Ankit and Pooja may both legitimately have `School_1`.
- Use a transaction to insert the event and its survey data atomically.
- Return the original server ID for an idempotent retry.
- If business rules require identifying the same real-world school, use a separate entity-resolution workflow (for example, GPS + normalized name + review). Do not silently merge or overwrite survey submissions.

The mock API tests cover:
1. Two workers concurrently submitting the same local ID create distinct records.
2. Replaying the same event returns the original server ID.
3. Missing idempotency metadata is rejected.

**Production extension:** add tests for same key with different payload (409 conflict or documented immutable-first-write behavior), expired/replayed keys, concurrent database transactions, attachment checksum, auth/tenant isolation, schema validation, and partial batch failure.

#### Handling 50,000 reconnecting clients

Do not let every client immediately hammer the API:
- Client: exponential backoff with full jitter, bounded retries, network constraints, and a persisted work queue.
- Server: API gateway rate limits, queue/broker, horizontally scaled workers, bounded concurrency, and backpressure.
- Sync protocol: small batches, resumable/chunked photo upload, checksums, acknowledgements per item, and cursor-based continuation.
- Observability: request rate, queue depth, p50/p95/p99 latency, 4xx/5xx, retry count, duplicate/idempotency rate, upload failure rate, and oldest pending event.
- Load test with a ramp (e.g. 100 → 1k → 10k → 50k virtual clients), then a reconnect “thundering herd” test. Agree numerical SLOs with engineering before pass/fail; do not invent an SLO.

#### Poor network and 99% photo-upload interruption

Use a real low-end Android device plus ADB and a proxy such as Charles or Proxyman:
1. Capture a baseline upload and record request ID, file size, checksum and server response.
2. Enable proxy on the device and configure the test build's network security settings to trust the proxy certificate (debug build only).
3. Throttle to a 2G-like profile; start a survey photo upload.
4. At approximately 99%, disable Wi-Fi/mobile data or terminate the proxy connection. Repeat at 0%, 50%, 99%, and immediately after server receipt.
5. Restore connectivity and observe whether the client resumes a chunk or safely restarts.
6. Verify no corrupt/partial attachment is marked complete; verify checksum, file size, survey answers and pending state.
7. Repeat with app process death and device reboot.

Do not rely only on a UI progress bar. Correlate client logs, proxy capture, upload session/chunk IDs, server object metadata and local Room rows. Expected behavior: survey data remains durable; upload state is retryable; final attachment is committed only after successful verification; duplicate retries do not create duplicate survey records.

### Scenario B — Dynamic form rendering and regression

The supplied Sample Survey Schema contains a direct example in **Student Interests & Hobbies**:
- `q_3`: “Do you have a hobby?” with Yes/No options.
- `q_4`: “What is your hobby?” with visibility enabled, target `q_3`, condition `equals`, value `Yes`.

The Playwright test selects Yes and asserts `q_4` appears, then selects No and asserts it hides and its stale value is cleared. The HTML fixture is intentionally a small local stand-in. For the real builder, replace the fixture route with staging and use stable accessible labels or `data-testid` selectors.

#### JSON-driven regression design

Build tests from schema metadata rather than hardcoding screen positions:
- Parse schema and validate required structure (`surveyData`, `sections`, `questions`, unique `questionId`).
- Render contract tests for every supported input type.
- Data-driven tests for required/optional, read-only, hidden, sensitive, hints, checklists, option images and validation rules.
- Visibility matrix for `equals`, `not_equals`, `contains`, numeric comparisons, `is_empty`, `is_not_empty`, enabled/disabled and changes to the controlling answer.
- Roster tests for 0, 1, typical and maximum permitted rows; nested/long rosters; back-navigation and persistence.
- Matrix tests for SegmentedButton, Dropdown and Input render modes.
- HFC tests for `all`/`any`, operators, actions, severity and supervisor flags.
- Version compatibility tests: old saved response + new schema, unknown fields/types, missing optional config and schema migration.
- Golden contract snapshots for generated schema, while avoiding brittle full-page snapshots as the only assertion.

Automate deterministic logic, validation, persistence and API contracts. Keep exploratory manual testing for confusing question wording, culturally inappropriate imagery, real-world enumerator workflow, translation quality, sunlight visibility, and unusual device/keyboard behavior.

### Scenario C — Room and WorkManager inspection

Detailed, reproducible command sequence is in [`docs/android-debugging-runbook.md`](docs/android-debugging-runbook.md).

Key points:
- On an unrooted device, use Android Studio Device Explorer / `run-as` for a debuggable build. A production release APK may be non-debuggable; do not promise direct access to its private Room database. Use an approved QA build, app-supported export/backup, or instrumented diagnostic build.
- Inspect Room schema, rows, attachment metadata, status, retry count and timestamps. Avoid exposing real respondent PII in logs or test artifacts.
- WorkManager jobs should be triggered through a debug-only test hook or instrumentation API. `adb shell cmd jobscheduler run` can force a scheduled JobScheduler job on supported Android versions, but WorkManager's internal job ID is not a stable public contract. Discover it with `dumpsys jobscheduler`; do not hardcode it across versions.
- Intercept a sync request and return HTTP 500. Verify WorkManager marks the work retryable/enqueued with backoff, the local record remains pending, attempts are recorded, and a later successful retry marks it synced exactly once.

## 4. Part 2 — Complex scenarios and edge cases

### Scenario D — 4GB RAM / video training ANR

Reproduction plan:
1. Use the lowest supported physical device (4GB RAM target), same OS/API level as affected users where possible. Also use an emulator with reduced RAM as a repeatable secondary environment; emulator behavior is not a substitute for physical hardware.
2. Install the same build, clear app data, record free storage and baseline memory.
3. Download/watch modules 1–4 sequentially, repeat transitions, background/foreground, rotate if supported, then navigate into data collection. Repeat after cold start and warm start.
4. Capture `adb logcat` including `AndroidRuntime`, `ActivityManager`, `am_anr`, `lmkd`, `OutOfMemoryError`, media codec and app process messages.
5. Capture `adb shell dumpsys meminfo <package>` before/after each module and a Perfetto/System Trace recording. Use Android Studio Memory Profiler to inspect Java/Kotlin heap, native allocations, bitmap retention and GC; use CPU profiler for main-thread blocking.
6. Simulate constrained resources in a controlled test environment. Use Android Emulator AVD memory settings, `adb shell am send-trim-memory <package> RUNNING_LOW` where supported, and a disposable test device with low free storage. Avoid destructive storage commands on a personal device.
7. Compare heap/native memory trend after each module. Look for retained Activity/Fragment references, un-released player/codec, large unscaled video thumbnails, buffering entire files, main-thread disk/network work, excessive bitmap caching or unbounded observers.
8. Prove root cause with a repeatable before/after: attach trace and log timestamps to the exact user action; identify allocation/thread stall; show memory trend or main-thread blocked stack; verify the fix reduces retained memory/ANR and survives repeated module navigation.

Do not claim an ANR solely from a slow screen. Confirm the ANR trace / system event and identify whether the cause is main-thread blocking, memory pressure, codec failure or storage exhaustion.

### Scenario E — HFC engine test plan

| Case | Input / rule | Expected |
|---|---|---|
| Positive AND | Age < 15 AND Education = College; age 14 | HFC action fires |
| Negative AND | Age 16 AND Education = College | No HFC |
| Positive OR | SleepWell = No OR SleepHours < 6; hours = 5 | HFC fires |
| Negative OR | Neither predicate matches | No HFC |
| Boundary | Age exactly 15 for `< 15`; sleep exactly 6 for `< 6` | No match |
| Null / unanswered | Numeric operand missing | No accidental numeric match; required validation remains separate |
| Type mismatch | Numeric operator applied to nonnumeric text | Controlled schema/config error or safe non-match; never crash |
| Reask once | First invalid answer then confirmation | Prompt once; then accept and flag per rule contract |
| Reask and flag | User confirms same unusual value | Reask behavior and flag both recorded; no infinite loop |
| Block | Hard rule remains invalid | Continue blocked until corrected; clear explanation |
| Rule ordering | Two rules match same answer | Deterministic documented order; no duplicate prompts |
| Offline restart | Trigger HFC, force-stop, reopen | Answer and reask state persist; no repeated prompt loop |
| Roster scope | Same rule in multiple roster rows | Evaluate against correct row/iteration, not another member |

**Loop prevention:** persist a per-response/per-rule prompt counter or confirmation state. `reask_once` must have a strict maximum of one re-prompt for that rule and answer revision. `reask_and_flag` needs a defined confirmation path and must not repeatedly re-open the same prompt on every render. Reset the counter only when the relevant answer changes according to product rules.

**Important schema observation:** the supplied `3.Sample Survey Schema.json` is not valid JSON at the `hfc_sleep_plausible.logic` array: a comma is missing between two objects. It also uses `questioID`, whereas the capability reference describes `attr` and the sample HFC format uses `attr`. This repository does not silently rewrite the supplied source file. Fix and version the source schema with the product owner before using it as an executable fixture. Confirm intended rule semantics too: the sample's visibility says ask sleep hours when sleep-well is No, while its HFC first predicate currently references Yes.

## 5. Part 3 — QA process and AI integration

### First 30 days as the first dedicated QA Engineer

**Days 1–5: Understand and baseline**
- Map product flows, architecture, release process, data sensitivity and failure history.
- Meet engineering, product, support and field operations.
- Establish risk-based smoke coverage for onboarding, training gate, offline save, dynamic form, sync and recovery.
- Agree severity definitions, release owner and defect workflow.
- Get staging accounts, test devices, API docs, build pipeline and logs.

**Days 6–10: Make quality visible**
- Define staging parity and test data reset strategy.
- Add a PR smoke suite for critical web/API paths.
- Create test case templates, bug report template and device/OS matrix.
- Add build metadata, crash/ANR visibility and sync observability.
- Introduce entry/exit criteria with developers.

**Days 11–20: Build repeatable coverage**
- Automate stable API contracts, skip logic, schema validation and high-risk regression.
- Add Android instrumentation checks for Room persistence and WorkManager retry.
- Start a small physical device lab: lowest supported RAM/storage, common screen sizes, Android versions and network profiles.
- Run exploratory sessions with field-user workflows and localization.
- Track flaky tests separately; do not normalize failures by blindly retrying.

**Days 21–30: Integrate and improve**
- Run smoke tests on every PR; full regression nightly or before release.
- Add release checklist, risk review, known issues and rollback/monitoring plan.
- Run a controlled sync burst and poor-network test.
- Review defect escape rate, time-to-detect, automation reliability, flaky rate and critical-flow coverage.
- Present a prioritized quality roadmap with owners.

**Entry criteria:** requirements/acceptance criteria available; build deploys to staging; schema/API version identified; test data and accounts ready; critical dependencies available; known risks documented.

**Exit criteria:** P0/P1 scenarios pass or have an explicit approved risk acceptance; no open release-blocking defect; critical regression passes; no data loss/duplication in offline-sync checks; crash/ANR and API health reviewed; test evidence and release notes attached.

Quality gates should be risk-based and fast: a short PR smoke suite, with heavier device/network/load suites scheduled nightly or on release candidates. QA should provide rapid feedback, not become a manual approval bottleneck for every low-risk change.

### AI in daily QA work

Use AI to accelerate test design, generate boundary-value candidates, explain unfamiliar logs, draft API payloads and review test code. Keep a human in the loop:
- Provide a sanitized schema (no respondent PII or secrets).
- Ask AI to enumerate input types, visibility dependencies, validations, roster relationships and HFC predicates.
- Generate candidate positive/negative/boundary cases.
- Convert candidates into Playwright test data.
- Validate generated assertions against the schema and product requirements; run them and review failures.
- Never let AI invent expected behavior when the schema is ambiguous.

**Specific Scenario B example:** give AI the `Student Interests & Hobbies` survey section. Ask it to identify `q_3` as the controlling question and `q_4` as a dependent question with `equals Yes`. Generate tests for Yes → visible, No → hidden, Yes then No → hidden with stale value removed, empty answer → hidden, and repeated toggling. Compare the generated cases with the actual JSON before committing.

Do not upload personal data, credentials, production tokens or confidential respondent information to public AI tools. Use approved enterprise settings and sanitized fixtures.

### Automation decisions and tool choice

Automate when behavior is deterministic, repeated, high-risk, data-driven, and has stable selectors/contracts. Keep manual exploratory testing for usability, visual comprehension, translation nuance, outdoor visibility, touch comfort and field conditions that require human judgment.

Playwright + TypeScript was selected because the assessment explicitly permits Playwright, it supports browser automation and APIRequestContext in one test runner, TypeScript makes payload/contract types clearer, and the same runner supports CI traces/reports. Node/Express supplies a small isolated mock API so the tests run without private backend access. For native Android UI, use Appium or Espresso/UI Automator; Playwright does not replace native Android instrumentation.

## 6. Part 4 — UI/UX and user-centric QA

For the Training Video Hub, I would evaluate task success in the real field context, not only whether the player and Next button work.

At least these issues should be reviewed:
1. **Dense paragraphs:** low-literacy users may not understand long text. Prefer short sentences, simple language, illustrations, audio narration and step-by-step cues.
2. **Next button at bottom of long scroll:** users may not discover it. Keep a clear sticky primary action where appropriate, or show progress and a visible next-step cue.
3. **Small touch target:** standard-sized controls may be hard to tap on budget phones. Target approximately 48dp minimum touch areas with spacing.
4. **Low contrast / sunlight:** test text, icons and controls at high brightness outdoors; do not communicate state through color alone.
5. **Video loading and buffering:** provide clear loading, retry, offline/downloaded state and resume behavior; avoid blank player regions on slow 2G.
6. **Unclear completion state:** show unmistakable progress and completion using text + icon + color, not color alone.
7. **Small screens and font scaling:** verify 320dp widths, landscape/portrait, large system font and display scaling without clipping or hidden actions.
8. **Language expansion:** Hindi, Marathi, Gujarati and Kannada may wrap differently; test long translations, line breaks and font rendering.
9. **Low storage / battery / data cost:** communicate video size and download state; avoid unexpected streaming on mobile data.
10. **Accessibility:** meaningful labels, TalkBack order, focus visibility, keyboard/DPAD where relevant and no touch-only critical action.

**Systematic method:** define a device matrix; run at smallest supported screen and low-end hardware; test outdoors and under bright light; set large font/display scale; test all supported languages; measure touch bounds; inspect contrast; use TalkBack; throttle network; fill storage on a disposable device; observe memory/CPU and app responsiveness. Record screen video, device/build details, reproduction steps, expected user impact and evidence.

**Constructive bug communication:** describe the user task and impact, not personal design preference. Example:

> **Title:** Primary “Next” action is difficult to discover on 5-inch device  
> **Environment:** Android version/build, device model, font scale, language and brightness  
> **Steps:** Open Training Video Hub → scroll through the three descriptive paragraphs → locate Next  
> **Actual:** Primary action is below the fold and users can miss it after viewing the video  
> **Expected:** A clear, consistently discoverable next action with adequate touch area and progress cue  
> **Impact:** Field workers may abandon training or assume the module is complete  
> **Evidence:** Screenshot/video, viewport dimensions and measured target size  
> **Suggestion:** Consider a persistent bottom action or shorter visual instructions; validate with field users.

## 7. Risks and assumptions to confirm

- The assessment mentions 20+ input types; the supplied capability page lists 20 in its overview but its visible type table enumerates a subset. Obtain the canonical schema/type registry for complete coverage.
- The sample schema has a JSON syntax error and HFC field-name inconsistency described above.
- The assessment uses `POST /sync-survey` as an example only; confirm the actual API contract, authentication, response codes and attachment protocol.
- Confirm whether duplicate physical schools should remain separate survey submissions or be linked to a canonical school entity. This is a product/data-governance decision, not something QA should infer.
- Confirm supported Android versions, minimum screen size, device RAM/storage baseline, retry/backoff requirements and release SLOs.

## 8. Submission checklist

- [x] API automation script for duplicate local IDs and idempotent retries
- [x] Web automation script for dynamic skip logic
- [x] HFC positive, negative and edge-case automation examples
- [x] Test matrix in CSV
- [x] README answers for all four assessment parts
- [x] Android Room / WorkManager / proxy / ADB runbook
- [ ] Replace mock API and HTML fixture with the employer's staging services
- [ ] Execute on actual target devices and attach real run evidence
- [ ] Push repository to GitHub and submit the repository URL
