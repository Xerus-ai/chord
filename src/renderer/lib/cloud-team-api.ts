import { cloudFetch } from '@renderer/lib/cloud-fetch';

/** Teams: members, invites, billing and the team pulse. */

export interface TeamPulseSummary {
  id: string;
  user_id: string;
  summary: string;
  pr_refs: unknown[];
  period_start: string;
  period_end: string;
  generated_at: string;
  user_name: string | null;
  user_email: string;
  user_avatar: string | null;
}

export interface TeamActivity {
  user_id: string;
  status: string;
  work_item_id: string | null;
  active_view: string | null;
  last_seen: string;
  user_name: string | null;
  user_email: string;
  user_avatar: string | null;
}

export interface OrgMember {
  user_id: string;
  role: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export interface OrgInvite {
  id: string;
  org_id: string;
  inviter_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export interface OrgMembershipInfo {
  org_id: string;
  role: string;
  name: string;
  slug: string | null;
  created_at: string;
}

/** A pending invite addressed TO the current user, joined to the org's name. */
export interface MyInvite {
  id: string;
  org_id: string;
  org_name: string;
  role: string;
  expires_at: string;
  created_at: string;
}

export interface OrgSubscription {
  plan: string;
  seat_limit: number;
  seats_used: number;
  subscription_status: string | null;
  current_period_end: string | null;
  has_billing_account: boolean;
}

export const cloudTeamApi = {
  getTeamPulse: (orgId: string) => cloudFetch<TeamPulseSummary[]>(`/team-pulse/${orgId}`),

  getTeamActivity: (orgId: string) => cloudFetch<TeamActivity[]>(`/team-pulse/${orgId}/activity`),

  getOrgs: () => cloudFetch<OrgMembershipInfo[]>('/organizations'),

  renameOrg: (orgId: string, name: string) =>
    cloudFetch<{ id: string; name: string }>(`/organizations/${orgId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  getOrgMembers: (orgId: string) => cloudFetch<OrgMember[]>(`/organizations/${orgId}/members`),

  getOrgInvites: (orgId: string) => cloudFetch<OrgInvite[]>(`/organizations/${orgId}/invites`),

  inviteToOrg: (orgId: string, email: string, role: string = 'member') =>
    cloudFetch<OrgInvite>(`/organizations/${orgId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  getOrgSubscription: (orgId: string) =>
    cloudFetch<OrgSubscription>(`/billing/${orgId}/subscription`),

  createProCheckout: (orgId: string, interval: 'monthly' | 'annual', seats: number) =>
    cloudFetch<{ checkout_id: string; url: string }>(`/billing/${orgId}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ interval, seats }),
    }),

  getBillingPortalUrl: (orgId: string) => cloudFetch<{ url: string }>(`/billing/${orgId}/portal`),

  /** Pending invites addressed to the current user (not org-scoped). */
  getMyInvites: () => cloudFetch<MyInvite[]>('/organizations/invites/mine'),

  /** Invitee accepts; response `org_id` is the workspace to switch into. */
  acceptInvite: (inviteId: string) =>
    cloudFetch<{ org_id: string; status: string }>(`/organizations/invites/${inviteId}/accept`, {
      method: 'POST',
    }),

  /** Invitee declines their own invite. */
  declineInvite: (inviteId: string) =>
    cloudFetch<{ status: string }>(`/organizations/invites/${inviteId}/decline`, {
      method: 'POST',
    }),

  /** Owner-only: revoke a pending invite, freeing its seat. */
  revokeInvite: (orgId: string, inviteId: string) =>
    cloudFetch<{ status: string }>(`/organizations/${orgId}/invites/${inviteId}`, {
      method: 'DELETE',
    }),

  /** Owner-only: remove a member (not the owner, not self). */
  removeMember: (orgId: string, userId: string) =>
    cloudFetch<{ status: string }>(`/organizations/${orgId}/members/${userId}`, {
      method: 'DELETE',
    }),

  /** Member self-leave (the owner must transfer ownership instead). */
  leaveOrg: (orgId: string) =>
    cloudFetch<{ status: string }>(`/organizations/${orgId}/leave`, { method: 'POST' }),
};
