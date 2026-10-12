export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const notFound = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
export const forbidden = (msg = 'You are not allowed to do that.') => new AppError(403, 'FORBIDDEN', msg);
export const badRequest = (code: string, msg: string) => new AppError(400, code, msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
