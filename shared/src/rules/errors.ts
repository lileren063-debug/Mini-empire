/** Thrown when a player action violates a game rule. Safe to show to the player. */
export class GameRuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GameRuleError';
  }
}

export function fail(code: string, message: string): never {
  throw new GameRuleError(code, message);
}
