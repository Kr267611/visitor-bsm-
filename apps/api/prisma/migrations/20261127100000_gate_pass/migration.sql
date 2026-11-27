-- Gate pass: an exit slip numbered at check-out.
ALTER TABLE "visits" ADD COLUMN "gate_pass_no" TEXT;
ALTER TABLE "visits" ADD COLUMN "items_out" TEXT;
CREATE UNIQUE INDEX "visits_gate_pass_no_key" ON "visits"("gate_pass_no");
CREATE SEQUENCE IF NOT EXISTS gate_pass_seq;
