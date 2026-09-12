#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/42a3b975b83498e6c4bde9808369db56054824f863be0c4aefce6706806dac09/contract';
import endContract from '../../snapshots/42a3b975b83498e6c4bde9808369db56054824f863be0c4aefce6706806dac09/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/67949e74f189c62a46b39b2c8747ce26f14b41ad8ee2b923d2622758b7bf6858/contract';
import startContract from '../../snapshots/67949e74f189c62a46b39b2c8747ce26f14b41ad8ee2b923d2622758b7bf6858/contract.json' with { type: 'json' };
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
      this.dropCheckConstraint({
        schema: 'public',
        table: 'user',
        constraint: 'user_role_check_e7d7eb9e',
      }),
      this.createTable({
        schema: 'public',
        table: 'adCampaign',
        columns: [
          col('advertiserId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('ctaLabel', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('ctaUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('endsAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('imageUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('placement', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('priority', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('reviewNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reviewStatus', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('startsAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'adCampaign_placement_check_dadad663',
            "\"placement\" IN ('HOME_HERO', 'HOME_RAIL_SECONDARY', 'MARKET_FEATURED', 'SERVER_FEATURED', 'COMMUNITY_FEATURED')",
          ),
          checkExpression(
            'adCampaign_reviewStatus_check_e84a3cf1',
            "\"reviewStatus\" IN ('PENDING', 'APPROVED', 'REJECTED')",
          ),
          checkExpression(
            'adCampaign_status_check_68bbbf22',
            "\"status\" IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'adMetric',
        columns: [
          col('campaignId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('clicks', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('date', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('impressions', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'entitlement',
        columns: [
          col('expiresAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('grantedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('grantedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('revokedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('revokedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'entitlement_kind_check_a21a9162',
            "\"kind\" IN ('CREATOR_PREMIUM', 'SERVER_PREMIUM', 'MARKETPLACE_PREMIUM', 'ADVERTISING_PREMIUM', 'ANALYTICS_PREMIUM')",
          ),
          checkExpression(
            'entitlement_subjectType_check_a2adb08e',
            "\"subjectType\" IN ('USER', 'RESOURCE', 'SERVER')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'systemLog',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('level', 'text', {
            notNull: true,
            default: lit('INFO'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('message', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('meta', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('requestId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('route', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('service', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'systemLog_level_check_267a3d9e',
            "\"level\" IN ('DEBUG', 'INFO', 'WARN', 'ERROR')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'adMetric',
        constraint: 'adMetric_campaignId_date_key',
        columns: ['campaignId', 'date'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'user',
        constraint: 'user_role_check_028dd02e',
        expression:
          "\"role\" IN ('USER', 'SELLER', 'MODERATOR', 'SUPPORT', 'FINANCE', 'ADMIN', 'SUPERADMIN')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'adCampaign',
        index: 'adCampaign_advertiserId_idx_d211eb82',
        columns: ['advertiserId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adCampaign',
        index: 'adCampaign_placement_status_idx_ea901936',
        columns: ['placement', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adCampaign',
        index: 'adCampaign_status_reviewStatus_idx_67c9a02a',
        columns: ['status', 'reviewStatus'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adMetric',
        index: 'adMetric_campaignId_idx_3aacd648',
        columns: ['campaignId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'entitlement',
        index: 'entitlement_kind_revokedAt_idx_fd297431',
        columns: ['kind', 'revokedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'entitlement',
        index: 'entitlement_subjectType_subjectId_kind_idx_de22942b',
        columns: ['subjectType', 'subjectId', 'kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'systemLog',
        index: 'systemLog_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'systemLog',
        index: 'systemLog_level_createdAt_idx_85b9ef83',
        columns: ['level', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'systemLog',
        index: 'systemLog_service_createdAt_idx_b0dbdc8e',
        columns: ['service', 'createdAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'adCampaign',
        foreignKey: {
          name: 'adCampaign_advertiserId_fkey',
          columns: ['advertiserId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'adMetric',
        foreignKey: {
          name: 'adMetric_campaignId_fkey',
          columns: ['campaignId'],
          references: { schema: 'public', table: 'adCampaign', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
