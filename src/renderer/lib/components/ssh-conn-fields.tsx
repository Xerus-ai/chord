import type { AnyFieldApi } from '@tanstack/react-form';
import type { ComponentProps, ReactNode } from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';

/**
 * One labelled input bound to a TanStack form field, with the touched-and-invalid
 * wiring the SSH form repeats for every field.
 */
export function SshConnField({
  field,
  label,
  description,
  ...inputProps
}: {
  field: AnyFieldApi;
  label: string;
  description?: ReactNode;
} & Omit<ComponentProps<typeof Input>, 'id' | 'name' | 'value' | 'onBlur' | 'onChange'>) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const isNumeric = inputProps.type === 'number';

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        value={(field.state.value as string | number | undefined) ?? ''}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(isNumeric ? Number(e.target.value) : e.target.value)}
        aria-invalid={isInvalid}
        {...inputProps}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}
