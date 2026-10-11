export type Service = 'tmdb' | 'omdb';

export class MissingKeyError extends Error {
  constructor(readonly service: Service) {
    super(`No ${service.toUpperCase()} API key is set. Add it in StreamRating settings.`);
    this.name = 'MissingKeyError';
  }
}

export class ApiError extends Error {
  constructor(
    readonly service: Service,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class QuotaExceededError extends Error {
  constructor(readonly service: Service) {
    super(`The ${service.toUpperCase()} daily request limit is used up.`);
    this.name = 'QuotaExceededError';
  }
}
