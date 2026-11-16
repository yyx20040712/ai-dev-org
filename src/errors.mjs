export class TroupeError extends Error {
  constructor(message, code = 'TROUPE_ERROR') {
    super(message);
    this.name = 'TroupeError';
    this.code = code;
  }
}

export function fail(message, code = 'TROUPE_ERROR') {
  throw new TroupeError(message, code);
}
