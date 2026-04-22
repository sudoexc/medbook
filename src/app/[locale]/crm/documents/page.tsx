import { DocumentsPageClient } from "./_components/documents-page-client";

/**
 * /crm/documents — cross-patient document library.
 *
 * Searchable/filterable by type, patient, doctor, date range. Upload dialog
 * stores metadata only (Phase 6 → real MinIO backing storage).
 */
export default function DocumentsPage() {
  return <DocumentsPageClient />;
}
