# Backend Engineer Assignment - Submission

**Name:** Vishal Gajjar
**Date:** 2025-12-30
**Time Spent:** ~2 hours
**GitHub:** https://github.com/vishalgajjar/mixoads-backend-assignment

---

## Part 1: What Was Broken

List the major issues you identified. For each issue, explain what was wrong and why it mattered.

### Issue 1: Improper Rate Limiting
**What was wrong:**  
The original code made requests as fast as possible in a loop. The Ad Platform API limits requests to 10 per minute.

**Why it mattered:**  
This caused `429 Too Many Requests` errors, causing campaigns to be skipped or the process to crash entirely if unhandled. It prevents the system from scaling beyond a handful of items.

**Where in the code:**  
`src/syncCampaigns.ts` - inside the `for` loop, `fetch` was called immediately without delays.

---

### Issue 2: Poor Error Handling & No Retries
**What was wrong:**  
The code used a single try/catch inside the loop but didn't handle specific temporary errors like 503 (Service Unavailable) or timeouts properly with retries. The `fetchWithTimeout` helper threw an error but didn't trigger a retry.

**Why it mattered:**  
Transient network issues or server glitches (simulated 20% failure rate) caused permanent data gaps. The sync process was brittle and unreliable.

**Where in the code:**  
`src/syncCampaigns.ts` - validation of response status was minimal, and `status 503` was not handled.

---

### Issue 3: Insecure Authentication & Secrets Logging
**What was wrong:**  
Credentials (`admin@mixoads.com` / `SuperSecret123!`) were hardcoded in the source file. Additionally, the code logged the full auth string to the console.

**Why it mattered:**  
Hardcoding secrets is a major security risk (git history). Logging them exposes credentials to anyone with access to logs (e.g., in a ELK stack).

**Where in the code:**  
`src/syncCampaigns.ts` lines 43-44 and 48.

---

### Issue 4: Broken Pagination
**What was wrong:**  
The code fetched only `page=1` and did not check `has_more` or fetch subsequent pages.

**Why it mattered:**  
Only the first 10 campaigns were synced. The remaining 90 (90% of data) were ignored, leading to massive data inconsistency.

**Where in the code:**  
`src/syncCampaigns.ts` - fetched once and proceeded to process `campaignsData.data`.

---

### Issue 5: SQL Injection & Connection Leaks
**What was wrong:**  
The database code used string interpolation (`VALUES ('${campaign.id}'...`) to build queries. It also created a `new Pool()` for *every* campaign save without returning it to a pool or closing it efficiently (though `pool.query` internally uses a pool, creating a new Pool checks connection config every time and is wasteful/dangerous).

**Why it mattered:**  
String interpolation allows SQL injection attacks (e.g., if a campaign name contains `'`). Creating new pools repeatedly exhausts database connections rapidly.

**Where in the code:**  
`src/database.ts` - `getDB()` called inside `saveCampaignToDB`.

---

## Part 2: How I Fixed It

For each issue above, explain your fix in detail.

### Fix 1: Rate Limiting
**My approach:**  
I implemented a centralized `AdPlatformClient` with a `RateLimiter` mechanism (token bucket style / simple sleep enforcement). I configured it to ensure at least 6.5 seconds pass between requests (buffer for 10req/min).

**Why this approach:**  
It guarantees compliance with the strict API limit without checking headers (proactive). It's simple and robust.

**Trade-offs:**  
It makes the sync slow (sequential). A more complex solution could use bursts if allowed, or run multiple workers if the limit was per-token rather than global.

**Code changes:**  
`src/services/api.ts` - `enforceRateLimit()` method.

---

### Fix 2: Retry Logic with Exponential Backoff
**My approach:**  
I added a `request` wrapper in `AdPlatformClient` that recursively retries on 429, 500-599, and Timeout errors. It waits `2^retryCount * 1000` ms between attempts.

**Why this approach:**  
Exponential backoff prevents hammering a struggling server while maximizing the chance of success for transient errors.

**Trade-offs:**  
It adds latency to the overall process when errors occur.

**Code changes:**  
`src/services/api.ts` - `request()` method.

---

### Fix 3: Secure Configuration & Logging
**My approach:**  
I moved all configuration to `src/config.ts` using `dotenv`. Created a `Logger` class that formats logs and avoids printing secrets.

**Why this approach:**  
Standard 12-factor app practice. Keeps secrets out of code.

**Code changes:**  
`src/config.ts`, `src/utils/logger.ts`.

---

### Fix 4: Full Pagination Support
**My approach:**  
In `SyncService`, I implemented a `while(hasMore)` loop to fetch all pages of campaigns into a list before processing (or could stream them).

**Why this approach:**  
Ensures complete data correctness.

**Trade-offs:**  
Fetching all IDs first might use more memory if millions of campaigns, but for 100 it's negligible.

**Code changes:**  
`src/services/sync.ts` - `fetchAllCampaigns()`.

---

### Fix 5: Database Service & Parameterized Queries
**My approach:**  
Created a singleton `DatabaseService` that manages a single `pg.Pool`. Used parameterized queries (`$1, $2...`) for inserts.

**Why this approach:**  
Prevents injection. Efficiently manages connections.

**Code changes:**  
`src/services/db.ts`.

---

## Part 3: Code Structure Improvements

**What I changed:**  
I split the monolithic script into:
- `src/services/api.ts`: API interaction (Client)
- `src/services/db.ts`: Database interaction (Data Layer)
- `src/services/sync.ts`: Orchestration (Business Logic)
- `src/config.ts`: Config
- `src/utils/logger.ts`: Logging

**Why it's better:**  
Separation of Concerns. The API client doesn't care about the DB. The Sync service coordinates them. It's testable and maintainable.

---

## Part 4: Testing & Verification

**Test scenarios I ran:**
1. **Full Sync**: Ran `npm start` and observed 100 campaigns synced.
2. **Rate Limit Config**: Verified roughly 1 request every 6-7 seconds in logs.
3. **Mock Errors**: Observed "Server error 503. Retrying..." logs handling random failures from the mock API.

**Expected behavior:**  
Process runs for ~11-12 minutes, logs success for all campaigns, handles 503s transparently, eventually exits 0.

---

## Part 5: Production Considerations

### Monitoring & Observability
- Add **Prometheus metrics** (campaigns_synced, api_errors, duration).
- structured JSON logs for ELK/Datadog.

### Error Handling & Recovery
- Use a **Dead Letter Queue (DLQ)** for campaigns that permanently fail after retries, so they can be inspected/re-run later.

### Scaling Considerations
- 10req/min is very low. If we have multiple clients, we need a **Distributed Rate Limiter** (Redis-based) to share the quota across instances.
- For 100+ clients with separate credentials, we can parallelize (1 worker per client).

---

## Part 7: How to Run My Solution

### Setup
```bash
git clone <fork-url>
cd mixoads-backend-assignment
npm install
cp .env.example .env
# Edit .env if needed
```

### Running
1. Start Mock API:
   ```bash
   cd mock-api
   npm install
   npm start
   ```
2. Start Sync Service:
   ```bash
   npm start
   ```

### Expected Output
```
[INFO] Starting Campaign Sync Service...
[INFO] Fetched 100 total campaigns from API.
[INFO] [1/100] Processing campaign: Campaign 1...
[INFO] Successfully synced Campaign 1
...
[INFO] Sync Service Completed
```
