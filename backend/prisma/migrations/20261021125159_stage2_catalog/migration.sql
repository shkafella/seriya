-- CreateEnum
CREATE TYPE "CatalogActivationState" AS ENUM ('IDLE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "CatalogPublicationStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CatalogAssetStatus" AS ENUM ('DEVELOPMENT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ActivationAttemptStatus" AS ENUM ('PREPARED', 'APPLICATION_SWITCHED', 'PUBLICATION_SWITCHED', 'VERIFIED', 'ROLLED_BACK', 'FAILED');

-- CreateTable
CREATE TABLE "owner_identities" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton_key" TEXT NOT NULL DEFAULT 'owner',
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_state" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton_key" TEXT NOT NULL DEFAULT 'catalog',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "active_publication_id" UUID,
    "activation_state" "CatalogActivationState" NOT NULL DEFAULT 'IDLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_source_records" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "source_record_id" TEXT NOT NULL,
    "source_checksum" TEXT NOT NULL,
    "source_data" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_families" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "imported_public_name" TEXT NOT NULL,
    "public_name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "row" TEXT NOT NULL,
    "purposes" JSONB NOT NULL DEFAULT '[]',
    "functions" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source_managed" BOOLEAN NOT NULL DEFAULT true,
    "owner_edited_fields" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "asset_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_variants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "source_record_id" UUID,
    "family_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "imported_data" JSONB NOT NULL,
    "public_name" TEXT NOT NULL,
    "height_mm" INTEGER NOT NULL,
    "width_mm" INTEGER NOT NULL,
    "depth_mm" INTEGER NOT NULL,
    "layout_span_mm" INTEGER,
    "body_m2" DECIMAL(12,4) NOT NULL,
    "facade_m2" DECIMAL(12,4) NOT NULL,
    "hdf_m2" DECIMAL(12,4) NOT NULL,
    "fastener_charge_rub" DECIMAL(12,2) NOT NULL,
    "cut_policy" TEXT NOT NULL,
    "variant_data" JSONB NOT NULL,
    "fasteners_data" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_complete" BOOLEAN NOT NULL DEFAULT true,
    "source_managed" BOOLEAN NOT NULL DEFAULT true,
    "owner_edited_fields" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "asset_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_assets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "public_path" TEXT NOT NULL,
    "source_checksum" TEXT,
    "derived_checksum" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "geometry" JSONB NOT NULL,
    "masks" JSONB NOT NULL,
    "status" "CatalogAssetStatus" NOT NULL DEFAULT 'DEVELOPMENT',
    "rights_approved" BOOLEAN NOT NULL DEFAULT false,
    "production_approved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "version" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "rates" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_import_history" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "source_checksum" TEXT NOT NULL,
    "source_map_checksum" TEXT NOT NULL,
    "base_revision" INTEGER NOT NULL,
    "resulting_revision" INTEGER NOT NULL,
    "reconciliation" JSONB NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_import_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_edit_history" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "variant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_edit_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_publications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "catalog_revision" INTEGER NOT NULL,
    "price_version_id" UUID NOT NULL,
    "release_id" TEXT,
    "snapshot" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "CatalogPublicationStatus" NOT NULL DEFAULT 'CANDIDATE',
    "backup_receipt" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),

    CONSTRAINT "catalog_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_activation_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "previous_publication_id" UUID,
    "next_publication_id" UUID NOT NULL,
    "previous_release_path" TEXT,
    "next_release_path" TEXT NOT NULL,
    "status" "ActivationAttemptStatus" NOT NULL DEFAULT 'PREPARED',
    "recovery_decision" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_activation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owner_identities_singleton_key_key" ON "owner_identities"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "owner_identities_user_id_key" ON "owner_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_state_singleton_key_key" ON "catalog_state"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_state_active_publication_id_key" ON "catalog_state"("active_publication_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_source_records_source_record_id_key" ON "catalog_source_records"("source_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_families_key_key" ON "catalog_families"("key");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_families_slug_key" ON "catalog_families"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_variants_source_record_id_key" ON "catalog_variants"("source_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_variants_sku_key" ON "catalog_variants"("sku");

-- CreateIndex
CREATE INDEX "catalog_variants_family_id_idx" ON "catalog_variants"("family_id");

-- CreateIndex
CREATE INDEX "catalog_variants_is_active_is_complete_idx" ON "catalog_variants"("is_active", "is_complete");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_assets_key_key" ON "catalog_assets"("key");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_assets_public_path_key" ON "catalog_assets"("public_path");

-- CreateIndex
CREATE UNIQUE INDEX "price_versions_version_key" ON "price_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "price_versions_checksum_key" ON "price_versions"("checksum");

-- CreateIndex
CREATE INDEX "catalog_edit_history_variant_id_idx" ON "catalog_edit_history"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_publications_checksum_key" ON "catalog_publications"("checksum");

-- CreateIndex
CREATE INDEX "catalog_publications_status_idx" ON "catalog_publications"("status");

-- CreateIndex
CREATE INDEX "catalog_activation_attempts_status_idx" ON "catalog_activation_attempts"("status");

-- AddForeignKey
ALTER TABLE "owner_identities" ADD CONSTRAINT "owner_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_state" ADD CONSTRAINT "catalog_state_active_publication_id_fkey" FOREIGN KEY ("active_publication_id") REFERENCES "catalog_publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_families" ADD CONSTRAINT "catalog_families_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "catalog_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "catalog_source_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "catalog_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "catalog_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_edit_history" ADD CONSTRAINT "catalog_edit_history_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "catalog_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_publications" ADD CONSTRAINT "catalog_publications_price_version_id_fkey" FOREIGN KEY ("price_version_id") REFERENCES "price_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_activation_attempts" ADD CONSTRAINT "catalog_activation_attempts_previous_publication_id_fkey" FOREIGN KEY ("previous_publication_id") REFERENCES "catalog_publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_activation_attempts" ADD CONSTRAINT "catalog_activation_attempts_next_publication_id_fkey" FOREIGN KEY ("next_publication_id") REFERENCES "catalog_publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
