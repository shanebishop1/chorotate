# Release safety

- Never push directly to `main`. Use a pull request and wait for the complete required `release-quality` check.
- Never waive a failed audit, test, build, generated-file check, or release gate, even for a hotfix or a pre-existing failure. Fix it first.
- Production deployment requires a clean checkout of the latest `origin/main` and successful GitHub release-quality evidence for that exact commit. Use the guarded production script; never invoke Wrangler deploy directly.
- Dependabot updates (including major updates) may merge automatically only after required CI passes. They must use the same guarded deployment path as other changes.
- Never print private production configuration or credentials, or add AI attribution to commits/PRs.
