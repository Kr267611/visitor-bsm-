import { Global, Module } from '@nestjs/common';
import { ConsoleSmsProvider } from './console-sms.provider';
import { FakeSmsProvider } from './fake-sms.provider';
import { SMS_PROVIDER } from './sms.provider';

function createSmsProvider() {
  switch (process.env.SMS_PROVIDER) {
    case 'fake':
      return new FakeSmsProvider();
    default:
      return new ConsoleSmsProvider();
  }
}

@Global()
@Module({
  providers: [{ provide: SMS_PROVIDER, useFactory: createSmsProvider }],
  exports: [SMS_PROVIDER],
})
export class NotificationsModule {}
