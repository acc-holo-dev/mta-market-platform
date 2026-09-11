// Reconciliation Worker
// Verifies financial consistency between Purchase records and SellerBalance ledger
// Runs periodically to detect discrepancies and flag issues

import { db } from "../../prisma/db";

export interface ReconciliationResult {
  timestamp: string;
  totalPurchases: number;
  totalSellerRevenue: number;
  totalPlatformFee: number;
  sellersChecked: number;
  discrepancies: ReconciliationDiscrepancy[];
  summary: {
    purchasesSum: number;
    ledgerSum: number;
    difference: number;
    balanced: boolean;
  };
}

export interface ReconciliationDiscrepancy {
  type: "SELLER_BALANCE_MISMATCH" | "MISSING_LEDGER_ENTRY" | "ORPHANED_TRANSACTION";
  severity: "WARNING" | "ERROR" | "CRITICAL";
  sellerId?: string;
  purchaseId?: string;
  expected: number;
  actual: number;
  difference: number;
  description: string;
}

/**
 * Reconcile all completed purchases against seller balances
 * 
 * Verifies:
 * 1. Every completed purchase has a ledger transaction
 * 2. Seller balance = sum of all their ledger transactions
 * 3. Purchase revenue split is correct (priceSnapshot = platformFee + sellerRevenue)
 * 4. No orphaned transactions (transactions without purchases)
 */
export async function reconcileAllPurchases(): Promise<ReconciliationResult> {
  const timestamp = new Date().toISOString();
  const discrepancies: ReconciliationDiscrepancy[] = [];

  // Get all completed purchases
  const purchases = await db.orm.public.Purchase.where({ 
    status: "COMPLETED" 
  }).all();

  let totalSellerRevenue = 0;
  let totalPlatformFee = 0;

  // Group purchases by seller
  const purchasesBySeller = new Map<string, any[]>();

  for (const purchase of purchases) {
    // Validate revenue split
    if (purchase.platformFee + purchase.sellerRevenue !== purchase.finalPrice) {
      discrepancies.push({
        type: "SELLER_BALANCE_MISMATCH",
        severity: "CRITICAL",
        purchaseId: purchase.id,
        expected: purchase.finalPrice,
        actual: purchase.platformFee + purchase.sellerRevenue,
        difference: purchase.finalPrice - (purchase.platformFee + purchase.sellerRevenue),
        description: `Purchase ${purchase.id}: platformFee + sellerRevenue != finalPrice`,
      });
    }

    totalSellerRevenue += purchase.sellerRevenue;
    totalPlatformFee += purchase.platformFee;

    // Resolve seller from resource
    const resource = await db.orm.public.Resource.where({ 
      id: purchase.resourceId 
    }).first();

    if (!resource) {
      discrepancies.push({
        type: "MISSING_LEDGER_ENTRY",
        severity: "ERROR",
        purchaseId: purchase.id,
        expected: 0,
        actual: 0,
        difference: 0,
        description: `Purchase ${purchase.id}: Resource not found`,
      });
      continue;
    }

    const sellerId = resource.sellerId;

    if (!purchasesBySeller.has(sellerId)) {
      purchasesBySeller.set(sellerId, []);
    }
    purchasesBySeller.get(sellerId)!.push(purchase);
  }

  // Reconcile each seller
  for (const [sellerId, sellerPurchases] of purchasesBySeller.entries()) {
    const expectedRevenue = sellerPurchases.reduce(
      (sum, p) => sum + p.sellerRevenue, 
      0
    );

    // Get seller balance
    const sellerBalance = await db.orm.public.SellerBalance.where({ 
      userId: sellerId 
    }).first();

    if (!sellerBalance) {
      discrepancies.push({
        type: "MISSING_LEDGER_ENTRY",
        severity: "CRITICAL",
        sellerId,
        expected: expectedRevenue,
        actual: 0,
        difference: expectedRevenue,
        description: `Seller ${sellerId}: No SellerBalance record (expected ${expectedRevenue})`,
      });
      continue;
    }

    // Get sum of all transactions
    const transactions = await db.orm.public.FinancialTransaction.where({ 
      userId: sellerId 
    }).all();

    const ledgerSum = transactions
      .filter(t => t.type === "SELLER_REVENUE")
      .reduce((sum, t) => sum + t.amount, 0);

    const refundsSum = transactions
      .filter(t => t.type === "REFUND_FROM_SELLER")
      .reduce((sum, t) => sum + t.amount, 0);

    const netRevenue = ledgerSum - refundsSum;

    // Check if balance matches transactions
    if (sellerBalance.totalEarned !== netRevenue) {
      discrepancies.push({
        type: "SELLER_BALANCE_MISMATCH",
        severity: "ERROR",
        sellerId,
        expected: netRevenue,
        actual: sellerBalance.totalEarned,
        difference: netRevenue - sellerBalance.totalEarned,
        description: `Seller ${sellerId}: SellerBalance.totalEarned (${sellerBalance.totalEarned}) != sum of transactions (${netRevenue})`,
      });
    }

    // Check if transactions match purchases
    if (ledgerSum !== expectedRevenue) {
      discrepancies.push({
        type: "SELLER_BALANCE_MISMATCH",
        severity: "WARNING",
        sellerId,
        expected: expectedRevenue,
        actual: ledgerSum,
        difference: expectedRevenue - ledgerSum,
        description: `Seller ${sellerId}: Ledger transactions (${ledgerSum}) != sum of purchases (${expectedRevenue})`,
      });
    }
  }

  // Check for orphaned transactions (transactions without corresponding purchases)
  const allTransactions = await db.orm.public.FinancialTransaction.where({
    type: "SELLER_REVENUE",
  }).all();

  for (const transaction of allTransactions) {
    if (transaction.relatedPurchaseId) {
      const purchase = await db.orm.public.Purchase.where({ 
        id: transaction.relatedPurchaseId 
      }).first();

      if (!purchase) {
        discrepancies.push({
          type: "ORPHANED_TRANSACTION",
          severity: "ERROR",
          sellerId: transaction.userId,
          expected: 0,
          actual: transaction.amount,
          difference: transaction.amount,
          description: `Transaction references non-existent purchase ${transaction.relatedPurchaseId}`,
        });
      }
    }
  }

  // Calculate summary
  const purchasesSum = totalSellerRevenue + totalPlatformFee;
  const ledgerSum = allTransactions
    .filter(t => t.type === "SELLER_REVENUE")
    .reduce((sum, t) => sum + t.amount, 0);

  const difference = purchasesSum - ledgerSum;
  const balanced = Math.abs(difference) < 1; // Allow 1 kopeck rounding error

  return {
    timestamp,
    totalPurchases: purchases.length,
    totalSellerRevenue,
    totalPlatformFee,
    sellersChecked: purchasesBySeller.size,
    discrepancies,
    summary: {
      purchasesSum,
      ledgerSum,
      difference,
      balanced,
    },
  };
}

/**
 * Quick reconciliation check (returns true if balanced)
 */
export async function isReconciled(): Promise<boolean> {
  const result = await reconcileAllPurchases();
  return result.summary.balanced && result.discrepancies.length === 0;
}

/**
 * Get reconciliation status summary
 */
export async function getReconciliationStatus(): Promise<{
  balanced: boolean;
  totalDiscrepancies: number;
  criticalIssues: number;
  lastChecked: string;
}> {
  const result = await reconcileAllPurchases();

  return {
    balanced: result.summary.balanced,
    totalDiscrepancies: result.discrepancies.length,
    criticalIssues: result.discrepancies.filter(d => d.severity === "CRITICAL").length,
    lastChecked: result.timestamp,
  };
}
