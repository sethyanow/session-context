# Development Workflow

This document outlines the branching strategy and development workflow for the session-context project.

## Initial Setup

If the `dev` branch doesn't exist yet, run the setup script after merging this PR to `main`:

```bash
./scripts/setup-dev-branch.sh
```

This will create the `dev` branch and push it to GitHub.

## Branch Structure

### `main` branch
- Production-ready code
- Only accepts merges from `dev` branch via pull requests
- Protected branch (requires PR reviews)
- Tagged releases are created from this branch (e.g., `v0.0.1`, `v1.0.0`)
- CI/CD runs on all commits and PRs

### `dev` branch
- Development and integration branch
- All feature branches merge here first
- Pre-release versions can be tagged from this branch (e.g., `v0.0.2-alpha.1`, `v0.1.0-beta.1`)
- CI/CD runs on all commits and PRs
- Periodically merged to `main` when stable

### Feature branches
- Created from `dev` branch
- Naming convention: `feature/description`, `fix/description`, `copilot/description`
- Merged back to `dev` via pull request
- Deleted after merge

## Version Strategy

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** version (X.0.0): Incompatible API changes
- **MINOR** version (0.X.0): New functionality, backwards compatible
- **PATCH** version (0.0.X): Bug fixes, backwards compatible

### Pre-release versions
- **Alpha** (`v0.1.0-alpha.1`): Early testing, unstable
- **Beta** (`v0.1.0-beta.1`): Feature complete, testing phase
- **RC** (`v0.1.0-rc.1`): Release candidate, final testing

## Workflow

### Starting new work

1. Ensure you have the latest `dev` branch:
   ```bash
   git checkout dev
   git pull origin dev
   ```

2. Create a feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```

3. Make your changes and commit:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

4. Push and create a PR to `dev`:
   ```bash
   git push origin feature/my-feature
   ```

### Commit message format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `refactor:` - Code refactoring
- `test:` - Test changes
- `ci:` - CI/CD changes

### Creating releases

#### Pre-release (from `dev`)

1. Update version in `mcp/package.json` (e.g., `0.1.0-alpha.1`)
2. Update `CHANGELOG.md` with changes
3. Commit and push to `dev`
4. Create and push a tag:
   ```bash
   git tag v0.1.0-alpha.1
   git push origin v0.1.0-alpha.1
   ```
5. GitHub Actions will automatically create a pre-release

#### Production release (from `main`)

1. Create a PR from `dev` to `main`
2. Review and merge the PR
3. Update version in `mcp/package.json` (e.g., `0.1.0`)
4. Update `CHANGELOG.md` with final changes
5. Commit and push to `main`
6. Create and push a tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
7. GitHub Actions will automatically create a release

## Automation

### Continuous Integration
- Runs on all pushes and PRs to `main` and `dev`
- Executes: type checking, linting, tests, and build
- Must pass before merging

### Security Audit
- Runs on all pushes and PRs to `main` and `dev`
- Runs weekly on Mondays at 9am UTC
- Audits dependencies for vulnerabilities

### Release Workflow
- Triggered when a tag matching `v*` is pushed
- Builds the project and creates a GitHub release
- Attaches build artifacts to the release
- Extracts release notes from CHANGELOG.md

### Pre-release Workflow
- Triggered when a tag matching `v*-alpha.*`, `v*-beta.*`, or `v*-rc.*` is pushed
- Same as release workflow but marks the release as pre-release

## Branch Protection (Recommended)

Configure the following branch protection rules in GitHub:

### `main` branch
- Require pull request reviews before merging (1+ approvals)
- Require status checks to pass (CI, Security)
- Require branches to be up to date before merging
- Do not allow force pushes
- Do not allow deletions

### `dev` branch
- Require status checks to pass (CI, Security)
- Require branches to be up to date before merging
- Allow force pushes (for maintainers only)
- Do not allow deletions

## Quick Reference

```bash
# Create dev branch (one time setup)
git checkout -b dev
git push -u origin dev

# Start new feature
git checkout dev
git pull origin dev
git checkout -b feature/my-feature

# Complete feature
git push origin feature/my-feature
# Create PR to dev on GitHub

# Create pre-release
git checkout dev
# Update version to 0.1.0-alpha.1 in package.json and CHANGELOG.md
git commit -am "chore: bump version to 0.1.0-alpha.1"
git tag v0.1.0-alpha.1
git push origin dev --tags

# Promote dev to main
git checkout main
git pull origin main
git merge dev
git push origin main
git tag v0.1.0
git push origin --tags
```
