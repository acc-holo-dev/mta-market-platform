#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/67949e74f189c62a46b39b2c8747ce26f14b41ad8ee2b923d2622758b7bf6858/contract';
import endContract from '../../snapshots/67949e74f189c62a46b39b2c8747ce26f14b41ad8ee2b923d2622758b7bf6858/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b1dbf93b4e9242d6c20697c3044b1bcff174d75274cfe580a57e91be286a8a2b/contract';
import startContract from '../../snapshots/b1dbf93b4e9242d6c20697c3044b1bcff174d75274cfe580a57e91be286a8a2b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'payment',
        constraint: 'payment_provider_check_7f539d22',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'paymentProviderEvent',
        constraint: 'paymentProviderEvent_provider_check_7f539d22',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'payment',
        constraint: 'payment_provider_check_e8ce0afb',
        expression: "\"provider\" IN ('YUKASSA', 'STRIPE', 'TEST', 'TBANK', 'CRYPTO')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'paymentProviderEvent',
        constraint: 'paymentProviderEvent_provider_check_e8ce0afb',
        expression: "\"provider\" IN ('YUKASSA', 'STRIPE', 'TEST', 'TBANK', 'CRYPTO')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
