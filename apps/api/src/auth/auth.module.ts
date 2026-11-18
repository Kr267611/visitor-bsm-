import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { DevicesController } from '../devices/devices.controller';
import { AuthController, PasswordController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtGuard, SessionResolver } from './jwt.guard';
import { OtpService } from './otp.service';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController, PasswordController, DevicesController],
  providers: [
    AuthService,
    OtpService,
    SessionResolver,
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [OtpService, AuthService, SessionResolver, JwtModule],
})
export class AuthModule {}
