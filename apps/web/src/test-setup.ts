// Vitest setup. Loaded once per test run via vitest.config.ts's `setupFiles`.
//
// Adds jest-dom matchers (`toBeInTheDocument`, `toHaveClass`, `toHaveTextContent`, etc.)
// so tests can assert against the rendered DOM with readable expectations.
//
// For a component test pattern example, see
// `src/features/agents/AgentDetailPage.test.tsx`.
import '@testing-library/jest-dom/vitest';
