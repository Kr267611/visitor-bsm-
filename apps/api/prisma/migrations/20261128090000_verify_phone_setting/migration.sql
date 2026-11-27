-- QR check-in without OTP unless a premises turns it on.
ALTER TABLE "premises_settings" ADD COLUMN "verify_phone" BOOLEAN NOT NULL DEFAULT false;
