export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  /** Throws on failure. Returns the provider's message id. */
  send(to: string, text: string): Promise<{ id: string }>;
}
