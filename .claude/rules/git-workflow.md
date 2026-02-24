# Git Workflow - Use Branches, Not Main

**NEVER work directly on the `main` branch** unless explicitly instructed AND already in-flight on a task.

When starting new work:
1. **First action**: Create a feature branch (`git checkout -b feature/description`)
2. Do all work on the feature branch
3. Push the branch and create a PR
4. Merge to main only after review

The only exception is if you're explicitly told to work on main AND you're already mid-task. Even then, prefer branches.
