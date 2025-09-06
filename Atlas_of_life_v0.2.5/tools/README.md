# Atlas Tools

This directory contains helper scripts and prompts for maintaining and evolving the Atlas of life project. They automate routine tasks and provide guidance for larger refactors.

## changelog.ps1 / changelog.sh

Use these scripts to update the `CHANGELOG.md`. They move the **Unreleased** section under a new version heading and insert today’s date. The PowerShell version can optionally create a git tag.

### Examples

On Windows/PowerShell:

```powershell
pwsh -File tools/changelog.ps1 -Version 0.2.6
# Optionally tag the repository at the same time:
pwsh -File tools/changelog.ps1 -Version 0.2.6 -Tag
```

On Unix-like systems:

```bash
bash tools/changelog.sh 0.2.6
```

## bump.ps1

This script searches the project for version strings like `Atlas of life — vX.Y.Z` and `Atlas_of_life_vX.Y.Z` and replaces them with the new version number. It also updates the changelog by calling `changelog.ps1` under the hood.

Example:

```powershell
pwsh -File tools/bump.ps1 -Version 0.2.6
```

## githooks/commit-msg

A Git commit message hook to enforce the [Conventional Commits](https://www.conventionalcommits.org/) standard. To use it, copy the file to `.git/hooks/commit-msg` in your repository and make sure it is executable. Commits with messages not matching the expected pattern will be rejected.

## append-changelog.ps1 + githooks/post-commit

Automatically appends each commit subject into `CHANGELOG.md` under the `## [Unreleased]` section.

Setup:

- Point Git to use this repo's hooks directory:

  ```bash
  git config core.hooksPath tools/githooks
  ```

- Ensure PowerShell 7+ (`pwsh`) is available in PATH.

Behavior:

- After every commit, the hook runs `tools/append-changelog.ps1` which inserts a line like `- feat: add X (abc123)` right under `## [Unreleased]`. Existing history is preserved and duplicates are avoided by commit hash.

## bump-version.ps1 (release helper)

Creates a new section like `## Atlas_of_life_vX.Y.Z - YYYY-MM-DD HH:mm` at the top. If `## [Unreleased]` contains items, they are moved under the new section and cleared from `Unreleased`. Also updates `js/app.js` fallback `APP_VERSION`.

Examples:

```powershell
pwsh -File tools/bump-version.ps1 -Part patch     # 0.2.6 -> 0.2.7
pwsh -File tools/bump-version.ps1 -Version 0.2.8  # exact version
pwsh -File tools/bump-version.ps1 -Part minor -Tag # bump + git tag vX.Y.Z
```

## prompts

The `prompts` folder contains instructions for code generation tools, such as GitHub Copilot or the GPT‑powered assistant in VS Code.

- `reorg-minimal.txt` describes a minimal refactoring effort that adds a migration system, storage adapters, theme support, analytics and a state facade without rearranging the existing files. Use this when preparing release 0.2.6.
- `reorg-full.txt` outlines a comprehensive restructuring into feature‑oriented modules, introducing a clean directory layout and breaking changes. Use this for planning a 0.3.0 release.

These prompts are suggestions and should be adapted to your workflow. They aim to provide clear tasks for automated refactoring tools.
