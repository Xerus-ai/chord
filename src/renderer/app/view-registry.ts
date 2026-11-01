import type { ComponentType, ReactNode } from 'react';
import { homeView } from '@renderer/app/home-view';
import { artifactLinkView } from '@renderer/features/artifact-link/artifact-link-view';
import { dashboardView } from '@renderer/features/dashboard/dashboard-view';
import { publicLinkView } from '@renderer/features/public-link/public-link-view';
import { settingsView } from '@renderer/features/settings/settings-view';
import { workListView } from '@renderer/features/work-list/work-list-view';

export const views = {
  home: homeView,
  dashboard: dashboardView,
  'work-list': workListView,
  settings: settingsView,
  'artifact-link': artifactLinkView,
  'public-link': publicLinkView,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, ViewDefinition<any>>;

export type ViewDefinition<TParams extends object = Record<never, never>> = {
  WrapView?: ComponentType<{ children: ReactNode } & TParams>;
  TitlebarSlot?: ComponentType;
  MainPanel: ComponentType;
  RightPanel?: ComponentType;
};

type Views = typeof views;

export type ViewId = keyof Views;

export type WrapParams<TId extends ViewId> = Views[TId] extends {
  WrapView: ComponentType<infer P>;
}
  ? Omit<P, 'children'>
  : Record<never, never>;
