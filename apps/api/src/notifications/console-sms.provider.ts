import { Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

/** Development ke liye: SMS bhejne ki jagah log mein dikhata hai. */
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');
  private counter = 0;

  async send(to: string, text: string) {
    this.logger.log(`${to}: ${text}`);
    this.counter += 1;
    return { id: `console-${this.counter}` };
  }
}
