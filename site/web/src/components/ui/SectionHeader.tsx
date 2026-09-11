// SectionHeader: единый заголовок секции на homepage и в других списках.
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-content-secondary">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
