import { useForm } from '@tanstack/react-form';
import { AlertTriangle, ArrowLeftIcon, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import * as z from 'zod';
import type { ConnectionTestResult, SshConfig } from '@shared/ssh';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { sshConnectionStore } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from '@renderer/lib/ui/field';
import { ModalLayout } from '@renderer/lib/ui/modal-layout';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { SshConnField } from './ssh-conn-fields';
import { SshConnTestResult, type SshTestState } from './ssh-conn-test-result';

export interface AddSshConnModalProps extends BaseModalProps<{ connectionId: string }> {
  initialConfig?: SshConfig;
}

const formSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    host: z
      .string()
      .min(1, 'Host is required')
      .regex(/^[a-zA-Z0-9._\-[\]:]+$/, 'Invalid hostname or IP address'),
    port: z
      .number()
      .int()
      .min(1, 'Port must be at least 1')
      .max(65535, 'Port must be at most 65535'),
    username: z.string().min(1, 'Username is required'),
    authType: z.enum(['password', 'key', 'agent']),
    password: z.string(),
    privateKeyPath: z.string(),
    passphrase: z.string(),
    isEditing: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.authType === 'password' && !val.password && !val.isEditing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password is required',
        path: ['password'],
      });
    }
    if (val.authType === 'key' && !val.privateKeyPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Private key path is required',
        path: ['privateKeyPath'],
      });
    }
  });

type AuthType = 'password' | 'key' | 'agent';

export function AddSshConnModal({ onSuccess, onClose, initialConfig }: AddSshConnModalProps) {
  const sshConnections = sshConnectionStore;
  const isEditing = !!initialConfig;

  const [testState, setTestState] = useState<SshTestState>('idle');
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: initialConfig?.name ?? '',
      host: initialConfig?.host ?? '',
      port: initialConfig?.port ?? 22,
      username: initialConfig?.username ?? '',
      authType: (initialConfig?.authType ?? 'password') as AuthType,
      password: '',
      privateKeyPath: initialConfig?.privateKeyPath ?? '',
      passphrase: '',
      isEditing,
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      setSaveError(null);
      try {
        const config: Partial<Pick<SshConfig, 'id'>> &
          Omit<SshConfig, 'id'> & { password?: string; passphrase?: string } = {
          id: initialConfig?.id,
          name: value.name,
          host: value.host,
          port: value.port,
          username: value.username,
          authType: value.authType,
          privateKeyPath: value.authType === 'key' ? value.privateKeyPath : undefined,
          useAgent: value.authType === 'agent',
          password: value.authType === 'password' ? value.password : undefined,
          passphrase: value.authType === 'key' ? value.passphrase : undefined,
        };
        const saved = await sshConnections.saveConnection(config);
        onSuccess({ connectionId: saved.id });
      } catch (error) {
        // Without this the rejection is swallowed by handleSubmit and the modal
        // just stops saying "Saving…" as though nothing happened.
        setSaveError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  const buildTestConfig = (): SshConfig & { password?: string; passphrase?: string } => {
    const v = form.state.values;
    return {
      id: '',
      name: v.name,
      host: v.host,
      port: v.port,
      username: v.username,
      authType: v.authType,
      privateKeyPath: v.authType === 'key' ? v.privateKeyPath : undefined,
      useAgent: v.authType === 'agent',
      password: v.authType === 'password' ? v.password : undefined,
      passphrase: v.authType === 'key' ? v.passphrase : undefined,
    };
  };

  const handleTestConnection = async () => {
    setTestState('testing');
    setTestResult(null);
    try {
      const result = await sshConnections.testConnection(buildTestConfig());
      setTestResult(result);
      setTestState(result.success ? 'success' : 'error');
    } catch (err) {
      setTestState('error');
      setTestResult({ success: false, error: String(err) });
    }
  };

  return (
    <ModalLayout
      header={
        <DialogHeader
          showCloseButton={false}
          className="flex-row items-center gap-2 -mt-2 w-full justify-between"
        >
          <div className="flex items-center gap-2 -ml-2">
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <ArrowLeftIcon className="w-4 h-4" />
            </Button>
            <DialogTitle>{isEditing ? 'Edit SSH Connection' : 'Add SSH Connection'}</DialogTitle>
          </div>
        </DialogHeader>
      }
      footer={
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={handleTestConnection}
            disabled={testState === 'testing'}
          >
            {testState === 'testing' ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Testing…
              </>
            ) : (
              'Test Connection'
            )}
          </Button>
          <div className="flex gap-2">
            <ConfirmButton type="submit" form="add-ssh-conn-form" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </ConfirmButton>
          </div>
        </DialogFooter>
      }
    >
      <DialogContentArea>
        <form
          id="add-ssh-conn-form"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            {/* Connection name */}
            <form.Field name="name">
              {(field) => (
                <SshConnField field={field} label="Connection Name" placeholder="My Server" />
              )}
            </form.Field>

            {/* Host + Port */}
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <form.Field name="host">
                {(field) => <SshConnField field={field} label="Host" placeholder="example.com" />}
              </form.Field>
              <form.Field name="port">
                {(field) => <SshConnField field={field} label="Port" type="number" />}
              </form.Field>
            </div>

            {/* Username */}
            <form.Field name="username">
              {(field) => (
                <SshConnField
                  field={field}
                  label="Username"
                  placeholder="ubuntu"
                  autoComplete="off"
                />
              )}
            </form.Field>

            {/* Auth type */}
            <form.Field name="authType">
              {(field) => (
                <FieldSet>
                  <FieldLegend variant="label">Authentication</FieldLegend>
                  <RadioGroup
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as AuthType)}
                    className="grid-cols-3"
                  >
                    {(['password', 'key', 'agent'] as const).map((type) => (
                      <label
                        key={type}
                        className="flex cursor-pointer items-center gap-2 text-body tracking-body font-normal"
                      >
                        <RadioGroupItem value={type} />
                        {type === 'password' ? 'Password' : type === 'key' ? 'SSH Key' : 'Agent'}
                      </label>
                    ))}
                  </RadioGroup>
                </FieldSet>
              )}
            </form.Field>

            {/* Auth credential fields — reactive to authType */}
            <form.Subscribe selector={(state) => state.values.authType}>
              {(authType) => {
                if (authType === 'password') {
                  return (
                    <form.Field name="password">
                      {(field) => (
                        <SshConnField
                          field={field}
                          label="Password"
                          type="password"
                          autoComplete="current-password"
                          placeholder={isEditing ? 'Leave blank to keep existing' : undefined}
                        />
                      )}
                    </form.Field>
                  );
                }

                if (authType === 'key') {
                  return (
                    <>
                      <form.Field name="privateKeyPath">
                        {(field) => (
                          <SshConnField
                            field={field}
                            label="Private Key Path"
                            placeholder="~/.ssh/id_rsa"
                          />
                        )}
                      </form.Field>
                      <form.Field name="passphrase">
                        {(field) => (
                          <SshConnField
                            field={field}
                            label="Passphrase"
                            type="password"
                            autoComplete="off"
                            placeholder={isEditing ? 'Leave blank to keep existing' : 'Optional'}
                            description={
                              isEditing ? undefined : 'Leave empty if your key has no passphrase.'
                            }
                          />
                        )}
                      </form.Field>
                    </>
                  );
                }

                return (
                  <FieldDescription>
                    The SSH agent running on this machine will be used for authentication. Make sure
                    your key is loaded into the agent.
                  </FieldDescription>
                );
              }}
            </form.Subscribe>
          </FieldGroup>
        </form>
        {/* Test connection result */}
        {testState !== 'idle' && <SshConnTestResult state={testState} result={testResult} />}

        {saveError && (
          <div className="flex items-start gap-2 rounded-md border border-status-err-border bg-status-err-bg px-3 py-2 text-body tracking-body text-status-err">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>Couldn&apos;t save this connection: {saveError}</span>
          </div>
        )}
      </DialogContentArea>
    </ModalLayout>
  );
}
