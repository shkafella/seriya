-- AlterTable
ALTER TABLE "catalog_publications" ADD COLUMN     "pricing_snapshot" JSONB;

-- AlterTable
ALTER TABLE "catalog_variants" ADD COLUMN     "configuration_data" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "pricing_state" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton_key" TEXT NOT NULL DEFAULT 'pricing',
    "current_price_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_drafts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton_key" TEXT NOT NULL DEFAULT 'pricing',
    "base_price_version_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "rates" JSONB NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_state_singleton_key_key" ON "pricing_state"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_state_current_price_version_id_key" ON "pricing_state"("current_price_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_drafts_singleton_key_key" ON "price_drafts"("singleton_key");

-- AddForeignKey
ALTER TABLE "pricing_state" ADD CONSTRAINT "pricing_state_current_price_version_id_fkey" FOREIGN KEY ("current_price_version_id") REFERENCES "price_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_drafts" ADD CONSTRAINT "price_drafts_base_price_version_id_fkey" FOREIGN KEY ("base_price_version_id") REFERENCES "price_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
