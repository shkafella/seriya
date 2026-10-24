-- CreateEnum
CREATE TYPE "LeadPolicyDeliveryMode" AS ENUM ('TELEGRAM_ENABLED', 'TELEGRAM_DISABLED');

-- CreateEnum
CREATE TYPE "LeadPolicyTransitionPhase" AS ENUM ('IDLE', 'PREPARED', 'RETENTION_WORK', 'NOTIFICATION_WORK', 'READY', 'ACTIVATION_PENDING', 'ABORT_PENDING', 'TERMINAL');

-- CreateEnum
CREATE TYPE "LeadPolicyTerminalDirection" AS ENUM ('ACTIVATION_PENDING', 'ABORT_PENDING');

-- CreateEnum
CREATE TYPE "LeadPolicyCommandKind" AS ENUM ('START', 'ACTIVATE', 'ABORT');

-- CreateEnum
CREATE TYPE "ProtectionStatus" AS ENUM ('READY', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BackupScope" AS ENUM ('CORE', 'LEAD');

-- CreateEnum
CREATE TYPE "BackupArtifactState" AS ENUM ('PREPARED', 'OBJECTS_VERIFIED', 'ADMISSION_PUBLISHED', 'ADMISSION_ACKNOWLEDGED', 'READY', 'RETIREMENT_PREPARED', 'DENIAL_HEAD_PUBLISHED', 'DENIAL_DB_ACKNOWLEDGED', 'ABANDON_PREPARED', 'ABANDONMENT_RECORD_PUBLISHED', 'ABANDONMENT_DB_ACKNOWLEDGED', 'OBJECTS_PURGED', 'PURGE_RECEIPT_PUBLISHED', 'PURGE_RECEIPT_DB_ACKNOWLEDGED', 'RETIRED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "RecoveryChainKind" AS ENUM ('CORE_BACKUP_HEAD', 'LEAD_BACKUP_HEAD', 'LEAD_ERASURE_COVERAGE', 'LEAD_POLICY_CONFIG_EPOCH', 'ACTIVE_HOST_EPOCH');

-- CreateEnum
CREATE TYPE "RecoveryControlStatus" AS ENUM ('IDLE', 'PREPARED', 'ACKNOWLEDGED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CryptoVersionLifecycle" AS ENUM ('READABLE_INACTIVE', 'ACTIVE_WRITER', 'RETIRING', 'RETIRED');

-- CreateEnum
CREATE TYPE "RecoveryProviderScope" AS ENUM ('GLOBAL', 'CORE', 'LEAD');

-- CreateEnum
CREATE TYPE "RecoveryProviderOperationLifecycle" AS ENUM ('PREPARED', 'ISSUED', 'RESULT_RECORDED', 'COMPLETED', 'FENCE_REQUESTED', 'FENCE_ACKNOWLEDGED', 'SWEEP_ONE_RECORDED', 'SWEEP_TWO_RECORDED', 'DRAINED');

-- CreateEnum
CREATE TYPE "LeadSubmissionKeyState" AS ENUM ('OPEN', 'SUBMITTING', 'ABANDONMENT_PENDING', 'COMMITTED', 'TOMBSTONED', 'ABANDONED_TOMBSTONE');

-- CreateEnum
CREATE TYPE "LeadAdmissionReservationLifecycle" AS ENUM ('OPEN_ACTIVE', 'LEAD_ACTIVE', 'PENDING', 'TERMINAL_RECOVERY_PINNED', 'RELEASED');

-- CreateEnum
CREATE TYPE "LeadTombstoneUnitState" AS ENUM ('ACTIVE_RESERVED', 'ACTIVE_LEAD_RESERVED', 'PENDING_TOMBSTONE', 'LIVE_TOMBSTONE', 'ARTIFACT_PINNED', 'FREE');

-- CreateEnum
CREATE TYPE "LeadAttemptUnitState" AS ENUM ('ACTIVE_RESERVED', 'ACTIVE_LEAD_RESERVED', 'PENDING_ATTEMPT', 'ARTIFACT_PINNED', 'FREE');

-- CreateEnum
CREATE TYPE "LeadCleanupUnitState" AS ENUM ('ACTIVE_RESERVED', 'ACTIVE_LEAD_RESERVED', 'PENDING_UNBATCHED', 'PENDING_ERASURE', 'UNCHECKPOINTED_BATCH', 'UNCHECKPOINTED_ERASURE', 'ARTIFACT_PINNED', 'FREE');

-- CreateEnum
CREATE TYPE "LeadLifecycle" AS ENUM ('ACTIVE', 'ERASURE_PENDING');

-- CreateEnum
CREATE TYPE "LeadWorkflowStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "LeadNotificationStatus" AS ENUM ('PENDING', 'LEASED', 'DISPATCH_STARTED', 'SENT', 'FAILED', 'DELIVERY_UNCERTAIN', 'SUPPRESSED', 'CANCELLED_POLICY');

-- CreateEnum
CREATE TYPE "LeadErasureKind" AS ENUM ('MANUAL', 'EXPIRY');

-- CreateEnum
CREATE TYPE "LeadErasurePhase" AS ENUM ('PREPARED', 'QUIESCING', 'MARKER_PENDING', 'COVERAGE_PENDING', 'FINALIZING');

-- CreateEnum
CREATE TYPE "LeadErasureMarkerState" AS ENUM ('PREPARED', 'UPLOADED', 'BYTE_VERIFIED', 'HEAD_PUBLISHED', 'PURGE_PENDING', 'PURGED');

-- CreateEnum
CREATE TYPE "SubmissionKeyAbandonmentState" AS ENUM ('PREPARED', 'BATCHED', 'MARKER_PENDING', 'COVERAGE_PENDING', 'TERMINAL', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "SubmissionKeyAbandonmentBatchState" AS ENUM ('PREPARED', 'UPLOADED', 'BYTE_VERIFIED', 'HEAD_PUBLISHED', 'CHECKPOINTED', 'TERMINAL', 'PURGE_PENDING', 'PURGED');

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "recovery_smoke_operation_id" UUID;

-- AlterTable
ALTER TABLE "catalog_publications" ADD COLUMN     "public_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "lead_policy_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "version" INTEGER NOT NULL,
    "privacy_notice_text" TEXT NOT NULL,
    "privacy_notice_checksum" TEXT NOT NULL,
    "consent_text" TEXT NOT NULL,
    "consent_checksum" TEXT NOT NULL,
    "policy_bundle_checksum" TEXT NOT NULL,
    "operator_identity" JSONB NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "recovery_window_days" INTEGER NOT NULL,
    "delivery_mode" "LeadPolicyDeliveryMode" NOT NULL,
    "delivery_config_version" INTEGER,
    "delivery_destination_digest" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),

    CONSTRAINT "lead_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_policy_candidate_withdrawals" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "policy_version_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "request_digest" TEXT NOT NULL,
    "expected_policy_revision" INTEGER NOT NULL,
    "expected_transition_revision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID,
    "stored_result" JSONB NOT NULL,
    "epoch_sequence" BIGINT NOT NULL,
    "epoch_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_policy_candidate_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_policy_state" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton_key" TEXT NOT NULL DEFAULT 'lead-policy',
    "active_policy_version_id" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_policy_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_policy_transition_state" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton_key" TEXT NOT NULL DEFAULT 'lead-policy-transition',
    "current_operation_id" UUID,
    "terminal_command_id" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "phase" "LeadPolicyTransitionPhase" NOT NULL DEFAULT 'IDLE',
    "effective_recovery_cap_at" TIMESTAMP(3),
    "telegram_decision" TEXT,
    "capture_block" BOOLEAN NOT NULL DEFAULT false,
    "irreversible" BOOLEAN NOT NULL DEFAULT false,
    "forward_only" BOOLEAN NOT NULL DEFAULT false,
    "terminal_direction" "LeadPolicyTerminalDirection",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_policy_transition_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_policy_transition_operations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "operation_id" UUID NOT NULL,
    "candidate_policy_version_id" UUID NOT NULL,
    "candidate_bundle_checksum" TEXT NOT NULL,
    "starting_policy_revision" INTEGER NOT NULL,
    "starting_transition_revision" INTEGER NOT NULL,
    "starting_protection_revision" INTEGER NOT NULL,
    "phase" "LeadPolicyTransitionPhase" NOT NULL DEFAULT 'PREPARED',
    "telegram_decision" TEXT NOT NULL,
    "retention_decision" TEXT NOT NULL,
    "terminal_outcome" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "lead_policy_transition_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_policy_transition_commands" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "command_operation_id" UUID NOT NULL,
    "transition_operation_id" UUID NOT NULL,
    "kind" "LeadPolicyCommandKind" NOT NULL,
    "request_digest" TEXT NOT NULL,
    "expected_policy_revision" INTEGER NOT NULL,
    "expected_transition_revision" INTEGER NOT NULL,
    "expected_protection_revision" INTEGER NOT NULL,
    "expected_phase" "LeadPolicyTransitionPhase" NOT NULL,
    "pre_ack_fence_revision" INTEGER,
    "pre_ack_direction" "LeadPolicyTerminalDirection",
    "epoch_sequence" BIGINT,
    "epoch_hash" TEXT,
    "checkpoint_sequence" BIGINT,
    "stored_phase" TEXT NOT NULL,
    "stored_result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "lead_policy_transition_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_snapshot_generations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "exported_snapshot_id" TEXT NOT NULL,
    "release_id" TEXT NOT NULL,
    "dependency_set_checksum" TEXT NOT NULL,
    "manifest_schema_version" INTEGER NOT NULL,
    "recovery_bundle_checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "backup_snapshot_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_artifacts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "snapshot_generation_id" UUID NOT NULL,
    "scope" "BackupScope" NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "version_inventory" JSONB NOT NULL,
    "version_inventory_checksum" TEXT NOT NULL,
    "recovery_cap_at" TIMESTAMP(3),
    "encrypted_object_inventory" JSONB NOT NULL,
    "capacity_inventory" JSONB,
    "capacity_inventory_checksum" TEXT,
    "lifecycle_receipt" JSONB,
    "intended_protection_revision" INTEGER,
    "attestation_checksum" TEXT,
    "scope_head_sequence" BIGINT,
    "scope_head_hash" TEXT,
    "state" "BackupArtifactState" NOT NULL DEFAULT 'PREPARED',
    "lifecycle_revision" INTEGER NOT NULL DEFAULT 0,
    "lifecycle_record_checksum" TEXT,
    "purge_receipt_checksum" TEXT,
    "required_core_artifact_id" UUID,
    "reconciliation_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "purged_at" TIMESTAMP(3),

    CONSTRAINT "backup_artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "backup_artifact_revision_nonnegative" CHECK ("lifecycle_revision" >= 0),
    CONSTRAINT "backup_artifact_head_phase_proven" CHECK (
        "state" NOT IN (
            'ADMISSION_PUBLISHED', 'ADMISSION_ACKNOWLEDGED', 'READY',
            'RETIREMENT_PREPARED', 'DENIAL_HEAD_PUBLISHED', 'DENIAL_DB_ACKNOWLEDGED',
            'ABANDONMENT_RECORD_PUBLISHED', 'ABANDONMENT_DB_ACKNOWLEDGED',
            'OBJECTS_PURGED', 'PURGE_RECEIPT_PUBLISHED', 'PURGE_RECEIPT_DB_ACKNOWLEDGED',
            'RETIRED', 'ABANDONED'
        ) OR (
            "lifecycle_record_checksum" IS NOT NULL AND
            "scope_head_sequence" IS NOT NULL AND "scope_head_hash" IS NOT NULL
        )
    ),
    CONSTRAINT "backup_artifact_ready_proven" CHECK (
        "state" NOT IN (
            'READY', 'RETIREMENT_PREPARED', 'DENIAL_HEAD_PUBLISHED', 'DENIAL_DB_ACKNOWLEDGED',
            'ABANDONMENT_RECORD_PUBLISHED', 'ABANDONMENT_DB_ACKNOWLEDGED',
            'OBJECTS_PURGED', 'PURGE_RECEIPT_PUBLISHED', 'PURGE_RECEIPT_DB_ACKNOWLEDGED',
            'RETIRED', 'ABANDONED'
        ) OR (
            "lifecycle_receipt" IS NOT NULL AND
            "intended_protection_revision" IS NOT NULL AND
            "attestation_checksum" IS NOT NULL AND
            "recovery_cap_at" IS NOT NULL
        )
    ),
    CONSTRAINT "backup_artifact_purge_receipt_proven" CHECK (
        "state" NOT IN ('PURGE_RECEIPT_PUBLISHED', 'PURGE_RECEIPT_DB_ACKNOWLEDGED', 'RETIRED', 'ABANDONED')
        OR "purge_receipt_checksum" IS NOT NULL
    ),
    CONSTRAINT "backup_artifact_terminal_purge_proven" CHECK (
        "state" NOT IN ('RETIRED', 'ABANDONED') OR "purged_at" IS NOT NULL
    )
);

-- CreateTable
CREATE TABLE "lead_protection_state" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton_key" TEXT NOT NULL DEFAULT 'lead-protection',
    "current_lead_artifact_id" UUID,
    "compatible_core_artifact_id" UUID,
    "lead_backup_head_sequence" BIGINT,
    "lead_backup_head_hash" TEXT,
    "latest_recoverable_expiry_at" TIMESTAMP(3),
    "erasure_coverage_sequence" BIGINT,
    "erasure_coverage_hash" TEXT,
    "configuration_checksum" TEXT,
    "inventory_checksum" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "last_verified_at" TIMESTAMP(3),
    "status" "ProtectionStatus" NOT NULL DEFAULT 'BLOCKED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_protection_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_policy_protection_attestations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "policy_version_id" UUID NOT NULL,
    "policy_bundle_checksum" TEXT NOT NULL,
    "protection_state_id" UUID NOT NULL,
    "protection_revision" INTEGER NOT NULL,
    "backup_inventory_checksum" TEXT NOT NULL,
    "minimum_coverage_sequence" BIGINT NOT NULL,
    "minimum_coverage_hash" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "status" "ProtectionStatus" NOT NULL,
    "reason" TEXT,

    CONSTRAINT "lead_policy_protection_attestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_control_chain_state" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "chain" "RecoveryChainKind" NOT NULL,
    "pending_sequence" BIGINT,
    "pending_hash" TEXT,
    "acknowledged_sequence" BIGINT NOT NULL DEFAULT 0,
    "acknowledged_hash" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" "RecoveryControlStatus" NOT NULL DEFAULT 'IDLE',
    "signing_key_version" INTEGER NOT NULL,
    "operation_id" UUID,
    "target_host" TEXT,
    "credential_versions" JSONB,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_control_chain_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_high_water_checkpoint_state" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton_key" TEXT NOT NULL DEFAULT 'recovery-high-water',
    "sequence" BIGINT NOT NULL DEFAULT 0,
    "checkpoint_hash" TEXT,
    "anchor_key_version" INTEGER NOT NULL,
    "chain_tuples" JSONB NOT NULL,
    "core_lead_projection_hash" TEXT,
    "share_projection_hash" TEXT,
    "frozen_share_tuple" JSONB,
    "anchor_object_version" TEXT,
    "anchor_etag" TEXT,
    "read_back_acknowledged_at" TIMESTAMP(3),
    "status" "RecoveryControlStatus" NOT NULL DEFAULT 'IDLE',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_high_water_checkpoint_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_version_state" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "domain" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "lifecycle" "CryptoVersionLifecycle" NOT NULL,
    "writer_epoch" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "activated_at" TIMESTAMP(3),
    "retirement_started_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "last_verified_inventory_checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crypto_version_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_provider_operation_fences" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "operation_id" UUID NOT NULL,
    "scope" "RecoveryProviderScope" NOT NULL,
    "source_host_epoch" BIGINT NOT NULL,
    "operation_kind" TEXT NOT NULL,
    "provider_config_checksum" TEXT NOT NULL,
    "requested_prefix_checksum" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "request_checksum" TEXT NOT NULL,
    "intended_capability_kind" TEXT NOT NULL,
    "issuance_selector" TEXT NOT NULL,
    "requested_policy" JSONB NOT NULL,
    "actual_capability_identity" TEXT,
    "effective_policy_hash" TEXT,
    "issuance_attestation_checksum" TEXT,
    "revocation_selector" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "max_accepted_request_lifetime_ms" BIGINT NOT NULL,
    "expected_parent_hash" TEXT,
    "expected_sequence" BIGINT,
    "lifecycle" "RecoveryProviderOperationLifecycle" NOT NULL DEFAULT 'PREPARED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "phase_signing_key_version" INTEGER NOT NULL,
    "previous_phase_hash" TEXT,
    "head_phase_hash" TEXT NOT NULL,
    "head_phase_signature" TEXT NOT NULL,
    "off_host_prefix" TEXT NOT NULL,
    "off_host_head_checksum" TEXT NOT NULL,
    "owning_acknowledgement" JSONB,
    "provider_revocation_receipt" TEXT,
    "barrier_at" TIMESTAMP(3),
    "sweep_one_checksum" TEXT,
    "sweep_one_at" TIMESTAMP(3),
    "sweep_two_checksum" TEXT,
    "sweep_two_at" TIMESTAMP(3),
    "terminal_result" JSONB,
    "retain_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_provider_operation_fences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recovery_provider_scope_is_core" CHECK ("scope" IN ('GLOBAL', 'CORE'))
);

-- CreateTable
CREATE TABLE "lead_recovery_provider_operation_fences" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "operation_id" UUID NOT NULL,
    "scope" "RecoveryProviderScope" NOT NULL DEFAULT 'LEAD',
    "source_host_epoch" BIGINT NOT NULL,
    "operation_kind" TEXT NOT NULL,
    "provider_config_checksum" TEXT NOT NULL,
    "requested_prefix_checksum" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "request_checksum" TEXT NOT NULL,
    "intended_capability_kind" TEXT NOT NULL,
    "issuance_selector" TEXT NOT NULL,
    "requested_policy" JSONB NOT NULL,
    "actual_capability_identity" TEXT,
    "effective_policy_hash" TEXT,
    "issuance_attestation_checksum" TEXT,
    "revocation_selector" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "max_accepted_request_lifetime_ms" BIGINT NOT NULL,
    "expected_parent_hash" TEXT,
    "expected_sequence" BIGINT,
    "lifecycle" "RecoveryProviderOperationLifecycle" NOT NULL DEFAULT 'PREPARED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "phase_signing_key_version" INTEGER NOT NULL,
    "previous_phase_hash" TEXT,
    "head_phase_hash" TEXT NOT NULL,
    "head_phase_signature" TEXT NOT NULL,
    "off_host_prefix" TEXT NOT NULL,
    "off_host_head_checksum" TEXT NOT NULL,
    "owning_acknowledgement" JSONB,
    "provider_revocation_receipt" TEXT,
    "barrier_at" TIMESTAMP(3),
    "sweep_one_checksum" TEXT,
    "sweep_one_at" TIMESTAMP(3),
    "sweep_two_checksum" TEXT,
    "sweep_two_at" TIMESTAMP(3),
    "terminal_result" JSONB,
    "retain_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_recovery_provider_operation_fences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lead_recovery_provider_scope_is_lead" CHECK ("scope" = 'LEAD')
);

-- CreateTable
CREATE TABLE "active_host_epoch_transitions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton_key" TEXT NOT NULL DEFAULT 'active-host-transition',
    "operation_id" UUID NOT NULL,
    "source_host_identity" TEXT NOT NULL,
    "target_host_identity" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "expected_host_parent_hash" TEXT NOT NULL,
    "expected_host_sequence" BIGINT NOT NULL,
    "expected_checkpoint_parent_hash" TEXT NOT NULL,
    "expected_checkpoint_sequence" BIGINT NOT NULL,
    "host_signing_key_version" INTEGER NOT NULL,
    "checkpoint_signing_key_version" INTEGER NOT NULL,
    "host_bytes_checksum" TEXT,
    "checkpoint_bytes_checksum" TEXT,
    "host_record_fence_id" UUID,
    "checkpoint_record_fence_id" UUID,
    "host_fence_phase_head_checksum" TEXT,
    "checkpoint_fence_phase_head_checksum" TEXT,
    "finalizer_credential_version" INTEGER,
    "terminal_result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "active_host_epoch_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_admission_budget_state" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton_key" TEXT NOT NULL DEFAULT 'lead-admission-budget',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "window_ends_at" TIMESTAMP(3) NOT NULL,
    "window_intent_count" INTEGER NOT NULL DEFAULT 0,
    "window_intent_limit" INTEGER NOT NULL,
    "tombstone_cap" INTEGER NOT NULL,
    "attempt_cap" INTEGER NOT NULL,
    "checkpoint_cap" INTEGER NOT NULL,
    "reserved_open_tombstone_units" INTEGER NOT NULL DEFAULT 0,
    "reserved_open_attempt_units" INTEGER NOT NULL DEFAULT 0,
    "reserved_open_cleanup_units" INTEGER NOT NULL DEFAULT 0,
    "reserved_lead_erasure_tombstone_units" INTEGER NOT NULL DEFAULT 0,
    "reserved_lead_erasure_attempt_units" INTEGER NOT NULL DEFAULT 0,
    "reserved_lead_erasure_cleanup_units" INTEGER NOT NULL DEFAULT 0,
    "pending_tombstone_reservations" INTEGER NOT NULL DEFAULT 0,
    "pending_attempts" INTEGER NOT NULL DEFAULT 0,
    "pending_unbatched_cleanup_reservations" INTEGER NOT NULL DEFAULT 0,
    "pending_erasure_cleanup_reservations" INTEGER NOT NULL DEFAULT 0,
    "uncheckpointed_batches" INTEGER NOT NULL DEFAULT 0,
    "uncheckpointed_erasure_operations" INTEGER NOT NULL DEFAULT 0,
    "artifact_pinned_tombstone_units" INTEGER NOT NULL DEFAULT 0,
    "artifact_pinned_attempt_units" INTEGER NOT NULL DEFAULT 0,
    "artifact_pinned_cleanup_units" INTEGER NOT NULL DEFAULT 0,
    "live_tombstones" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_admission_budget_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lead_budget_nonnegative" CHECK (
        "revision" >= 0 AND
        "window_intent_count" >= 0 AND "window_intent_limit" >= 0 AND
        "tombstone_cap" >= 0 AND "attempt_cap" >= 0 AND "checkpoint_cap" >= 0 AND
        "reserved_open_tombstone_units" >= 0 AND "reserved_open_attempt_units" >= 0 AND "reserved_open_cleanup_units" >= 0 AND
        "reserved_lead_erasure_tombstone_units" >= 0 AND "reserved_lead_erasure_attempt_units" >= 0 AND "reserved_lead_erasure_cleanup_units" >= 0 AND
        "pending_tombstone_reservations" >= 0 AND "pending_attempts" >= 0 AND
        "pending_unbatched_cleanup_reservations" >= 0 AND "pending_erasure_cleanup_reservations" >= 0 AND
        "uncheckpointed_batches" >= 0 AND "uncheckpointed_erasure_operations" >= 0 AND
        "artifact_pinned_tombstone_units" >= 0 AND "artifact_pinned_attempt_units" >= 0 AND "artifact_pinned_cleanup_units" >= 0 AND
        "live_tombstones" >= 0
    ),
    CONSTRAINT "lead_budget_window_valid" CHECK ("window_ends_at" > "window_started_at" AND "window_intent_count" <= "window_intent_limit"),
    CONSTRAINT "lead_budget_tombstone_conserved" CHECK (
        "live_tombstones" + "pending_tombstone_reservations" + "reserved_open_tombstone_units" +
        "reserved_lead_erasure_tombstone_units" + "artifact_pinned_tombstone_units" <= "tombstone_cap"
    ),
    CONSTRAINT "lead_budget_attempt_conserved" CHECK (
        "pending_attempts" + "reserved_open_attempt_units" + "reserved_lead_erasure_attempt_units" +
        "artifact_pinned_attempt_units" <= "attempt_cap"
    ),
    CONSTRAINT "lead_budget_checkpoint_conserved" CHECK (
        "uncheckpointed_batches" + "uncheckpointed_erasure_operations" +
        "pending_unbatched_cleanup_reservations" + "pending_erasure_cleanup_reservations" +
        "reserved_open_cleanup_units" + "reserved_lead_erasure_cleanup_units" +
        "artifact_pinned_cleanup_units" <= "checkpoint_cap"
    )
);

-- CreateTable
CREATE TABLE "lead_admission_reservations" (
    "id" BIGSERIAL NOT NULL,
    "submission_key_id" UUID,
    "lifecycle" "LeadAdmissionReservationLifecycle" NOT NULL DEFAULT 'OPEN_ACTIVE',
    "tombstone_state" "LeadTombstoneUnitState" NOT NULL DEFAULT 'ACTIVE_RESERVED',
    "attempt_state" "LeadAttemptUnitState" NOT NULL DEFAULT 'ACTIVE_RESERVED',
    "cleanup_state" "LeadCleanupUnitState" NOT NULL DEFAULT 'ACTIVE_RESERVED',
    "cleanup_operation_id" UUID,
    "cleanup_operation_kind" TEXT,
    "replay_obligation_kind" TEXT,
    "terminal_kind" TEXT,
    "terminal_at" TIMESTAMP(3),
    "last_artifact_inventory_checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_admission_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lead_reservation_release_is_clean" CHECK (
        "lifecycle" <> 'RELEASED' OR (
            "tombstone_state" = 'FREE' AND "attempt_state" = 'FREE' AND "cleanup_state" = 'FREE' AND
            "cleanup_operation_id" IS NULL AND "cleanup_operation_kind" IS NULL AND "replay_obligation_kind" IS NULL AND
            "last_artifact_inventory_checksum" IS NOT NULL AND "last_artifact_inventory_checksum" <> ''
        )
    )
);

-- CreateTable
CREATE TABLE "lead_submission_keys" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "idempotency_digest" TEXT NOT NULL,
    "idempotency_key_version" INTEGER NOT NULL,
    "recovery_capability_digest" TEXT NOT NULL,
    "recovery_key_version" INTEGER NOT NULL,
    "reservation_id" BIGINT NOT NULL,
    "lead_id" UUID,
    "state" "LeadSubmissionKeyState" NOT NULL DEFAULT 'OPEN',
    "open_expires_at" TIMESTAMP(3) NOT NULL,
    "submit_claim_token" TEXT,
    "submit_lease_expires_at" TIMESTAMP(3),
    "abandonment_operation_id" UUID,
    "submission_schema_version" INTEGER NOT NULL,
    "fingerprint_schema_version" INTEGER,
    "fingerprint_key_version" INTEGER,
    "canonical_payload_fingerprint" TEXT,
    "tombstone_expires_at" TIMESTAMP(3),
    "deny_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_submission_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_submission_intents" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "submission_key_id" UUID NOT NULL,
    "receipt_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_submission_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_reference" VARCHAR(32) NOT NULL,
    "lifecycle" "LeadLifecycle" NOT NULL DEFAULT 'ACTIVE',
    "request_fingerprint" TEXT NOT NULL,
    "fingerprint_key_version" INTEGER NOT NULL,
    "fingerprint_schema_version" INTEGER NOT NULL,
    "lead_snapshot_schema_version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publication_id" UUID NOT NULL,
    "price_version_id" UUID NOT NULL,
    "encrypted_contact" BYTEA NOT NULL,
    "contact_key_version" INTEGER NOT NULL,
    "contact_payload_schema_version" INTEGER NOT NULL,
    "contact_nonce" BYTEA NOT NULL,
    "contact_tag" BYTEA NOT NULL,
    "policy_version_id" UUID NOT NULL,
    "policy_bundle_checksum" TEXT NOT NULL,
    "delivery_mode" "LeadPolicyDeliveryMode" NOT NULL,
    "delivery_config_version" INTEGER,
    "delivery_destination_digest" TEXT,
    "accepted_recovery_window_days" INTEGER NOT NULL,
    "consent_accepted_at" TIMESTAMP(3) NOT NULL,
    "personal_data_expires_at" TIMESTAMP(3) NOT NULL,
    "workflow_status" "LeadWorkflowStatus" NOT NULL DEFAULT 'NEW',
    "workflow_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_status_history" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lead_id" UUID NOT NULL,
    "from_status" "LeadWorkflowStatus",
    "to_status" "LeadWorkflowStatus" NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_notifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lead_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "purpose" TEXT NOT NULL DEFAULT 'lead_created',
    "delivery_mode" "LeadPolicyDeliveryMode" NOT NULL,
    "delivery_config_version" INTEGER,
    "delivery_destination_digest" TEXT,
    "status" "LeadNotificationStatus" NOT NULL,
    "manual_resend_authorized" BOOLEAN NOT NULL DEFAULT false,
    "resend_block_reason" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "dispatch_started_at" TIMESTAMP(3),
    "provider_response_id" TEXT,
    "last_error_code" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_erasure_receipts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "request_digest" TEXT NOT NULL,
    "digest_key_version" INTEGER NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_erasure_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_erasure_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lead_id" UUID NOT NULL,
    "kind" "LeadErasureKind" NOT NULL,
    "operation_digest" TEXT NOT NULL,
    "digest_key_version" INTEGER NOT NULL,
    "ledger_key_version" INTEGER NOT NULL,
    "phase" "LeadErasurePhase" NOT NULL DEFAULT 'PREPARED',
    "notification_quiescence_at" TIMESTAMP(3),
    "marker_timestamp" TIMESTAMP(3),
    "marker_payload_checksum" TEXT,
    "coverage_sequence" BIGINT,
    "coverage_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_erasure_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_erasure_marker_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "request_id" UUID,
    "reservation_id" BIGINT NOT NULL,
    "normalized_capacity_transition" JSONB NOT NULL,
    "operation_digest" TEXT NOT NULL,
    "digest_key_version" INTEGER NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "object_locator" TEXT NOT NULL,
    "marker_schema_version" INTEGER NOT NULL,
    "marker_key_version" INTEGER NOT NULL,
    "plaintext_checksum" TEXT NOT NULL,
    "ciphertext_checksum" TEXT NOT NULL,
    "ciphertext_size" BIGINT NOT NULL,
    "state" "LeadErasureMarkerState" NOT NULL DEFAULT 'PREPARED',
    "object_version" TEXT,
    "object_etag" TEXT,
    "coverage_sequence" BIGINT,
    "coverage_hash" TEXT,
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_erasure_marker_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_key_abandonment_batches" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "operation_id" UUID NOT NULL,
    "operation_digest" TEXT NOT NULL,
    "digest_key_version" INTEGER NOT NULL,
    "ordered_membership_checksum" TEXT NOT NULL,
    "cleanup_obligation_id" UUID NOT NULL,
    "marker_locator" TEXT,
    "marker_object_version" TEXT,
    "marker_checksum" TEXT,
    "marker_size" BIGINT,
    "coverage_sequence" BIGINT,
    "coverage_hash" TEXT,
    "checkpoint_sequence" BIGINT,
    "state" "SubmissionKeyAbandonmentBatchState" NOT NULL DEFAULT 'PREPARED',
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_key_abandonment_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_key_abandonment_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "submission_key_id" UUID,
    "reservation_id" BIGINT NOT NULL,
    "normalized_before_state" JSONB NOT NULL,
    "normalized_after_state" JSONB NOT NULL,
    "operation_id" UUID NOT NULL,
    "operation_digest" TEXT NOT NULL,
    "digest_key_version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "deny_until" TIMESTAMP(3) NOT NULL,
    "batch_id" UUID,
    "state" "SubmissionKeyAbandonmentState" NOT NULL DEFAULT 'PREPARED',
    "reconciliation_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_key_abandonment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_versions_version_key" ON "lead_policy_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_versions_policy_bundle_checksum_key" ON "lead_policy_versions"("policy_bundle_checksum");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_candidate_withdrawals_policy_version_id_key" ON "lead_policy_candidate_withdrawals"("policy_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_candidate_withdrawals_operation_id_key" ON "lead_policy_candidate_withdrawals"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_state_singleton_key_key" ON "lead_policy_state"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_state_active_policy_version_id_key" ON "lead_policy_state"("active_policy_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_transition_state_singleton_key_key" ON "lead_policy_transition_state"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_transition_state_current_operation_id_key" ON "lead_policy_transition_state"("current_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_transition_state_terminal_command_id_key" ON "lead_policy_transition_state"("terminal_command_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_transition_operations_operation_id_key" ON "lead_policy_transition_operations"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_transition_commands_command_operation_id_key" ON "lead_policy_transition_commands"("command_operation_id");

-- CreateIndex
CREATE INDEX "lead_policy_transition_commands_transition_operation_id_idx" ON "lead_policy_transition_commands"("transition_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "backup_snapshot_generations_exported_snapshot_id_key" ON "backup_snapshot_generations"("exported_snapshot_id");

-- CreateIndex
CREATE INDEX "backup_artifacts_state_idx" ON "backup_artifacts"("state");

-- CreateIndex
CREATE UNIQUE INDEX "backup_artifacts_snapshot_generation_id_scope_key" ON "backup_artifacts"("snapshot_generation_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "lead_protection_state_singleton_key_key" ON "lead_protection_state"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "lead_policy_protection_attestations_policy_version_id_prote_key" ON "lead_policy_protection_attestations"("policy_version_id", "protection_revision");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_control_chain_state_chain_key" ON "recovery_control_chain_state"("chain");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_high_water_checkpoint_state_singleton_key_key" ON "recovery_high_water_checkpoint_state"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_version_state_domain_version_key" ON "crypto_version_state"("domain", "version");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_provider_operation_fences_operation_id_key" ON "recovery_provider_operation_fences"("operation_id");

-- CreateIndex
CREATE INDEX "recovery_provider_operation_fences_source_host_epoch_lifecy_idx" ON "recovery_provider_operation_fences"("source_host_epoch", "lifecycle");

-- CreateIndex
CREATE UNIQUE INDEX "lead_recovery_provider_operation_fences_operation_id_key" ON "lead_recovery_provider_operation_fences"("operation_id");

-- CreateIndex
CREATE INDEX "lead_recovery_provider_operation_fences_source_host_epoch_l_idx" ON "lead_recovery_provider_operation_fences"("source_host_epoch", "lifecycle");

-- CreateIndex
CREATE UNIQUE INDEX "active_host_epoch_transitions_singleton_key_key" ON "active_host_epoch_transitions"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "active_host_epoch_transitions_operation_id_key" ON "active_host_epoch_transitions"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "active_host_epoch_transitions_host_record_fence_id_key" ON "active_host_epoch_transitions"("host_record_fence_id");

-- CreateIndex
CREATE UNIQUE INDEX "active_host_epoch_transitions_checkpoint_record_fence_id_key" ON "active_host_epoch_transitions"("checkpoint_record_fence_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_admission_budget_state_singleton_key_key" ON "lead_admission_budget_state"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "lead_admission_reservations_submission_key_id_key" ON "lead_admission_reservations"("submission_key_id");

-- CreateIndex
CREATE INDEX "lead_admission_reservations_lifecycle_idx" ON "lead_admission_reservations"("lifecycle");

-- CreateIndex
CREATE UNIQUE INDEX "lead_submission_keys_reservation_id_key" ON "lead_submission_keys"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_submission_keys_lead_id_key" ON "lead_submission_keys"("lead_id");

-- CreateIndex
CREATE INDEX "lead_submission_keys_state_open_expires_at_idx" ON "lead_submission_keys"("state", "open_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_submission_keys_idempotency_key_version_idempotency_di_key" ON "lead_submission_keys"("idempotency_key_version", "idempotency_digest");

-- CreateIndex
CREATE UNIQUE INDEX "lead_submission_keys_recovery_key_version_recovery_capabili_key" ON "lead_submission_keys"("recovery_key_version", "recovery_capability_digest");

-- CreateIndex
CREATE UNIQUE INDEX "lead_submission_intents_submission_key_id_key" ON "lead_submission_intents"("submission_key_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_public_reference_key" ON "leads"("public_reference");

-- CreateIndex
CREATE INDEX "leads_workflow_status_created_at_idx" ON "leads"("workflow_status", "created_at");

-- CreateIndex
CREATE INDEX "leads_personal_data_expires_at_idx" ON "leads"("personal_data_expires_at");

-- CreateIndex
CREATE INDEX "lead_status_history_lead_id_created_at_idx" ON "lead_status_history"("lead_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_notifications_lead_id_key" ON "lead_notifications"("lead_id");

-- CreateIndex
CREATE INDEX "lead_notifications_status_next_attempt_at_idx" ON "lead_notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_notifications_lead_id_channel_purpose_key" ON "lead_notifications"("lead_id", "channel", "purpose");

-- CreateIndex
CREATE INDEX "lead_erasure_receipts_expires_at_idx" ON "lead_erasure_receipts"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_erasure_receipts_digest_key_version_request_digest_key" ON "lead_erasure_receipts"("digest_key_version", "request_digest");

-- CreateIndex
CREATE UNIQUE INDEX "lead_erasure_requests_lead_id_key" ON "lead_erasure_requests"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_erasure_requests_digest_key_version_operation_digest_key" ON "lead_erasure_requests"("digest_key_version", "operation_digest");

-- CreateIndex
CREATE UNIQUE INDEX "lead_erasure_marker_attempts_object_locator_key" ON "lead_erasure_marker_attempts"("object_locator");

-- CreateIndex
CREATE INDEX "lead_erasure_marker_attempts_state_idx" ON "lead_erasure_marker_attempts"("state");

-- CreateIndex
CREATE UNIQUE INDEX "lead_erasure_marker_attempts_digest_key_version_operation_d_key" ON "lead_erasure_marker_attempts"("digest_key_version", "operation_digest", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "submission_key_abandonment_batches_operation_id_key" ON "submission_key_abandonment_batches"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_key_abandonment_batches_cleanup_obligation_id_key" ON "submission_key_abandonment_batches"("cleanup_obligation_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_key_abandonment_batches_marker_locator_key" ON "submission_key_abandonment_batches"("marker_locator");

-- CreateIndex
CREATE UNIQUE INDEX "submission_key_abandonment_batches_digest_key_version_opera_key" ON "submission_key_abandonment_batches"("digest_key_version", "operation_digest");

-- CreateIndex
CREATE UNIQUE INDEX "submission_key_abandonment_attempts_operation_id_key" ON "submission_key_abandonment_attempts"("operation_id");

-- CreateIndex
CREATE INDEX "submission_key_abandonment_attempts_state_deny_until_idx" ON "submission_key_abandonment_attempts"("state", "deny_until");

-- CreateIndex
CREATE UNIQUE INDEX "submission_key_abandonment_attempts_digest_key_version_oper_key" ON "submission_key_abandonment_attempts"("digest_key_version", "operation_digest");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_recovery_smoke_operation_id_key" ON "auth_sessions"("recovery_smoke_operation_id");

-- AddForeignKey
ALTER TABLE "lead_policy_candidate_withdrawals" ADD CONSTRAINT "lead_policy_candidate_withdrawals_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "lead_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_policy_candidate_withdrawals" ADD CONSTRAINT "lead_policy_candidate_withdrawals_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_policy_state" ADD CONSTRAINT "lead_policy_state_active_policy_version_id_fkey" FOREIGN KEY ("active_policy_version_id") REFERENCES "lead_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_policy_transition_state" ADD CONSTRAINT "lead_policy_transition_state_current_operation_id_fkey" FOREIGN KEY ("current_operation_id") REFERENCES "lead_policy_transition_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_policy_transition_state" ADD CONSTRAINT "lead_policy_transition_state_terminal_command_id_fkey" FOREIGN KEY ("terminal_command_id") REFERENCES "lead_policy_transition_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_policy_transition_operations" ADD CONSTRAINT "lead_policy_transition_operations_candidate_policy_version_fkey" FOREIGN KEY ("candidate_policy_version_id") REFERENCES "lead_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_policy_transition_commands" ADD CONSTRAINT "lead_policy_transition_commands_transition_operation_id_fkey" FOREIGN KEY ("transition_operation_id") REFERENCES "lead_policy_transition_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_artifacts" ADD CONSTRAINT "backup_artifacts_snapshot_generation_id_fkey" FOREIGN KEY ("snapshot_generation_id") REFERENCES "backup_snapshot_generations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_artifacts" ADD CONSTRAINT "backup_artifacts_required_core_artifact_id_fkey" FOREIGN KEY ("required_core_artifact_id") REFERENCES "backup_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_protection_state" ADD CONSTRAINT "lead_protection_state_current_lead_artifact_id_fkey" FOREIGN KEY ("current_lead_artifact_id") REFERENCES "backup_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_protection_state" ADD CONSTRAINT "lead_protection_state_compatible_core_artifact_id_fkey" FOREIGN KEY ("compatible_core_artifact_id") REFERENCES "backup_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_policy_protection_attestations" ADD CONSTRAINT "lead_policy_protection_attestations_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "lead_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_policy_protection_attestations" ADD CONSTRAINT "lead_policy_protection_attestations_protection_state_id_fkey" FOREIGN KEY ("protection_state_id") REFERENCES "lead_protection_state"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_host_epoch_transitions" ADD CONSTRAINT "active_host_epoch_transitions_host_record_fence_id_fkey" FOREIGN KEY ("host_record_fence_id") REFERENCES "recovery_provider_operation_fences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_host_epoch_transitions" ADD CONSTRAINT "active_host_epoch_transitions_checkpoint_record_fence_id_fkey" FOREIGN KEY ("checkpoint_record_fence_id") REFERENCES "recovery_provider_operation_fences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_admission_reservations" ADD CONSTRAINT "lead_admission_reservations_submission_key_id_fkey" FOREIGN KEY ("submission_key_id") REFERENCES "lead_submission_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_submission_keys" ADD CONSTRAINT "lead_submission_keys_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "lead_admission_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_submission_keys" ADD CONSTRAINT "lead_submission_keys_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_submission_intents" ADD CONSTRAINT "lead_submission_intents_submission_key_id_fkey" FOREIGN KEY ("submission_key_id") REFERENCES "lead_submission_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "catalog_publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_price_version_id_fkey" FOREIGN KEY ("price_version_id") REFERENCES "price_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "lead_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notifications" ADD CONSTRAINT "lead_notifications_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_erasure_requests" ADD CONSTRAINT "lead_erasure_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_erasure_marker_attempts" ADD CONSTRAINT "lead_erasure_marker_attempts_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "lead_erasure_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_erasure_marker_attempts" ADD CONSTRAINT "lead_erasure_marker_attempts_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "lead_admission_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_key_abandonment_attempts" ADD CONSTRAINT "submission_key_abandonment_attempts_submission_key_id_fkey" FOREIGN KEY ("submission_key_id") REFERENCES "lead_submission_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_key_abandonment_attempts" ADD CONSTRAINT "submission_key_abandonment_attempts_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "lead_admission_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_key_abandonment_attempts" ADD CONSTRAINT "submission_key_abandonment_attempts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "submission_key_abandonment_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
