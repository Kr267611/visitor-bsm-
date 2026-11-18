import { Global, Module } from '@nestjs/common';
import { ConsoleSmsProvider } from './console-sms.provider';
import { FakeSmsProvider } from './fake-sms.provider';
import { Msg91SmsProvider } from './msg91-sms.provider';
import { OutboxWorker } from './outbox.worker';
import { ExpoPushProvider, FakePushProvider, PUSH_PROVIDER } from './push.provider';
import { SMS_PROVIDER } from './sms.provider';

function createSmsProvider() {
  switch (process.env.SMS_PROVIDER) {
    case 'fake':
      return new FakeSmsProvider();
    case 'msg91': {
      const { MSG91_AUTH_KEY, SMS_SENDER } = process.env;
      if (!MSG91_AUTH_KEY || !SMS_SENDER) throw new Error('Set MSG91_AUTH_KEY and SMS_SENDER.');
      return new Msg91SmsProvider(MSG91_AUTH_KEY, SMS_SENDER);
    }
    default:
      return new ConsoleSmsProvider();
  }
}

const createPushProvider = () =>
  process.env.PUSH_PROVIDER === 'fake' ? new FakePushProvider() : new ExpoPushProvider();

@Global()
@Module({
  providers: [
    { provide: SMS_PROVIDER, useFactory: createSmsProvider },
    { provide: PUSH_PROVIDER, useFactory: createPushProvider },
    OutboxWorker,
  ],
  exports: [SMS_PROVIDER, PUSH_PROVIDER, OutboxWorker],
})
export class NotificationsModule {}
