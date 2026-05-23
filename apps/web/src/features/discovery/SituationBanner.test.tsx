/**
 * Tests for the SituationBanner — F10.15 (Phase 5.9) consumer-flow UI.
 *
 * Pins the three rendering variants:
 *   - Situation A → "Open access" (emerald)
 *   - Situation B + caller has grant → "Access granted" (blue)
 *   - Situation B + no grant → "Access required" (amber)
 *
 * Leaf-component pattern per the same approach as
 * AgentDetailPage.test.tsx and SourceBindingPicker.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PortSituationResponse } from '@provenance/types';
import { SituationBanner } from './ProductDetailPage.js';

const baseSituation = (overrides: Partial<PortSituationResponse> = {}): PortSituationResponse => ({
  portId: '00000000-0000-0000-0000-000000000001',
  productId: '00000000-0000-0000-0000-000000000002',
  situation: 'B',
  recommendedNext: 'request_access',
  callerHasActiveGrant: false,
  declaredSituationAEligible: false,
  ...overrides,
});

describe('SituationBanner', () => {
  it('renders an Open Access banner when situation is A', () => {
    render(<SituationBanner situation={baseSituation({
      situation: 'A',
      recommendedNext: 'view_snippet',
      declaredSituationAEligible: true,
    })} />);

    expect(screen.getByText(/open access/i)).toBeInTheDocument();
    expect(screen.getByText(/no per-product access request needed/i)).toBeInTheDocument();
    expect(screen.queryByText(/access required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/access granted/i)).not.toBeInTheDocument();
  });

  it('renders an Open Access banner even when the caller incidentally has a grant', () => {
    // The endpoint reports callerHasActiveGrant truthfully even on Situation A
    // ports. The banner should still say "open access" because the port-level
    // declaration trumps the grant signal at the consumer connect flow.
    render(<SituationBanner situation={baseSituation({
      situation: 'A',
      recommendedNext: 'view_snippet',
      declaredSituationAEligible: true,
      callerHasActiveGrant: true,
    })} />);

    expect(screen.getByText(/open access/i)).toBeInTheDocument();
  });

  it('renders an Access Granted banner when situation is B + caller has grant', () => {
    render(<SituationBanner situation={baseSituation({
      situation: 'B',
      recommendedNext: 'view_snippet',
      callerHasActiveGrant: true,
    })} />);

    expect(screen.getByText(/access granted/i)).toBeInTheDocument();
    expect(screen.getByText(/pick a tool to generate/i)).toBeInTheDocument();
    expect(screen.queryByText(/access required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/open access/i)).not.toBeInTheDocument();
  });

  it('renders an Access Required banner when situation is B + no grant', () => {
    render(<SituationBanner situation={baseSituation({
      situation: 'B',
      recommendedNext: 'request_access',
      callerHasActiveGrant: false,
    })} />);

    expect(screen.getByText(/access required/i)).toBeInTheDocument();
    expect(screen.getByText(/use the access tab to request access/i)).toBeInTheDocument();
    expect(screen.queryByText(/access granted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/open access/i)).not.toBeInTheDocument();
  });
});
