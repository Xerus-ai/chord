import React from 'react';

interface SettingRowProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
}

/**
 * One setting inside a section band: label and description on the left,
 * control on the right. Rows carry their own vertical padding and the band
 * draws a hairline between siblings (`SettingsPage`), so a card is a plain
 * column of rows with no gap of its own.
 */
export function SettingRow({ title, description, control }: SettingRowProps) {
  return (
    <div
      data-setting-row=""
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 py-3.5 [&+[data-setting-row]]:border-t [&+[data-setting-row]]:border-border-subtle"
    >
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
        <div className="break-words text-body tracking-body text-text">{title}</div>
        {description && (
          <div className="break-words text-tiny tracking-tiny text-text-passive">{description}</div>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">{control}</div>
    </div>
  );
}
