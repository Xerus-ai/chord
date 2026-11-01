import {
  Book,
  Bot,
  Box,
  Cloud,
  Code,
  Cpu,
  Database,
  FlaskConical,
  Folder,
  Globe,
  Layers,
  Package,
  Palette,
  Rocket,
  Server,
  Shield,
  Smartphone,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { REPO_ICON_KEYS, type RepoIconKey } from '@shared/repo-icons';

/**
 * The renderer's half of the repo icon contract: a stored key to the component
 * that draws it. Kept out of `@shared` on purpose — `repo-icons.ts` is imported
 * by the main process, which must not pull lucide-react in.
 *
 * `Record<RepoIconKey, …>` is the enforcement: adding a key to
 * `REPO_ICON_KEYS` without a component here is a type error, not a blank tile.
 */
export const REPO_ICON_COMPONENTS: Record<RepoIconKey, LucideIcon> = {
  folder: Folder,
  code: Code,
  terminal: Terminal,
  bot: Bot,
  package: Package,
  database: Database,
  globe: Globe,
  server: Server,
  cpu: Cpu,
  layers: Layers,
  box: Box,
  rocket: Rocket,
  flask: FlaskConical,
  book: Book,
  wrench: Wrench,
  smartphone: Smartphone,
  cloud: Cloud,
  shield: Shield,
  palette: Palette,
  zap: Zap,
};

/** The picker's order — the shared list's order, so the grid never reshuffles. */
export const REPO_ICON_CHOICES: readonly { key: RepoIconKey; Icon: LucideIcon }[] =
  REPO_ICON_KEYS.map((key) => ({ key, Icon: REPO_ICON_COMPONENTS[key] }));
