#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/52df04b636afb8f268f5da8cea604fc67d4be509ccb429d2913e18ff6174ebcc/contract';
import endContract from '../../snapshots/52df04b636afb8f268f5da8cea604fc67d4be509ccb429d2913e18ff6174ebcc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/771428b323a4abfc7b091f7fea5490a2f32c119cec9bfe5f5eb53f63b4227be1/contract';
import startContract from '../../snapshots/771428b323a4abfc7b091f7fea5490a2f32c119cec9bfe5f5eb53f63b4227be1/contract.json' with { type: 'json' };
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
        table: 'forumCategory',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('position', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('slug', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'forumPost',
        columns: [
          col('authorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('content', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('deletedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('editedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('position', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'forumReaction',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', {
            notNull: true,
            default: lit('LIKE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('postId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'forumThread',
        columns: [
          col('authorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('categoryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastPostAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('newsId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('pinned', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('replyCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('serverId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', {
            notNull: true,
            default: lit('OPEN'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('views', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'forumThread_state_check_1a00d080',
            "\"state\" IN ('OPEN', 'LOCKED', 'ARCHIVED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'notification',
        columns: [
          col('body', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('entityId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('entityType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('readAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('recipientId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'notification_type_check_7029523f',
            "\"type\" IN ('SERVER_NEWS', 'SERVER_UPDATE', 'FORUM_REPLY', 'REVIEW_EVENT', 'MODERATION')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'report',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reporterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resolution', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resolvedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('resolvedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('OPEN'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('targetId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'report_status_check_ece5aa04',
            "\"status\" IN ('OPEN', 'RESOLVED', 'DISMISSED')",
          ),
          checkExpression(
            'report_targetType_check_64e7cffc',
            "\"targetType\" IN ('THREAD', 'POST', 'REVIEW', 'NEWS', 'SERVER', 'PROFILE')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'server',
        columns: [
          col('accentColor', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('bannerUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('discordUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('host', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('integrationTokenHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('integrationTokenIssuedAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('lastSeenAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('lifecycle', 'text', {
            notNull: true,
            default: lit('CREATED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('logoUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('maxPlayers', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('monitoring', 'text', {
            notNull: true,
            default: lit('UNKNOWN'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ownerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('playerCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('port', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('region', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('showCommunity', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('showResources', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('showStaff', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('showStats', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('showTechStack', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('slug', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('verification', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('verificationNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('verifiedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('websiteUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'server_lifecycle_check_d7929fea',
            "\"lifecycle\" IN ('CREATED', 'PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')",
          ),
          checkExpression(
            'server_monitoring_check_779c9a01',
            "\"monitoring\" IN ('ONLINE', 'OFFLINE', 'UNKNOWN')",
          ),
          checkExpression(
            'server_verification_check_73517118',
            "\"verification\" IN ('PENDING', 'VERIFIED', 'FAILED', 'EXPIRED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'serverFollow',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('serverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'serverMember',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', {
            notNull: true,
            default: lit('OWNER'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('serverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'serverMember_role_check_20e0d2d5',
            "\"role\" IN ('OWNER', 'ADMIN', 'MODERATOR')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'serverNews',
        columns: [
          col('authorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('content', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('coverUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('publishedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('serverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
            'serverNews_status_check_1b4a7b6b',
            "\"status\" IN ('DRAFT', 'PUBLISHED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'serverResource',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resourceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('serverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'serverReview',
        columns: [
          col('comment', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rating', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('serverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('VISIBLE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('verifiedInteraction', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'serverReview_status_check_14193da0',
            "\"status\" IN ('VISIBLE', 'HIDDEN')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'serverReviewEligibility',
        columns: [
          col('grantedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('serverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tokenId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'serverReviewToken',
        columns: [
          col('consumedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('consumedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('expiresAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('issuedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('serverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('ACTIVE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tokenHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'serverReviewToken_status_check_59dd4716',
            "\"status\" IN ('ACTIVE', 'CONSUMED', 'EXPIRED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'serverStatusSample',
        columns: [
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('maxPlayers', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('players', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sampledAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('serverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'serverStatusSample_state_check_95c7fe90',
            "\"state\" IN ('ONLINE', 'OFFLINE', 'UNKNOWN')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'serverUpdate',
        columns: [
          col('authorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('changelog', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('publishedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('serverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('version', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'forumCategory',
        constraint: 'forumCategory_slug_key',
        columns: ['slug'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'forumReaction',
        constraint: 'forumReaction_postId_userId_kind_key',
        columns: ['postId', 'userId', 'kind'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'forumThread',
        constraint: 'forumThread_newsId_key',
        columns: ['newsId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'server',
        constraint: 'server_slug_key',
        columns: ['slug'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'serverFollow',
        constraint: 'serverFollow_serverId_userId_key',
        columns: ['serverId', 'userId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'serverMember',
        constraint: 'serverMember_serverId_userId_key',
        columns: ['serverId', 'userId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'serverReview',
        constraint: 'serverReview_serverId_userId_key',
        columns: ['serverId', 'userId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'serverReviewEligibility',
        constraint: 'serverReviewEligibility_serverId_userId_key',
        columns: ['serverId', 'userId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'serverReviewToken',
        constraint: 'serverReviewToken_tokenHash_key',
        columns: ['tokenHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumCategory',
        index: 'forumCategory_position_idx_82a01784',
        columns: ['position'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumPost',
        index: 'forumPost_authorId_idx_e47547ed',
        columns: ['authorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumPost',
        index: 'forumPost_threadId_idx_6deac339',
        columns: ['threadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumPost',
        index: 'forumPost_threadId_position_idx_4b61d407',
        columns: ['threadId', 'position'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumReaction',
        index: 'forumReaction_postId_idx_a7a72715',
        columns: ['postId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumReaction',
        index: 'forumReaction_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumThread',
        index: 'forumThread_authorId_idx_e47547ed',
        columns: ['authorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumThread',
        index: 'forumThread_categoryId_idx_15c304f2',
        columns: ['categoryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumThread',
        index: 'forumThread_categoryId_lastPostAt_idx_e90d04e0',
        columns: ['categoryId', 'lastPostAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumThread',
        index: 'forumThread_newsId_idx_3dc4650f',
        columns: ['newsId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumThread',
        index: 'forumThread_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification',
        index: 'notification_recipientId_createdAt_idx_4cb575bd',
        columns: ['recipientId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification',
        index: 'notification_recipientId_idx_c9527cf8',
        columns: ['recipientId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification',
        index: 'notification_recipientId_readAt_idx_51a86344',
        columns: ['recipientId', 'readAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'report',
        index: 'report_reporterId_idx_aa245831',
        columns: ['reporterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'report',
        index: 'report_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'report',
        index: 'report_targetType_targetId_idx_7a5ee9cb',
        columns: ['targetType', 'targetId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'server',
        index: 'server_lifecycle_idx_f5fdd5af',
        columns: ['lifecycle'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'server',
        index: 'server_monitoring_idx_92350f0d',
        columns: ['monitoring'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'server',
        index: 'server_ownerId_idx_e2d0c1ef',
        columns: ['ownerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverFollow',
        index: 'serverFollow_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverFollow',
        index: 'serverFollow_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverMember',
        index: 'serverMember_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverMember',
        index: 'serverMember_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverNews',
        index: 'serverNews_authorId_idx_e47547ed',
        columns: ['authorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverNews',
        index: 'serverNews_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverNews',
        index: 'serverNews_serverId_status_publishedAt_idx_8b30b479',
        columns: ['serverId', 'status', 'publishedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverResource',
        index: 'serverResource_resourceId_idx_72964925',
        columns: ['resourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverResource',
        index: 'serverResource_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverReview',
        index: 'serverReview_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverReview',
        index: 'serverReview_serverId_status_idx_3409d8a7',
        columns: ['serverId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverReview',
        index: 'serverReview_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverReviewEligibility',
        index: 'serverReviewEligibility_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverReviewEligibility',
        index: 'serverReviewEligibility_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverReviewToken',
        index: 'serverReviewToken_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverReviewToken',
        index: 'serverReviewToken_serverId_status_idx_3409d8a7',
        columns: ['serverId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverStatusSample',
        index: 'serverStatusSample_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverStatusSample',
        index: 'serverStatusSample_serverId_sampledAt_idx_837f2cb3',
        columns: ['serverId', 'sampledAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverUpdate',
        index: 'serverUpdate_authorId_idx_e47547ed',
        columns: ['authorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverUpdate',
        index: 'serverUpdate_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverUpdate',
        index: 'serverUpdate_serverId_publishedAt_idx_f3170a43',
        columns: ['serverId', 'publishedAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumPost',
        foreignKey: {
          name: 'forumPost_threadId_fkey',
          columns: ['threadId'],
          references: { schema: 'public', table: 'forumThread', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumPost',
        foreignKey: {
          name: 'forumPost_authorId_fkey',
          columns: ['authorId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumReaction',
        foreignKey: {
          name: 'forumReaction_postId_fkey',
          columns: ['postId'],
          references: { schema: 'public', table: 'forumPost', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumReaction',
        foreignKey: {
          name: 'forumReaction_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumThread',
        foreignKey: {
          name: 'forumThread_categoryId_fkey',
          columns: ['categoryId'],
          references: { schema: 'public', table: 'forumCategory', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumThread',
        foreignKey: {
          name: 'forumThread_authorId_fkey',
          columns: ['authorId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumThread',
        foreignKey: {
          name: 'forumThread_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumThread',
        foreignKey: {
          name: 'forumThread_newsId_fkey',
          columns: ['newsId'],
          references: { schema: 'public', table: 'serverNews', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'notification',
        foreignKey: {
          name: 'notification_recipientId_fkey',
          columns: ['recipientId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'report',
        foreignKey: {
          name: 'report_reporterId_fkey',
          columns: ['reporterId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'server',
        foreignKey: {
          name: 'server_ownerId_fkey',
          columns: ['ownerId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverFollow',
        foreignKey: {
          name: 'serverFollow_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverFollow',
        foreignKey: {
          name: 'serverFollow_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverMember',
        foreignKey: {
          name: 'serverMember_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverMember',
        foreignKey: {
          name: 'serverMember_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverNews',
        foreignKey: {
          name: 'serverNews_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverNews',
        foreignKey: {
          name: 'serverNews_authorId_fkey',
          columns: ['authorId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverResource',
        foreignKey: {
          name: 'serverResource_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverResource',
        foreignKey: {
          name: 'serverResource_resourceId_fkey',
          columns: ['resourceId'],
          references: { schema: 'public', table: 'resource', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverReview',
        foreignKey: {
          name: 'serverReview_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverReview',
        foreignKey: {
          name: 'serverReview_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverReviewEligibility',
        foreignKey: {
          name: 'serverReviewEligibility_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverReviewEligibility',
        foreignKey: {
          name: 'serverReviewEligibility_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverReviewToken',
        foreignKey: {
          name: 'serverReviewToken_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverStatusSample',
        foreignKey: {
          name: 'serverStatusSample_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverUpdate',
        foreignKey: {
          name: 'serverUpdate_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'serverUpdate',
        foreignKey: {
          name: 'serverUpdate_authorId_fkey',
          columns: ['authorId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
