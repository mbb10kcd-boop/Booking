export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 md:px-8 py-5 md:py-6 border-b border-slate-200 bg-white sticky top-0 z-10">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
