# Contributing to Provenance

Thank you for your interest in contributing to Provenance. This guide covers everything you need to get started.

## Prerequisites

- **Node.js 20+** and **pnpm 9+** (the monorepo uses pnpm workspaces)
- **Docker** and **Docker Compose v2** (for the infrastructure stack)
- **Git**

## Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/provenance-logic/provenance.git
   cd provenance
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Start the infrastructure stack:**
   ```bash
   cd infrastructure/docker
   docker compose up -d
   ```
   This starts PostgreSQL, Neo4j, Redpanda, OpenSearch, OPA, and Keycloak.

4. **Run database migrations:**
   Flyway migrations run automatically via the `flyway-migrate` container. Wait for it to exit before starting the API.

5. **Start the API:**
   ```bash
   cd apps/api
   pnpm run start:dev
   ```

6. **Start the frontend:**
   ```bash
   cd apps/web
   pnpm run dev
   ```

7. **Access the application:**
   - Frontend: `http://localhost:5173`
   - API: `http://localhost:3001`
   - Keycloak admin: `http://localhost:8080`
   - Neo4j browser: `http://localhost:7474`

## Three Coding Rules

These are non-negotiable in this project. PRs that violate them will be asked to revise.

### 1. Spec-first

Define or update the OpenAPI spec in `packages/openapi/` **before** writing implementation code. Types are generated from the spec. The spec is the source of truth for all API contracts.

### 2. Migration-first

Write Flyway migration files as the authoritative schema definition **before** writing TypeORM entities. Migrations live in `infrastructure/docker/flyway/` and are numbered sequentially. The database schema is defined by migrations, not by ORM synchronization.

### 3. Test-first

Write failing tests **before** implementation. Test names describe behavior, not implementation details. Run the full test suite before submitting a PR.

## Running Tests

```bash
# API tests
cd apps/api
pnpm test

# Agent query layer tests
cd apps/agent-query
pnpm test

# Type checking (all apps)
pnpm run typecheck
```

## Submitting a Pull Request

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the three coding rules above.

3. **Run tests and type checking** to make sure nothing is broken.

4. **Commit with a clear message.** Use the format:
   ```
   <scope>: <short description>
   ```
   Examples: `governance: add grace period extension API`, `lineage: fix cycle detection in traversal`, `docs: update ADR-003 with production notes`.

5. **Push and open a PR** against `main`. Include:
   - A summary of what changed and why
   - How to test the change
   - Any related issues

6. **Keep PRs focused.** One logical change per PR. If a refactor is needed to support a feature, it can go in the same PR if they are tightly coupled, but avoid bundling unrelated changes.

## Architecture Decision Records

Significant technical decisions require an ADR before implementation. ADRs live in `documents/architecture/adr/` and follow a simple format:

- **Numbered sequentially** (e.g., `ADR-003-your-decision.md`)
- **Sections:** Title, Date, Status, Context, Decision, Consequences
- **Status lifecycle:** Proposed, Accepted, Deprecated, Superseded

Examples of decisions that need an ADR:
- Adding a new infrastructure dependency
- Changing the authentication or authorization model
- Modifying the data model in a way that affects multiple modules
- Introducing a new integration pattern or protocol

When in doubt, open an issue to discuss before writing the ADR.

## What to Work On

High-value contributions at this stage:

- SDK implementations for Python, Java, and Scala (lineage emission)
- Additional connector implementations
- Review and feedback on the PRD and architecture documents (open an issue)
- Bug reports with reproduction steps
- Domain expertise in data mesh, federated governance, or agentic AI systems

## Code of Conduct

All participants in the Provenance project are expected to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

By contributing to Provenance, you agree that your contributions will be licensed under the [Apache License 2.0](./LICENSE).
