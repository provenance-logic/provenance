import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { preferencesApi } from '../../shared/api/preferences.js';
import type { Domain, OnboardingState, Organization } from '@provenance/types';

// F7.46 — guided multi-step first-run wizard. Reads/writes
// `/me/preferences` so progress survives across sessions, browsers,
// and devices.
//
// The five steps come from `documents/prd/osr-roadmap.md` Stage 4.
// Three are wired to live destinations (confirm org details, invite
// teammates, publish first product). Two are placeholders with
// skip-only actions pending follow-on PRs (B-025 connector
// registration UI, B-026 agent registration UI). All five steps are
// skippable individually and the wizard as a whole is dismissible.

type StepKey =
  | 'confirm_org'
  | 'invite_team'
  | 'register_connector'
  | 'publish_product'
  | 'invite_agent';

const STEPS: StepKey[] = [
  'confirm_org',
  'invite_team',
  'register_connector',
  'publish_product',
  'invite_agent',
];

const STEP_TITLES: Record<StepKey, string> = {
  confirm_org: 'Confirm your organization',
  invite_team: 'Invite teammates',
  register_connector: 'Register a connector',
  publish_product: 'Publish your first data product',
  invite_agent: 'Invite an AI agent',
};

const EMPTY_STATE: OnboardingState = {
  completedSteps: [],
  skippedSteps: [],
  completedAt: null,
  dismissedAt: null,
  lastStep: null,
};

interface OnboardingWizardProps {
  org: Organization;
  domains: Domain[];
}

export function OnboardingWizard({ org, domains }: OnboardingWizardProps) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    preferencesApi.get()
      .then((res) => {
        if (cancelled) return;
        setState(res.preferences.onboarding ?? EMPTY_STATE);
      })
      .catch(() => {
        // If we can't load preferences, treat it as a fresh wizard but
        // don't block the dashboard. Saving may also fail; the wizard
        // surfaces those errors inline.
        if (cancelled) return;
        setState(EMPTY_STATE);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (next: OnboardingState) => {
    setSaveError(null);
    try {
      await preferencesApi.patch({ onboarding: next });
      setState(next);
    } catch (err) {
      setSaveError((err as Error).message ?? 'Failed to save progress');
      // Still update the in-memory state so the user can keep going;
      // the next persist attempt will retry the full state.
      setState(next);
    }
  }, []);

  if (loading || !state) return null;

  // Hide entirely once the user has finished or explicitly dismissed.
  // A future "Restart onboarding" affordance in user settings could
  // reset these fields.
  if (state.completedAt || state.dismissedAt) return null;

  const currentStep = pickCurrentStep(state);
  if (!currentStep) return null;

  return (
    <div className="mb-6 rounded-lg border border-brand-200 bg-brand-50/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-brand-50/70 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-600 text-white text-xs font-semibold">
            {state.completedSteps.length + state.skippedSteps.length}/{STEPS.length}
          </span>
          <div className="text-left">
            <div className="text-sm font-semibold text-slate-900">Get started with Provenance</div>
            <div className="text-xs text-slate-500">Next: {STEP_TITLES[currentStep]}</div>
          </div>
        </div>
        <span className="text-sm text-slate-500">{collapsed ? 'Expand' : 'Collapse'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-brand-100 bg-white px-5 py-4">
          <StepBody
            stepKey={currentStep}
            org={org}
            domains={domains}
            onSkip={() => {
              const next: OnboardingState = {
                ...state,
                skippedSteps: dedupePush(state.skippedSteps, currentStep),
                lastStep: nextStepAfter(currentStep, state) ?? currentStep,
              };
              if (allDone(next)) next.completedAt = new Date().toISOString();
              void persist(next);
            }}
            onComplete={() => {
              const next: OnboardingState = {
                ...state,
                completedSteps: dedupePush(state.completedSteps, currentStep),
                lastStep: nextStepAfter(currentStep, state) ?? currentStep,
              };
              if (allDone(next)) next.completedAt = new Date().toISOString();
              void persist(next);
            }}
          />
          <div className="mt-4 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                const next: OnboardingState = { ...state, dismissedAt: new Date().toISOString() };
                void persist(next);
              }}
              className="text-slate-500 hover:text-slate-700"
            >
              Dismiss for now
            </button>
            {saveError && <span className="text-red-600">{saveError}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function pickCurrentStep(state: OnboardingState): StepKey | null {
  const done = new Set<string>([...state.completedSteps, ...state.skippedSteps]);
  return STEPS.find((s) => !done.has(s)) ?? null;
}

function nextStepAfter(step: StepKey, state: OnboardingState): StepKey | null {
  const done = new Set<string>([...state.completedSteps, ...state.skippedSteps, step]);
  return STEPS.find((s) => !done.has(s)) ?? null;
}

function allDone(state: OnboardingState): boolean {
  const done = new Set<string>([...state.completedSteps, ...state.skippedSteps]);
  return STEPS.every((s) => done.has(s));
}

function dedupePush(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr : [...arr, v];
}

// ---------------------------------------------------------------------------
// Per-step bodies
// ---------------------------------------------------------------------------

function StepBody({
  stepKey,
  org,
  domains,
  onSkip,
  onComplete,
}: {
  stepKey: StepKey;
  org: Organization;
  domains: Domain[];
  onSkip: () => void;
  onComplete: () => void;
}) {
  const navigate = useNavigate();

  if (stepKey === 'confirm_org') {
    return (
      <Body
        title={STEP_TITLES.confirm_org}
        description="Double-check that your organization details look right. You'll be inviting teammates into this workspace next."
      >
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <div><span className="font-semibold">{org.name}</span> <span className="text-slate-400">/{org.slug}</span></div>
          {org.description && <div className="mt-1 text-slate-500">{org.description}</div>}
        </div>
        <Actions>
          <PrimaryButton onClick={onComplete}>Looks good — continue</PrimaryButton>
          <SkipButton onClick={onSkip} />
        </Actions>
      </Body>
    );
  }

  if (stepKey === 'invite_team') {
    return (
      <Body
        title={STEP_TITLES.invite_team}
        description="Invite teammates to your organization. You can assign them roles like Data product owner or Consumer; governance members author policies. The Roles page sends the email invitation; mark this step done when you've sent your first invite (or skip if you're flying solo for now)."
      >
        <Actions>
          <PrimaryButton onClick={() => navigate(`/dashboard/${org.id}/roles`)}>Open Roles page</PrimaryButton>
          <SecondaryButton onClick={onComplete}>Mark done</SecondaryButton>
          <SkipButton onClick={onSkip} />
        </Actions>
      </Body>
    );
  }

  if (stepKey === 'register_connector') {
    return (
      <Body
        title={STEP_TITLES.register_connector}
        description="Connectors register your existing data systems with Provenance so lineage and access can flow through. The dedicated connector registration UI is coming in a follow-on PR (tracked as B-025); for now you can skip this step and come back when it lands."
      >
        <Actions>
          <SkipButton onClick={onSkip} primary />
        </Actions>
      </Body>
    );
  }

  if (stepKey === 'publish_product') {
    const firstDomain = domains[0];
    if (!firstDomain) {
      return (
        <Body
          title={STEP_TITLES.publish_product}
          description="Data products live inside domains. Create your first domain, then come back here to publish a product."
        >
          <Actions>
            <PrimaryButton onClick={() => navigate(`/onboarding/domain?orgId=${org.id}`)}>Create a domain</PrimaryButton>
            <SkipButton onClick={onSkip} />
          </Actions>
        </Body>
      );
    }
    return (
      <Body
        title={STEP_TITLES.publish_product}
        description={`Publish a draft product inside the "${firstDomain.name}" domain. You can edit it freely while it's in draft state; promoting to published triggers governance checks.`}
      >
        <Actions>
          <PrimaryButton
            onClick={() => navigate(`/dashboard/${org.id}/domains/${firstDomain.id}/products/new`)}
          >
            Open product creation
          </PrimaryButton>
          <SecondaryButton onClick={onComplete}>Mark done</SecondaryButton>
          <SkipButton onClick={onSkip} />
        </Actions>
      </Body>
    );
  }

  if (stepKey === 'invite_agent') {
    return (
      <Body
        title={STEP_TITLES.invite_agent}
        description="Provenance treats AI agents as first-class participants alongside human teams. Register one here — agents start at the Observed trust classification and earn Supervised or Autonomous through governance review. Agents can also self-register via the MCP `register_agent` tool."
      >
        <Actions>
          <PrimaryButton onClick={() => navigate('/agents')}>Open agents page</PrimaryButton>
          <SecondaryButton onClick={onComplete}>Mark done</SecondaryButton>
          <SkipButton onClick={onSkip} />
        </Actions>
      </Body>
    );
  }

  return null;
}

function Body({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pt-2">{children}</div>;
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

function SkipButton({ onClick, primary }: { onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? 'px-3 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700'
          : 'px-3 py-2 text-sm text-slate-500 hover:text-slate-700'
      }
    >
      {primary ? 'Skip this step' : 'Skip'}
    </button>
  );
}
