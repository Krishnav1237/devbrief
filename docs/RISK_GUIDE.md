# Understanding DevBrief Risk Levels

This guide helps you understand what each risk classification means and how to act on it.

## Quick Reference

| Risk Level | Severity Score | Color | Recommendation | Timeline |
|------------|----------------|-------|-----------------|----------|
| CRITICAL | 80-100 | 🔴 Red | Update immediately | Today/Tomorrow |
| BREAKING | 50-79 | 🟠 Orange | Plan upgrade | This sprint |
| MINOR | 0-49 | 🔵 Blue | Can defer | Next month+ |

---

## Deep Dive: CRITICAL 🔴

**When to act:** Immediately  
**Who should know:** Your team lead, DevOps, security team

### What triggers it

- **Security vulnerability (CVE)** detected by npm audit or security advisories
- **Zero-day fix** or high-severity security issue that affects real-world systems
- **Directly affects** a library in your project's dependencies
- **No known workaround** available

### Examples

- "React 19.1.0: Fixes XSS vulnerability in JSX parser"
- "Next.js 15.0.3: Security patch for path traversal attack"
- "Express-session 1.17.3: Fixes session fixation vulnerability"

### Action Items

1. **Read the security advisory** — Link is provided in DevBrief
2. **Check if your project is affected** — DevBrief already verified this for you
3. **Prioritize deployment** — Flag this in your team's kanban board
4. **Run tests thoroughly** — Before and after upgrade
5. **Test in staging first** — Verify the fix doesn't introduce new issues

### Workflow

```
1. npm install react@latest (or the patched version)
2. npm test
3. Review changelog for any breaking changes
4. Deploy to staging environment
5. Run smoke tests in staging
6. Deploy to production
7. Monitor error tracking for issues
```

---

## Deep Dive: BREAKING 🟠

**When to act:** This sprint (1-2 weeks)  
**Who should know:** Your team, product manager (for timeline impact)

### What triggers it

- **"BREAKING CHANGE"** in changelog or release notes
- **API removal** — Function, method, or parameter no longer exists
- **Function signature change** — Different parameters or return type
- **Deprecation notice** — Library warns it will remove in next major version
- **Requires code updates** — Your project's code must change to work with new version

### Examples

- "Express 5.0: Removed deprecated middleware mounting syntax"
- "TypeScript 5.0: Removed support for Node <14.17"
- "Lodash 4.0: Renamed utility functions"
- "Next.js 12.0: Removed deprecated `next/image` component API"

### Action Items

1. **Read the migration guide** — Usually in the changelog or official docs
2. **Assess impact on your codebase** — How many files affected? How complex?
3. **Search your code** — Use grep to find usages of breaking APIs
4. **Plan in a sprint** — Allocate 1-3 days depending on complexity
5. **Update affected code** — Refactor to use new API
6. **Run full test suite** — Breaking changes often have edge cases

### Decision Matrix

| Situation | Action | Timeline |
|-----------|--------|----------|
| You use affected APIs | Upgrade this sprint | 1-2 weeks |
| It's in `devDependencies` only (tests, build) | Can defer if not blocking | Next sprint |
| It's a major version bump | Treat as project upgrade | Plan accordingly |
| Deprecation warning only | Plan ahead, don't rush | Next 2 months |

---

## Deep Dive: MINOR 🔵

**When to act:** When convenient  
**Who should know:** The maintainer (good practice, but not urgent)

### What triggers it

- **New features** — Adds functionality, no breaking changes
- **Improvements** — Better performance, UX, or code quality
- **Bugfixes** — Non-critical bugs fixed (performance, edge cases)
- **Performance optimizations** — Faster execution, smaller bundles
- **Patch and minor version updates** — `1.0.0` → `1.0.1` or `1.1.0`
- **No breaking changes** — Your code continues to work as-is

### Examples

- "React 18.2.1: Performance improvements for Suspense"
- "Vitest 1.0.1: Fixed race condition in watch mode"
- "Prettier 3.1.0: Added support for new language syntax"
- "webpack 5.88.0: Improved bundling performance by 10%"

### Action Items

1. **Optional to upgrade** — Your project works fine without it
2. **Good practice to stay current** — Minor updates keep you secure and performant
3. **Safe to batch** — Combine with other MINOR updates
4. **Minimal testing required** — Smoke test is usually enough
5. **Update regularly** — Quarterly or with your release cycle

### Workflow

```
# Safe way to update MINOR/PATCH versions
npm update
npm test
npm audit
Commit and deploy
```

---

## Decision Tree

```
Is update CRITICAL?
├─ YES → Update today
│        ├─ Read security advisory
│        ├─ Test thoroughly
│        └─ Deploy ASAP
│
└─ NO → Is it BREAKING?
        ├─ YES → Plan for this sprint
        │        ├─ Review migration guide
        │        ├─ Search for API usage in your code
        │        ├─ Update code
        │        └─ Schedule testing
        │
        └─ NO → MINOR update
                ├─ Optional to upgrade
                ├─ Batch with other updates
                └─ Update when convenient
```

---

## FAQ

### Q: Why is this library marked CRITICAL when I don't use it?

**A:** This shouldn't happen — DevBrief only checks your dependencies. If it does appear, it's likely a **peer dependency** or **transitive dependency** of something you use. Example: You use `Next.js`, which depends on `React`. A critical `React` update shows up because your project actually uses it.

**How to verify:** Run `npm list package-name` to see the dependency chain.

### Q: Can I ignore a BREAKING change if I don't use the breaking API?

**A:** Generally **yes, but be cautious**. Not all breaking changes are equal:

- **API removal:** If you don't use it, you're safe
- **Default behavior change:** May silently break your code
- **Library behavior shift:** Could affect unexpected parts

**How to measure:** Run `npm audit`, search your codebase for the affected API, and test thoroughly.

### Q: How often should I update?

**A:** 
- **CRITICAL:** Today
- **BREAKING:** Monthly (in a dedicated sprint)
- **MINOR:** Quarterly, or batch with releases

**Best practice:** Update MINOR versions monthly in a single batch. This keeps dependencies fresher and spreads out maintenance work.

### Q: What if I disagree with the risk level?

**A:** DevBrief's classifications are **data-driven**, based on change metadata and CVE databases. If you believe a classification is wrong:

1. File an issue on the DevBrief GitHub repo
2. Include: Library name, version, why you disagree
3. Example: "TypeScript 5.0.1 marked BREAKING, but it's only a MINOR release"

We continuously improve the classification algorithm based on feedback.

### Q: My team has limited time — which updates should we prioritize?

**A:** 
1. **CRITICAL** — Always, no exceptions
2. **BREAKING** — Once per sprint in a dedicated task
3. **MINOR** — Batch monthly or skip if stable

### Q: Can a MINOR update become CRITICAL later?

**A:** No, but a **later version** can. Example: `lodash 4.17.20` is MINOR, but `lodash 4.17.21` fixes a security issue and is CRITICAL.

---

## Real-World Examples

### Example 1: React Security Update (CRITICAL)

**Briefing:** "[CRITICAL] React 18.2.1: Security fix for XSS in JSX parser"

**What happened:** A vulnerability in React's JSX processing allows XSS attacks in certain scenarios.

**Your action:**
1. Update today: `npm install react@18.2.1`
2. Run tests: `npm test`
3. Deploy to staging and test manually
4. Deploy to production tomorrow

**Impact:** 30 minutes to 2 hours total

---

### Example 2: Express Breaking Change (BREAKING)

**Briefing:** "[BREAKING] Express 5.0: Removed deprecated middleware mounting syntax"

**What happened:** Express removed the old `app.use()` for mounting apps. Your code must use `app.use(router)` instead of the old method.

**Your action:**
1. Check migration guide: https://expressjs.com/en/guide/migrating-5.html
2. Search your code: `grep -r "app.use(" src/`
3. Spend 1-2 days updating code
4. Run full test suite
5. Deploy with next release

**Impact:** 1-2 days of work, plus testing

---

### Example 3: TypeScript Patch (MINOR)

**Briefing:** "[MINOR] TypeScript 5.2.3: Improves type checking performance"

**What happened:** TypeScript's type checker is 15% faster. No API changes, just a nice upgrade.

**Your action:**
1. Update next week: `npm install typescript@5.2.3`
2. Run `npm test` (should pass immediately)
3. Deploy with next release

**Impact:** 15 minutes, zero risk

---

## Integration with Your Workflow

### Daily Voice Briefing

Listen to **CRITICAL items first**. Your briefing is sorted by severity.

- Review critical updates
- Plan their deployment
- Mention to your team lead

### Weekly Team Sync

Discuss **BREAKING changes** as a team:

- Plan which sprint to tackle them
- Assign work
- Estimate effort

### Monthly Maintenance

Batch and deploy **MINOR updates**:

- Run `npm update`
- Run full test suite
- Deploy with next release

### Quarterly Review

Audit your dependencies:

- Check for updates you missed
- Update security-sensitive libraries
- Review deprecation warnings

---

## Getting More Details

### On DevBrief Dashboard

1. **Click library name** → Full changelog and release notes
2. **Click severity badge** → Detailed risk analysis
3. **View source links** → GitHub releases, npm pages

### In Your Terminal

```bash
# See full changelog for a library
npm view react

# Check what would change
npm outdated

# See the diff
npm diff react@18.2.0 react@18.2.1

# Check for security issues only
npm audit
```

### External Resources

- **Security advisories:** https://github.com/advisories (GitHub Security Advisories)
- **npm audit:** Run locally for detailed CVE info
- **Changelog:** Always check the library's GitHub releases page
- **Migration guides:** Usually in official docs (e.g., expressjs.com/migrating-5)

---

## Summary

| Risk | Action | Timeline | Example |
|------|--------|----------|---------|
| 🔴 CRITICAL | Update immediately | Today/Tomorrow | Security vulnerability |
| 🟠 BREAKING | Plan upgrade | This sprint | API removal |
| 🔵 MINOR | Can defer | Next month+ | New feature |

**Remember:** DevBrief's classifications help you prioritize. Trust the data, but always review the changelog yourself. When in doubt, test thoroughly.
