// Typed errors shared by the CLI, runner and plugin host.
// Each one carries a fix hint so it can be shown to the operator as a blocker.

export class ForgeError extends Error {
  constructor(message, { hint, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = this.constructor.code;
    this.hint = hint;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint, details: this.details };
  }
}

export class ConfigMissing extends ForgeError {
  static code = 'CONFIG_MISSING';
}

export class ConfigInvalid extends ForgeError {
  static code = 'CONFIG_INVALID';
}

export class AuthFailed extends ForgeError {
  static code = 'AUTH_FAILED';
}

export class RateLimited extends ForgeError {
  static code = 'RATE_LIMITED';
}

export class Unavailable extends ForgeError {
  static code = 'UNAVAILABLE';
}

export class PermissionDenied extends ForgeError {
  static code = 'PERMISSION_DENIED';
}

export class SchemaInvalid extends ForgeError {
  static code = 'SCHEMA_INVALID';
}

export class NotImplemented extends ForgeError {
  static code = 'NOT_IMPLEMENTED';
}
