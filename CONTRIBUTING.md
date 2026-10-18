# Contributing to Pigeons

Thanks for your interest in contributing to Pigeons. This guide covers how to set up the project, make changes, and submit a pull request.

## Getting Started

```bash
git clone https://github.com/pigeons-dev/pigeons.git
cd pigeons
pnpm install
pnpm build
```

### Running the dev server

```bash
pnpm dev
```

This starts the core server with hot reload on port 3891.

### Running tests

```bash
pnpm test                    # all unit tests
pnpm typecheck               # type check all packages

# Single package
pnpm --filter @pigeons/core test
pnpm --filter @pigeons/core test -- --run src/__tests__/emails.test.ts
```

Unit tests use in-memory SQLite and do not require AWS credentials.

### E2E tests

E2E tests run against real AWS SES and require credentials. See `e2e/README.md` for setup.

```bash
cd e2e && pnpm e2e
```

## Project Structure

```
packages/
  core/     @pigeons/core    API server (Apache 2.0)
  cli/      @pigeons/cli     CLI tool (MIT)
  mcp/      @pigeons/mcp     MCP server (MIT)
e2e/        E2E test suite
examples/   Runnable examples
```

This is a pnpm monorepo managed with Turborepo. Dependencies are pinned via pnpm catalogs in `pnpm-workspace.yaml`.

## Making Changes

1. Fork the repo and create a branch from `main`.
2. Make your changes. Add tests if you're adding or changing behavior.
3. Run `pnpm test` and `pnpm typecheck` to make sure everything passes.
4. Commit with a short, descriptive message (e.g., `feat: add webhook retry logic`).
5. Open a pull request against `main`.

### Commit messages

Use single-line semantic commit messages:

```
feat: add email scheduling
fix: handle SES throttle on batch send
docs: add webhook setup guide
test: add inbox threading tests
refactor: extract email validation
```

### Code style

- TypeScript strict mode is on.
- No comments unless the "why" is non-obvious.
- No em dashes in content. Use hyphens.
- "Open source" not "Open-source".

## Reporting Bugs

Open an issue on GitHub with:

- What you expected to happen.
- What actually happened.
- Steps to reproduce.
- Pigeons version and environment details.

## Feature Requests

Open a GitHub issue describing the use case. Explain what you're trying to accomplish and why existing features don't cover it.

## License

By contributing, you agree that your contributions will be licensed under the same license as the package you're contributing to (Apache 2.0 for core, MIT for CLI and MCP).
