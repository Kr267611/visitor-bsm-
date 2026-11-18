import { Global, Module } from '@nestjs/common';
import { PassService } from './pass.service';

@Global()
@Module({
  providers: [
    {
      provide: PassService,
      useFactory: () => {
        const { QR_PRIVATE_KEY, QR_PUBLIC_KEY } = process.env;
        if (!QR_PRIVATE_KEY || !QR_PUBLIC_KEY) {
          throw new Error('Set QR_PRIVATE_KEY and QR_PUBLIC_KEY (generate them with scripts/gen-qr-keys.ts).');
        }
        return new PassService(QR_PRIVATE_KEY, QR_PUBLIC_KEY);
      },
    },
  ],
  exports: [PassService],
})
export class PassesModule {}
