# Android inspection and debugging runbook

> Use only a QA-owned device and test account. Commands and package names are examples; replace `com.example.fieldapp` with the actual application ID. Do not run destructive storage commands on a personal or production device.

## A. Baseline and identify the device

```bash
adb devices -l
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk
adb shell wm size
adb shell wm density
adb shell df -h /data
adb shell dumpsys meminfo
```

Record model, Android build, RAM, free `/data`, app version, language, font scale and network profile.

## B. Inspect Room database on an unrooted device

### Debuggable QA build

```bash
adb shell run-as com.example.fieldapp ls -R databases
adb exec-out run-as com.example.fieldapp cat databases/fieldapp.db > fieldapp.db
sqlite3 fieldapp.db ".tables"
sqlite3 fieldapp.db ".schema"
```

If the database uses WAL, collect the database and its `-wal` / `-shm` files consistently while the app is stopped, or use an approved app diagnostic export. A simple `cat` of the main DB while writes are active may miss uncheckpointed WAL content.

Example checks (replace table/column names with actual Room entities):

```sql
SELECT id, local_survey_id, sync_status, created_at
FROM survey_responses
ORDER BY created_at DESC;

SELECT survey_id, file_path, upload_status, checksum
FROM survey_attachments;
```

### Non-debuggable release APK

`run-as` normally fails for a non-debuggable release build. Do not bypass Android sandboxing or assume an unrooted release DB is directly readable. Ask engineering for:
- a signed QA build with a debug-only database export, or
- a Room/DAO diagnostic screen that exports sanitized rows, or
- an approved Android Studio / instrumentation test route.

Redact names, phone numbers, GPS coordinates and respondent answers from evidence unless explicitly authorized.

## C. Trigger WorkManager sync

Preferred approach: add a debug-only in-app action or instrumentation test that enqueues the exact WorkRequest with the same constraints and unique-work policy as production.

Inspect scheduled jobs:

```bash
adb shell dumpsys jobscheduler | grep -i -A 8 -B 4 com.example.fieldapp
```

On Android versions supporting the command, a discovered JobScheduler job can be forced:

```bash
adb shell cmd jobscheduler run -f <user-id> <job-id>
```

The user/job IDs and command support vary by Android version. Discover them from `dumpsys jobscheduler`; WorkManager's internal job IDs are implementation details and must not be hardcoded in long-lived automation. Also inspect WorkManager state through debug instrumentation/WorkManager diagnostics rather than assuming a JobScheduler trigger proves the worker completed.

## D. Return HTTP 500 with Charles / Proxyman

1. Configure the QA device proxy to the workstation IP and proxy port.
2. Install/trust the proxy CA only in a debug build/device profile approved for testing. Modern Android apps may not trust user-installed CAs by default.
3. Create a rewrite/map-local rule for the sync endpoint that returns HTTP 500 and a deterministic response body.
4. Enqueue sync and verify the request reached the proxy.
5. Restore a 200 response and allow the retry.

Expected:
- Survey and attachment metadata remain in Room.
- Sync status remains pending/retryable after 500.
- WorkManager has retry/backoff state according to configured policy.
- Attempt/error timestamps are recorded.
- The later successful retry marks the record synced once.
- No duplicate server event or lost attachment occurs.

## E. Network loss at 99% upload

Use a sufficiently large test image and a throttled profile. Interrupt at multiple points, including near 99%, after server receipt but before client acknowledgement, during app backgrounding, and after process death. Validate final checksum, byte count, attachment state and survey linkage. A progress bar alone is not proof of server commit.

## F. Low RAM / ANR / storage

```bash
adb logcat -c
adb logcat -v threadtime > anr-repro-logcat.txt
adb shell dumpsys meminfo com.example.fieldapp
adb shell dumpsys activity processes
adb shell dumpsys diskstats
adb shell am send-trim-memory com.example.fieldapp RUNNING_LOW
```

`send-trim-memory` availability/behavior depends on OS version and app state. Use Android Studio Memory Profiler and Perfetto/System Trace for allocation and main-thread analysis. Capture ANR traces/system events when available.

For storage testing, use a disposable emulator or QA device with a controlled data partition. Do not fill a daily-use device to 0 bytes. Verify graceful error handling and recovery after space is freed.
