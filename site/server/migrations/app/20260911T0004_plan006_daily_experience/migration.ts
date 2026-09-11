#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/52df04b636afb8f268f5da8cea604fc67d4be509ccb429d2913e18ff6174ebcc/contract';
import startContract from '../../snapshots/52df04b636afb8f268f5da8cea604fc67d4be509ccb429d2913e18ff6174ebcc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/6738219b4d00311c3a6c8162c2aacd2ac2ba6e59797f848e669afe4c0aa24fd1/contract';
import endContract from '../../snapshots/6738219b4d00311c3a6c8162c2aacd2ac2ba6e59797f848e669afe4c0aa24fd1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('dashboardSeenAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumPost',
        index: 'forumPost_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forumThread',
        index: 'forumThread_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'moderationEvent',
        index: 'moderationEvent_toStatus_createdAt_idx_d3c44f73',
        columns: ['toStatus', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'resourceVersion',
        index: 'resourceVersion_releaseStatus_publishedAt_idx_b6b40219',
        columns: ['releaseStatus', 'publishedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'review',
        index: 'review_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'server',
        index: 'server_lifecycle_verifiedAt_idx_da9a4538',
        columns: ['lifecycle', 'verifiedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverNews',
        index: 'serverNews_status_publishedAt_idx_4d4b1960',
        columns: ['status', 'publishedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverReview',
        index: 'serverReview_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'serverUpdate',
        index: 'serverUpdate_publishedAt_idx_36121b91',
        columns: ['publishedAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
