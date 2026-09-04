export function PageHeader({
  crumb, title, description, actions,
}: {
  crumb?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      {crumb && <div className="mb-1.5 text-[11.5px] text-muted">{crumb}</div>}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">{title}</h1>
          {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
        </div>
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="px-5 py-11 text-center">
      <h4 className="text-[13.5px] font-semibold">{title}</h4>
      {hint && <p className="mb-3.5 mt-1 text-[12.5px] text-muted">{hint}</p>}
      {action}
    </div>
  );
}
