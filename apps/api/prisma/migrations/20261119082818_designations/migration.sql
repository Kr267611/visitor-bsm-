-- CreateTable
CREATE TABLE "designations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "designations_business_id_idx" ON "designations"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "designations_department_id_name_key" ON "designations"("department_id", "name");

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
