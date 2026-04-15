Review the checked out pull request changes against the fetched base branch from `origin`.
If `GITHUB_BASE_REF` is set, inspect the actual diff with `git diff origin/$GITHUB_BASE_REF...HEAD`.
Otherwise, determine the fetched base branch from git refs and inspect that diff.

Return concise Markdown with exactly these sections and headings:

## What is good

## To improve

## Mandatory fixes

Requirements:
- Base the review on the actual git diff, not only on file names.
- Reference files or behaviors when useful.
- In `## Mandatory fixes`, include only concrete blocking issues or regressions.
- If there are no blocking issues, write `None.` under `## Mandatory fixes`.
- Do not approve the PR.
