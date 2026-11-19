-- AlterTable
ALTER TABLE "premises" ALTER COLUMN "purposes" SET DEFAULT ARRAY['Meeting', 'Delivery / Dispatch', 'Raw material supply', 'Job work', 'Machine service / repair', 'Sample / Order', 'Payment / Accounts', 'Interview', 'Other']::TEXT[];

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "purpose_note" TEXT;

-- Premises still on the old generic list get the textile-friendly one. Lists an admin has edited are kept.
UPDATE "premises"
SET "purposes" = ARRAY['Meeting', 'Delivery / Dispatch', 'Raw material supply', 'Job work', 'Machine service / repair', 'Sample / Order', 'Payment / Accounts', 'Interview', 'Other']
WHERE "purposes" = ARRAY['Enquiry', 'Casual Meet', 'Appointment', 'Meeting', 'Visitor'];
