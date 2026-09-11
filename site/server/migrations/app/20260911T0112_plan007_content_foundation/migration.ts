#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5841e59d7b47f5316b290c36866bd80d3bf727b8ec75cbfe6c1271d6175ea19a/contract';
import endContract from '../../snapshots/5841e59d7b47f5316b290c36866bd80d3bf727b8ec75cbfe6c1271d6175ea19a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6738219b4d00311c3a6c8162c2aacd2ac2ba6e59797f848e669afe4c0aa24fd1/contract';
import startContract from '../../snapshots/6738219b4d00311c3a6c8162c2aacd2ac2ba6e59797f848e669afe4c0aa24fd1/contract.json' with { type: 'json' };
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
        table: 'report',
        constraint: 'report_targetType_check_64e7cffc',
      }),
      this.createTable({
        schema: 'public',
        table: 'article',
        columns: [
          col('authorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('category', 'text', {
            notNull: true,
            default: lit('GUIDES'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('content', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('coverUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('excerpt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('publishedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('reviewNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('slug', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('DRAFT'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tags', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'article_category_check_b147cc2f',
            "\"category\" IN ('GUIDES', 'NEWS', 'REVIEWS', 'OPINION')",
          ),
          checkExpression(
            'article_status_check_b0fc567a',
            "\"status\" IN ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'articleResourceLink',
        columns: [
          col('articleId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('position', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('resourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'articleServerLink',
        columns: [
          col('articleId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('position', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('serverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'forumThread',
        column: col('articleId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'article',
        constraint: 'article_slug_key',
        columns: ['slug'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'articleResourceLink',
        constraint: 'articleResourceLink_articleId_resourceId_key',
        columns: ['articleId', 'resourceId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'articleServerLink',
        constraint: 'articleServerLink_articleId_serverId_key',
        columns: ['articleId', 'serverId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'forumThread',
        constraint: 'forumThread_articleId_key',
        columns: ['articleId'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'report',
        constraint: 'report_targetType_check_093d505b',
        expression:
          "\"targetType\" IN ('THREAD', 'POST', 'REVIEW', 'NEWS', 'SERVER', 'PROFILE', 'ARTICLE')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'article',
        index: 'article_authorId_idx_e47547ed',
        columns: ['authorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'article',
        index: 'article_status_publishedAt_idx_4d4b1960',
        columns: ['status', 'publishedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'articleResourceLink',
        index: 'articleResourceLink_articleId_idx_3dd188a0',
        columns: ['articleId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'articleResourceLink',
        index: 'articleResourceLink_resourceId_idx_72964925',
        columns: ['resourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'articleServerLink',
        index: 'articleServerLink_articleId_idx_3dd188a0',
        columns: ['articleId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'articleServerLink',
        index: 'articleServerLink_serverId_idx_cfc44675',
        columns: ['serverId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'article',
        foreignKey: {
          name: 'article_authorId_fkey',
          columns: ['authorId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'articleResourceLink',
        foreignKey: {
          name: 'articleResourceLink_articleId_fkey',
          columns: ['articleId'],
          references: { schema: 'public', table: 'article', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'articleResourceLink',
        foreignKey: {
          name: 'articleResourceLink_resourceId_fkey',
          columns: ['resourceId'],
          references: { schema: 'public', table: 'resource', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'articleServerLink',
        foreignKey: {
          name: 'articleServerLink_articleId_fkey',
          columns: ['articleId'],
          references: { schema: 'public', table: 'article', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'articleServerLink',
        foreignKey: {
          name: 'articleServerLink_serverId_fkey',
          columns: ['serverId'],
          references: { schema: 'public', table: 'server', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'forumThread',
        foreignKey: {
          name: 'forumThread_articleId_fkey',
          columns: ['articleId'],
          references: { schema: 'public', table: 'article', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
