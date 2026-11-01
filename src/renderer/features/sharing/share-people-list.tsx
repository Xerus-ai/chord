import { ShareMemberRow } from './share-member-row';
import type { SharePeopleRow } from './share-people-rows';
import type { MemberRole } from './sharing-api';

const TAG_CLASS =
  'shrink-0 rounded-sm bg-surface-inset px-1.5 py-0.5 text-micro tracking-micro font-medium text-text-muted';

/**
 * "People with access" (sharePeopleRows): members can be managed by the
 * author; people who reach it another way say how, and an artifact-only
 * person's tag opens that artifact's scope, where their access is managed.
 */
export function SharePeopleList({
  rows,
  canManage,
  onRoleChange,
  onRemove,
  onOpenArtifact,
}: {
  rows: SharePeopleRow[];
  canManage: boolean;
  onRoleChange: (memberId: string, role: MemberRole) => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
  onOpenArtifact: (artifactId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1" data-testid="share-people">
      <span className="mb-1 text-tiny font-medium tracking-tiny text-text-passive">
        People with access
      </span>
      {rows.map((row) => {
        switch (row.kind) {
          case 'author':
            return (
              <ShareMemberRow
                key={row.key}
                name={row.name}
                email={row.email}
                avatarUrl={row.avatarUrl}
                role="author"
                canManage={false}
              />
            );
          case 'member':
            return (
              <ShareMemberRow
                key={row.key}
                name={row.name}
                email={row.email}
                avatarUrl={row.avatarUrl}
                role={row.member.role}
                pending={row.member.pending}
                canManage={canManage}
                onRoleChange={(role) => onRoleChange(row.member.id, role)}
                onRemove={() => onRemove(row.member.id)}
              />
            );
          case 'via_work_item':
            return (
              <ShareMemberRow
                key={row.key}
                name={row.name}
                email={row.email}
                avatarUrl={row.avatarUrl}
                role={row.role}
                pending={row.pending}
                tag={<span className={TAG_CLASS}>{row.tag}</span>}
                canManage={false}
              />
            );
          case 'artifacts_only':
            return (
              <ShareMemberRow
                key={row.key}
                name={row.name}
                email={row.email}
                avatarUrl={row.avatarUrl}
                role={null}
                pending={row.pending}
                tag={
                  <button
                    type="button"
                    title="Manage their access to it"
                    onClick={() => onOpenArtifact(row.firstArtifactId)}
                    className={`${TAG_CLASS} cursor-pointer hover:text-text`}
                  >
                    {row.tag}
                  </button>
                }
                canManage={false}
              />
            );
        }
      })}
    </div>
  );
}
