import type z from 'zod';
import {
  appSettingsSchema,
  type notificationSettingsSchema,
  type providerCustomConfigEntrySchema,
  type themeSchema,
} from '@main/core/settings/schema';

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type Theme = z.infer<typeof themeSchema>;

export type ProviderCustomConfig = z.infer<typeof providerCustomConfigEntrySchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AppSettingsKey = keyof AppSettings;

export const AppSettingsKeys = Object.keys(appSettingsSchema.shape) as AppSettingsKey[];
