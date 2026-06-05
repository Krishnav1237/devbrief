# DevBrief Examples & Scenarios

Practical examples and real-world scenarios demonstrating DevBrief's capabilities for managing library updates across different project types.

---

## Example 1: React + Next.js Web App

A modern web application stack with multiple critical dependencies. This example shows how DevBrief prioritizes security fixes, breaking changes, and routine updates.

### Setup

```bash
npx devbrief stack add react --urls "https://github.com/facebook/react/releases"
npx devbrief stack add next --urls "https://github.com/vercel/next.js/releases"
npx devbrief stack add typescript --urls "https://github.com/microsoft/typescript/releases"
```

### Sample Briefing Output (After Risk Classification)

```
📊 DevBrief Summary
3 CRITICAL | 0 BREAKING | 8 MINOR updates available

[CRITICAL] React 19.0.0
└─ Security fix for XSS vulnerability in JSX parser
└─ Affects your project: YES (direct dependency)
└─ Action: Update immediately
└─ Command: npm install react@19.0.0

[CRITICAL] Next.js 15.1.0  
└─ Security patch for authentication bypass
└─ Affects your project: YES
└─ Action: Update immediately

[BREAKING] TypeScript 5.6.0
└─ Changes to type inference rules
└─ Affects your project: YES (will need code updates)
└─ Action: Plan upgrade for next sprint
└─ Migration guide: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-6.html

[MINOR] React 19.0.1 (patch)
└─ Performance improvements for Suspense
└─ Safe to update

[MINOR] Next.js 15.1.1 (patch)
└─ Bug fixes for edge cases
└─ Can defer

Voice briefing ready: /Users/user/.devbrief/audio/run-123.mp3
```

### Dashboard View

```
React 19.0.0              🔴 CRITICAL (95)
Next.js 15.1.0            🔴 CRITICAL (92)
TypeScript 5.6.0          🟠 BREAKING (68)
Vitest 1.2.0              🔵 MINOR (12)
ESLint 9.0.0              🔵 MINOR (8)
...

Summary: Your project is ready for 2 critical updates. Plan 1 breaking change.
```

---

## Example 2: Node.js Backend (Express + Prisma)

A server-side application with database client and ORM. This example demonstrates handling multiple information sources per library and managing breaking changes in core frameworks.

### Setup with Multiple Sources per Library

```bash
npx devbrief stack add express --urls "https://github.com/expressjs/express/releases,https://expressjs.com/changelog"
npx devbrief stack add prisma --urls "https://github.com/prisma/prisma/releases,https://www.prisma.io/docs/concepts/components/prisma-client/changelog"
npx devbrief stack add postgres-client --urls "https://github.com/brianc/node-postgres/releases"
```

### Scenario: Express 5.0 Released (Major Version with Breaking Changes)

```
[BREAKING] Express 5.0.0
└─ Severity: 62/100
└─ Breaking Changes:
   • Removed deprecated middleware mounting syntax
   • Changed error handling in callback parameters
   • Router changes require app.Router() instead of express.Router()
└─ Your code impact: Estimated 15 files need updates
└─ Recommendation: Schedule 2-day sprint for migration
└─ Migration guide provided
└─ Decision: Will NOT auto-update (breaking change)

Command when ready: npm install express@5.0.0
```

---

## Example 3: Monorepo with Different Risk Profiles

A monorepo containing frontend, backend, and tooling packages with different risk tolerance and upgrade schedules. This demonstrates how DevBrief adapts to varied organizational needs.

### Update Profiles by Package Type

**Frontend packages (React, Vue, Angular):**
- Prefer stable, slower updates
- Higher tolerance for breaking changes
- 1-2 week upgrade window

**Backend packages (Node.js, databases):**
- CRITICAL security updates → deploy same day
- BREAKING changes → weekly updates
- MINOR updates → batch monthly

**Tooling (ESLint, Prettier, TypeScript):**
- Can lag by a month
- Batch in single upgrade push

### Configuration

```bash
npx devbrief stack add frontend-react --urls "..."
npx devbrief stack add backend-express --urls "..."
npx devbrief stack add tooling-eslint --urls "..."

# Different briefing schedules per stack:
DEVBRIEF_CRON_FRONTEND="0 9 * * 1"    # Monday 9 AM
DEVBRIEF_CRON_BACKEND="0 6 * * *"     # Daily 6 AM
DEVBRIEF_CRON_TOOLING="0 9 * * 5"     # Friday 9 AM
```

---

## Example 4: Using the Dashboard

The DevBrief Dashboard provides a visual interface for monitoring and managing your library updates.

### Access

Visit `http://localhost:7890/dashboard`

### Features Demonstrated

- **Library Stack Sorted by Risk:** All tracked libraries displayed with highest-risk items at the top
- **Color-coded Badges:** 
  - 🔴 CRITICAL (red): Security and urgent updates
  - 🟠 BREAKING (orange): Version changes requiring code updates
  - 🔵 MINOR (blue): Patches and routine updates
- **Interactive Details:** Click library name → see full changelog details
- **Risk Breakdown:** Click risk badge → see affected APIs and code patterns
- **Run Information:** Last run timestamp + next scheduled run
- **Quick Actions:** One-click "Trigger Run Now" button for on-demand briefings
- **Dismissals:** Archive updates you've decided not to implement

---

## Example 5: Interpreting Different Risk Scenarios

Common questions and how to interpret DevBrief's classification and recommendations.

### Scenario A: "Library I don't use shows as CRITICAL"

**Question:** Why is OpenCV marked CRITICAL if I'm not using it?

**Answer:** It's a dependency of a library you do use (imagemin-webp).

**Action:** 
- Update imagemin-webp to pull in the patched version, OR
- Contact the imagemin-webp maintainer to report the issue

---

### Scenario B: "Breaking change in devDependency"

**Question:** TypeScript 5.6 is BREAKING - should I update?

**Answer:** Yes, but on your own timeline (not production-critical).

**Timeline:** Can defer 2-4 weeks while planning migration and running compatibility tests.

---

### Scenario C: "Multiple CRITICAL updates needed"

**Question:** 3 CRITICAL security updates - what's the priority?

**Answer:** All are equally urgent. Deploy in this order:

1. Update whichever affects most downstream code
2. Run full test suite after each
3. Deploy to staging environment, then production

**Estimated time:** 2-4 hours

---

## Example 6: Notification Integration

DevBrief can integrate with team communication platforms for real-time alerts and summary digests.

### Discord Message on CRITICAL Update

```
🚨 DevBrief Alert
React 19.0.0: Security fix for XSS vulnerability
Action: Update immediately
Affected project: my-app
https://localhost:7890/digest/run-123
```

### Email Digest (Weekly Summary)

```
DevBrief Weekly Summary
5 CRITICAL | 2 BREAKING | 18 MINOR updates

Critical Updates (act this week):
- React 19.0.0 (XSS fix)
- Express 4.19.2 (auth bypass fix)
- PostgreSQL 16.2 (connection pool vulnerability)

Breaking Updates (plan for next sprint):
- TypeScript 5.6.0 (type inference changes)
- Next.js 15.0.0 (API deprecations)

Minor Updates (batch or defer):
- ESLint 9.0.1 (rule additions)
- Prettier 3.2.5 (formatting tweaks)
... and 14 more

View full digest: https://localhost:7890/dashboard
```

---

## Example 7: Team Coordination

How a team can use DevBrief to coordinate dependency updates across a shared project.

### Workflow

**1. Share Dashboard URL with Team**
- All members have visibility into update status
- No surprise build failures from out-of-sync dependencies

**2. Lead Organizes Upgrades by Risk Level**

**CRITICAL Updates (same-day deployment):**
- Team lead calls all-hands sync
- One person runs test suite while others review changes
- Deploy to production within 4 hours of release
- Example: Security fix in authentication library

**BREAKING Updates (weekly maintenance sprint):**
- Planned in sprint planning meeting
- Estimated 1-3 story points depending on scope
- Dedicated person or pair programs the migration
- Example: Major API redesign in framework

**MINOR Updates (distributed across regular work):**
- Spread across the team's regular development work
- Grab one or two at the start of each sprint
- Low risk, naturally blend into daily work
- Example: Patch releases, performance improvements

### Communication Template

```
📋 DevBrief Update Summary
Updated: Friday 2:00 PM

🔴 CRITICAL (2 updates) - Deploying today
- React 19.0.0: XSS fix
- postgres-client 8.12.1: Connection leak

🟠 BREAKING (1 update) - Next sprint
- TypeScript 5.6.0: Requires type migration (~4 hours)
  Owner: @alice | Due: Next Friday

🔵 MINOR (8 updates) - Regular work
- Assigned throughout team

Questions? Check dashboard or reply in thread.
```

---

## Quick Reference

| Risk Level | Timeline | Action | Auto-Update |
|------------|----------|--------|-------------|
| 🔴 CRITICAL | Same day | Update immediately | Never (manual verification required) |
| 🟠 BREAKING | 1-2 weeks | Plan migration | Never (requires code changes) |
| 🔵 MINOR | 1-4 weeks | Can defer | Optional (low risk) |

---

## Tips for Success

1. **Regular Monitoring:** Run DevBrief at least weekly to catch emerging issues early
2. **Batch Updates:** Group similar-risk updates in single testing/deployment cycles
3. **Automate Testing:** Integrate DevBrief with CI/CD for automated regression testing
4. **Document Decisions:** If deferring a CRITICAL update, document why (may unlock insights)
5. **Team Communication:** Share digest links rather than forwarding fragmented info
6. **Version Pinning:** Use DevBrief alongside lock files (package-lock.json, yarn.lock, Gemfile.lock)
