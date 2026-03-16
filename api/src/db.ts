/** Lightweight output type — matches DeviceTemplate from the main app */
interface TemplateOutput {
  id: string;
  version: number;
  deviceType: string;
  label: string;
  manufacturer?: string;
  modelNumber?: string;
  color?: string;
  imageUrl?: string;
  searchTerms?: string[];
  ports: unknown[];
}

interface TemplateRow {
  id: string;
  version: number;
  device_type: string;
  label: string;
  manufacturer: string | null;
  model_number: string | null;
  color: string | null;
  image_url: string | null;
  search_terms: string | null;
  ports: string;
  sort_order: number;
}

export function rowToTemplate(row: TemplateRow): TemplateOutput {
  return {
    id: row.id,
    version: row.version,
    deviceType: row.device_type,
    label: row.label,
    ...(row.manufacturer && { manufacturer: row.manufacturer }),
    ...(row.model_number && { modelNumber: row.model_number }),
    ...(row.color && { color: row.color }),
    ...(row.image_url && { imageUrl: row.image_url }),
    ...(row.search_terms && { searchTerms: JSON.parse(row.search_terms) as string[] }),
    ports: JSON.parse(row.ports) as unknown[],
  };
}
