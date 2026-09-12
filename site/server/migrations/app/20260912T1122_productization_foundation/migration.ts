#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/42a3b975b83498e6c4bde9808369db56054824f863be0c4aefce6706806dac09/contract';
import startContract from '../../snapshots/42a3b975b83498e6c4bde9808369db56054824f863be0c4aefce6706806dac09/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/bfa9bb326915b6c5a42c3dc2dc982336146c700727f058ac727e26ca09059d98/contract';
import endContract from '../../snapshots/bfa9bb326915b6c5a42c3dc2dc982336146c700727f058ac727e26ca09059d98/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'artifactFingerprint',
        columns: [
          col('artifactHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('entryNames', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('family', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fromVersionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sizeBytes', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'dealEvidence',
        columns: [
          col('body', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('roomId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'dealEvidence_kind_check_8bbb8259',
            "\"kind\" IN ('MESSAGE', 'FILE', 'DELIVERY', 'DISPUTE_EVENT')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'dealMessage',
        columns: [
          col('authorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('roomId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'dealRoom',
        columns: [
          col('amountMinor', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('buyerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', 'text', {
            notNull: true,
            default: lit('RUB'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('orderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sellerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('CREATED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('subjectId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('subjectType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'dealRoom_status_check_693d2a50',
            "\"status\" IN ('CREATED', 'FUNDED', 'DELIVERING', 'DELIVERED', 'ACCEPTED', 'DISPUTED', 'RESOLVED', 'CLOSED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'demoSession',
        columns: [
          col('connectionInfo', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('destroyedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('expiresAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('failureReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requestedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sandboxRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('STARTING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('ttlSeconds', 'int4', {
            notNull: true,
            default: lit(1800),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('versionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'demoSession_status_check_92305108',
            "\"status\" IN ('STARTING', 'RUNNING', 'EXPIRING', 'DESTROYED', 'FAILED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'favorite',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'favorite_targetType_check_67e7260e',
            "\"targetType\" IN ('RESOURCE', 'SERVER', 'CREATOR', 'DISCUSSION')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'feedbackReport',
        columns: [
          col('category', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('handledById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resolutionNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('route', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('screenshotUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('severity', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('NEW'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'feedbackReport_category_check_27522049',
            "\"category\" IN ('BUG', 'UX', 'BILLING', 'CONTENT', 'OTHER')",
          ),
          checkExpression(
            'feedbackReport_severity_check_5e5a5e80',
            "\"severity\" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')",
          ),
          checkExpression(
            'feedbackReport_status_check_62cac4db',
            "\"status\" IN ('NEW', 'TRIAGED', 'RESOLVED', 'DISMISSED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'leakCase',
        columns: [
          col('confidence', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('evidence', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('evidenceCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('fingerprintId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('openedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resolutionNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resolvedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('OPEN'),
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'leakCase_status_check_3fd459f7',
            "\"status\" IN ('OPEN', 'CONFIRMED', 'DISMISSED', 'FALSE_POSITIVE', 'RESOLVED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'outboxEvent',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('availableAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('eventType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('processedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'outboxEvent_status_check_8a5bce80',
            "\"status\" IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'payoutRequest',
        columns: [
          col('amountMinor', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('currency', 'text', {
            notNull: true,
            default: lit('RUB'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('decidedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ledgerTxnId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payoutRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('requestedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('reviewedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sellerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'payoutRequest_status_check_c85a3565',
            "\"status\" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'priceAlert',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('events', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetPriceMinor', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'subscription',
        columns: [
          col('autoRenew', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('cancelledAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('expiresAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('graceUntil', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastPaymentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('plan', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('ACTIVE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'subscription_plan_check_51533829',
            "\"plan\" IN ('CREATOR_PREMIUM', 'SERVER_PREMIUM', 'MARKETPLACE_PREMIUM', 'ADVERTISING_PREMIUM', 'ANALYTICS_PREMIUM')",
          ),
          checkExpression(
            'subscription_status_check_5106abed',
            "\"status\" IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLED', 'EXPIRED')",
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'adCampaign',
        column: col('orderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'resourceVersion',
        column: col('channel', 'text', {
          notNull: true,
          default: lit('STABLE'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'artifactFingerprint',
        constraint: 'artifactFingerprint_artifactHash_key',
        columns: ['artifactHash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'favorite',
        constraint: 'favorite_userId_targetType_targetId_key',
        columns: ['userId', 'targetType', 'targetId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'priceAlert',
        constraint: 'priceAlert_userId_resourceId_key',
        columns: ['userId', 'resourceId'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'resourceVersion',
        constraint: 'resourceVersion_channel_check_006e1223',
        expression: "\"channel\" IN ('STABLE', 'BETA', 'LEGACY')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'adCampaign',
        index: 'adCampaign_orderId_idx_d284871b',
        columns: ['orderId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'artifactFingerprint',
        index: 'artifactFingerprint_family_idx_5d0f3de6',
        columns: ['family'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dealEvidence',
        index: 'dealEvidence_createdBy_idx_ba0f792f',
        columns: ['createdBy'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dealEvidence',
        index: 'dealEvidence_roomId_createdAt_idx_71ac5cd0',
        columns: ['roomId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dealMessage',
        index: 'dealMessage_authorId_idx_e47547ed',
        columns: ['authorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dealMessage',
        index: 'dealMessage_roomId_createdAt_idx_71ac5cd0',
        columns: ['roomId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dealRoom',
        index: 'dealRoom_buyerId_idx_80be0de9',
        columns: ['buyerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dealRoom',
        index: 'dealRoom_buyerId_status_idx_ce94417b',
        columns: ['buyerId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dealRoom',
        index: 'dealRoom_sellerId_idx_d71255f2',
        columns: ['sellerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dealRoom',
        index: 'dealRoom_sellerId_status_idx_a31309c3',
        columns: ['sellerId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dealRoom',
        index: 'dealRoom_status_updatedAt_idx_29f913bb',
        columns: ['status', 'updatedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demoSession',
        index: 'demoSession_requestedById_idx_f9a56c66',
        columns: ['requestedById'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demoSession',
        index: 'demoSession_resourceId_idx_72964925',
        columns: ['resourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demoSession',
        index: 'demoSession_resourceId_status_idx_4475e149',
        columns: ['resourceId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demoSession',
        index: 'demoSession_status_expiresAt_idx_c206f415',
        columns: ['status', 'expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demoSession',
        index: 'demoSession_versionId_idx_ef8aa804',
        columns: ['versionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'favorite',
        index: 'favorite_targetType_targetId_idx_7a5ee9cb',
        columns: ['targetType', 'targetId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'favorite',
        index: 'favorite_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'feedbackReport',
        index: 'feedbackReport_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'feedbackReport',
        index: 'feedbackReport_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'leakCase',
        index: 'leakCase_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'outboxEvent',
        index: 'outboxEvent_eventType_createdAt_idx_e619d007',
        columns: ['eventType', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'outboxEvent',
        index: 'outboxEvent_status_availableAt_idx_98697328',
        columns: ['status', 'availableAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payoutRequest',
        index: 'payoutRequest_sellerId_idx_d71255f2',
        columns: ['sellerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payoutRequest',
        index: 'payoutRequest_sellerId_status_idx_a31309c3',
        columns: ['sellerId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payoutRequest',
        index: 'payoutRequest_status_requestedAt_idx_27ce3e29',
        columns: ['status', 'requestedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'priceAlert',
        index: 'priceAlert_resourceId_active_idx_088dc2a4',
        columns: ['resourceId', 'active'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'priceAlert',
        index: 'priceAlert_resourceId_idx_72964925',
        columns: ['resourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'priceAlert',
        index: 'priceAlert_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'subscription',
        index: 'subscription_status_expiresAt_idx_c206f415',
        columns: ['status', 'expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'subscription',
        index: 'subscription_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'subscription',
        index: 'subscription_userId_status_idx_e4a128ba',
        columns: ['userId', 'status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dealEvidence',
        foreignKey: {
          name: 'dealEvidence_createdBy_fkey',
          columns: ['createdBy'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dealMessage',
        foreignKey: {
          name: 'dealMessage_authorId_fkey',
          columns: ['authorId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dealRoom',
        foreignKey: {
          name: 'dealRoom_buyerId_fkey',
          columns: ['buyerId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dealRoom',
        foreignKey: {
          name: 'dealRoom_sellerId_fkey',
          columns: ['sellerId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'demoSession',
        foreignKey: {
          name: 'demoSession_resourceId_fkey',
          columns: ['resourceId'],
          references: { schema: 'public', table: 'resource', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'demoSession',
        foreignKey: {
          name: 'demoSession_versionId_fkey',
          columns: ['versionId'],
          references: { schema: 'public', table: 'resourceVersion', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'demoSession',
        foreignKey: {
          name: 'demoSession_requestedById_fkey',
          columns: ['requestedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'favorite',
        foreignKey: {
          name: 'favorite_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'feedbackReport',
        foreignKey: {
          name: 'feedbackReport_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'payoutRequest',
        foreignKey: {
          name: 'payoutRequest_sellerId_fkey',
          columns: ['sellerId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'priceAlert',
        foreignKey: {
          name: 'priceAlert_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'priceAlert',
        foreignKey: {
          name: 'priceAlert_resourceId_fkey',
          columns: ['resourceId'],
          references: { schema: 'public', table: 'resource', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'subscription',
        foreignKey: {
          name: 'subscription_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
