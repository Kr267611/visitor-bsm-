-- DropForeignKey
ALTER TABLE "visits" DROP CONSTRAINT "visits_host_id_fkey";

-- AlterTable
ALTER TABLE "visits" ALTER COLUMN "host_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
