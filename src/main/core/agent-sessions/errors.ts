export class TransportError extends Error {
  readonly code: 'TRANSPORT_FAILED' | 'BINARY_NOT_FOUND' = 'TRANSPORT_FAILED';

  constructor(
    message: string,
    public readonly providerId: string
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export class BinaryNotFoundError extends TransportError {
  override readonly code = 'BINARY_NOT_FOUND' as const;
  readonly installCmd: string;

  constructor(binary: string, installCmd: string, providerId: string) {
    super(`Binary "${binary}" not found. Install with: ${installCmd}`, providerId);
    this.name = 'BinaryNotFoundError';
    this.installCmd = installCmd;
  }
}

export class ProvisioningError extends Error {
  readonly code = 'PROVISION_FAILED' as const;

  constructor(
    message: string,
    public readonly phase: 'bootstrap' | 'session'
  ) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

export class RespawnLimitError extends Error {
  readonly code = 'RESPAWN_LIMIT' as const;

  constructor(public readonly attempts: number) {
    super(`Agent session exceeded maximum respawn attempts (${attempts})`);
    this.name = 'RespawnLimitError';
  }
}
