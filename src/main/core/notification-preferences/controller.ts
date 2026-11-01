import { eq } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import {
  isNotificationPreferenceType,
  NOTIFICATION_PREFERENCE_TYPES,
  type NotificationPreference,
} from '@shared/notification-preferences';
import { ok } from '@shared/result';
import { db } from '@main/db/client';
import { notificationPreferences } from '@main/db/schema-sync';

export const notificationPreferencesController = createRPCController({
  getAll: async () => {
    const rows = await db.select().from(notificationPreferences);

    const prefs: NotificationPreference[] = NOTIFICATION_PREFERENCE_TYPES.map((type) => {
      const existing = rows.find((r) => r.notificationType === type);
      return {
        id: existing?.id ?? type,
        notification_type: type,
        in_app: existing ? existing.inApp === 1 : true,
        desktop: existing ? existing.desktop === 1 : true,
        sound: existing ? existing.sound === 1 : false,
      };
    });

    return ok({ preferences: prefs });
  },

  update: async (args: {
    notificationType: string;
    inApp: boolean;
    desktop: boolean;
    sound: boolean;
  }) => {
    if (!isNotificationPreferenceType(args.notificationType)) {
      throw new Error(`Unknown notification type: ${args.notificationType}`);
    }
    const existing = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.notificationType, args.notificationType))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(notificationPreferences)
        .set({
          inApp: args.inApp ? 1 : 0,
          desktop: args.desktop ? 1 : 0,
          sound: args.sound ? 1 : 0,
        })
        .where(eq(notificationPreferences.notificationType, args.notificationType));
    } else {
      await db.insert(notificationPreferences).values({
        id: args.notificationType,
        notificationType: args.notificationType,
        inApp: args.inApp ? 1 : 0,
        desktop: args.desktop ? 1 : 0,
        sound: args.sound ? 1 : 0,
      });
    }

    return ok();
  },
});
