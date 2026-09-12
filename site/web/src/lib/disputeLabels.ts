// PLAN-016 D-003: единый русский словарь типов объектов спора.
// Общий модуль (не страница) — Next.js запрещает произвольные export-поля
// из page-файлов, а маппинг нужен и пользовательскому списку споров, и
// админской вкладке модерации.

export function disputeTargetLabel(targetType: string): string {
  const labels: Record<string, string> = {
    PURCHASE: "Покупка",
    SERVICE_PURCHASE: "Услуга",
  };
  return labels[targetType] ?? targetType;
}