import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Loader2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cloudTeamApi } from '@renderer/lib/cloud-team-api';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';

const PRO_MAX_SEATS = 50;
const CHECKOUT_POLL_MS = 3000;
const CHECKOUT_POLL_TIMEOUT_MS = 15 * 60 * 1000;

export const ORG_SUBSCRIPTION_KEY = (orgId: string) => ['billing', 'subscription', orgId];

/**
 * Plan and seat state for the team, with the upgrade path. Checkout is
 * Polar-hosted: the button opens the checkout URL in the system browser and
 * this card polls the subscription endpoint until the webhook flips the org
 * to pro — the desktop app never sees a return redirect.
 */
export function TeamBillingCard({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();

  const { data: sub, isLoading } = useQuery({
    queryKey: ORG_SUBSCRIPTION_KEY(orgId),
    queryFn: () => cloudTeamApi.getOrgSubscription(orgId),
    staleTime: 10_000,
  });

  const { data: memberships } = useQuery({
    queryKey: ['organizations', 'memberships'],
    queryFn: () => cloudTeamApi.getOrgs(),
    staleTime: 30_000,
  });
  const role = memberships?.find((m) => m.org_id === orgId)?.role ?? 'member';
  const isAdmin = role === 'owner' || role === 'admin';

  const [pickerOpen, setPickerOpen] = useState(false);
  const [seats, setSeats] = useState<number | null>(null);
  const [interval, setInterval_] = useState<'monthly' | 'annual'>('monthly');
  const [checkoutState, setCheckoutState] = useState<'idle' | 'starting' | 'waiting'>('idle');
  const [error, setError] = useState<string | null>(null);

  const minSeats = Math.max(sub?.seats_used ?? 1, 1);
  const chosenSeats = seats ?? minSeats;

  // Success is DERIVED, never synced into state: the Polar webhook flips the
  // org's plan, the poll below re-fetches it, and `waitingForUpgrade` goes
  // false on its own — the pro-plan render ignores the stale 'waiting' flag.
  const waitingForUpgrade = checkoutState === 'waiting' && sub?.plan === 'free';

  // Poll while a checkout tab is open; the plan change is observed, never
  // assumed.
  useEffect(() => {
    if (!waitingForUpgrade) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt > CHECKOUT_POLL_TIMEOUT_MS) {
        setCheckoutState('idle');
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ORG_SUBSCRIPTION_KEY(orgId) });
    }, CHECKOUT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waitingForUpgrade, orgId, queryClient]);

  const handleCheckout = useCallback(async () => {
    setError(null);
    setCheckoutState('starting');
    try {
      const { url } = await cloudTeamApi.createProCheckout(orgId, interval, chosenSeats);
      await rpc.app.openExternal(url);
      setCheckoutState('waiting');
    } catch (e) {
      setCheckoutState('idle');
      setError(e instanceof Error ? e.message : 'Could not start checkout');
    }
  }, [orgId, interval, chosenSeats]);

  const handlePortal = useCallback(async () => {
    setError(null);
    try {
      const { url } = await cloudTeamApi.getBillingPortalUrl(orgId);
      await rpc.app.openExternal(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the billing portal');
    }
  }, [orgId]);

  if (isLoading || !sub) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface-raised px-4 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-text-passive" />
        <span className="text-tiny tracking-tiny text-text-passive">Loading plan...</span>
      </div>
    );
  }

  const planLabel = sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1);
  const seatsFull = sub.seats_used >= sub.seat_limit;

  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-body tracking-body font-semibold text-text">
              {planLabel} plan
            </span>
            <span
              className={cn(
                'text-tiny tracking-tiny tabular-nums',
                seatsFull ? 'text-status-err' : 'text-text-passive'
              )}
            >
              {sub.seats_used} of {sub.seat_limit} seats used
            </span>
          </div>
          {sub.subscription_status === 'canceled' && sub.current_period_end && (
            <p className="mt-0.5 text-tiny tracking-tiny text-text-passive">
              Pro access ends {new Date(sub.current_period_end).toLocaleDateString()}
            </p>
          )}
          {sub.subscription_status === 'past_due' && (
            <p className="mt-0.5 text-tiny tracking-tiny text-status-err">
              Payment past due — update your payment method.
            </p>
          )}
        </div>

        {isAdmin && sub.plan === 'free' && !pickerOpen && (
          <button
            onClick={() => setPickerOpen(true)}
            className="shrink-0 rounded-md bg-action-bg px-3 py-1.5 text-tiny tracking-tiny font-semibold text-action-fg transition-colors hover:bg-action-bg-hover"
          >
            Upgrade to Pro
          </button>
        )}
        {isAdmin && sub.has_billing_account && (
          <button
            onClick={() => void handlePortal()}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:border-border-strong hover:bg-surface-inset hover:text-text"
          >
            <CreditCard className="h-3.5 w-3.5" />
            Manage billing
          </button>
        )}
      </div>

      {pickerOpen && sub.plan === 'free' && !waitingForUpgrade && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSeats(Math.max(minSeats, chosenSeats - 1))}
              disabled={chosenSeats <= minSeats}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border-strong text-text-muted transition-colors hover:bg-surface-inset disabled:text-text-disabled"
              aria-label="Fewer seats"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[72px] text-center text-body tracking-body tabular-nums text-text">
              {chosenSeats} seat{chosenSeats !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setSeats(Math.min(PRO_MAX_SEATS, chosenSeats + 1))}
              disabled={chosenSeats >= PRO_MAX_SEATS}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border-strong text-text-muted transition-colors hover:bg-surface-inset disabled:text-text-disabled"
              aria-label="More seats"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex overflow-hidden rounded-md border border-border-strong">
            {(['monthly', 'annual'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setInterval_(option)}
                className={cn(
                  'px-3 py-1 text-tiny tracking-tiny font-medium transition-colors',
                  interval === option
                    ? 'bg-selected-bg text-text'
                    : 'text-text-passive hover:text-text-muted'
                )}
              >
                {option === 'monthly' ? 'Monthly' : 'Annual'}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                setPickerOpen(false);
                setError(null);
              }}
              className="text-tiny tracking-tiny text-text-passive transition-colors hover:text-text-muted"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleCheckout()}
              disabled={checkoutState === 'starting'}
              className="flex items-center gap-1.5 rounded-md bg-action-bg px-3 py-1.5 text-tiny tracking-tiny font-semibold text-action-fg transition-colors hover:bg-action-bg-hover disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
            >
              {checkoutState === 'starting' && <Loader2 className="h-3 w-3 animate-spin" />}
              Continue to checkout
            </button>
          </div>
        </div>
      )}

      {waitingForUpgrade && (
        <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
          <Loader2 className="h-4 w-4 animate-spin text-text-passive" />
          <span className="flex-1 text-tiny tracking-tiny text-text-passive">
            Complete the checkout in your browser — your plan updates here automatically.
          </span>
          <button
            onClick={() => setCheckoutState('idle')}
            className="text-tiny tracking-tiny text-text-passive transition-colors hover:text-text-muted"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-tiny tracking-tiny text-status-err">{error}</p>}
    </div>
  );
}
