export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  /** Fail hone par throw karta hai. Lautata hai provider ki message id. */
  send(to: string, text: string): Promise<{ id: string }>;
}
