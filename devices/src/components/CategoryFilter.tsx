interface CategoryFilterProps {
  categories: string[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

export default function CategoryFilter({ categories, selected, onChange }: CategoryFilterProps) {
  const toggle = (label: string) => {
    const next = new Set(selected);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    onChange(next);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange(new Set())}
        className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
          selected.size === 0
            ? "bg-slate-900 text-white"
            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        }`}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => toggle(cat)}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
            selected.has(cat)
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
