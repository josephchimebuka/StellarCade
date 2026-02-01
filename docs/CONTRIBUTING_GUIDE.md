# Extended Contribution Guide

This guide provides deeper technical details for developers contributing to Stellarcade.

## 🎋 Git Branching Strategy

We follow a variation of GitFlow:

- `main`: Production-ready code.
- `develop`: Integration branch for features.
- `feat/*`: Feature branches (merged into `develop`).
- `fix/*`: Bug fix branches (merged into `develop` or `main`).
- `release/*`: Preparation for a new production release.

## 🔎 Code Review Process

- All PRs require at least one approval from a maintainer.
- Reviewers look for:
  - Logic correctness.
  - Test coverage.
  - Adherence to style guides.
  - Security implications.
  - Documentation updates.

## 🧪 Testing Requirements

### Smart Contracts

- 100% coverage of all public functions.
- Edge case testing (zero amounts, max values, unauthorized access).

### Backend

- Unit tests for services and helpers.
- Integration tests for all API endpoints using `supertest`.

## 📚 Documentation Standards

- Write in clear, concise English.
- Use Mermaid diagrams for complex flows.
- Use GitHub Alerts for important notes.
- Keep the `README.md` up to date with core architectural changes.

## 🕰 Development Workflow

1. Pick an issue.
2. Discuss the approach in the issue comments.
3. Create a branch: `git checkout -b feat/my-cool-feature`.
4. Write code & tests.
5. Run linting: `npm run lint` or `cargo clippy`.
6. Push and create a Pull Request.

---

_We value your time and expertise. Let's build something amazing together!_
