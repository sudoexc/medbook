"use client";

import * as React from "react";

import { DocumentsFiltersProvider } from "../_hooks/documents-context";
import { DocumentsFilters } from "./documents-filters";
import { DocumentsHeader } from "./documents-header";
import { DocumentsTable } from "./documents-table";
import { UploadDocumentDialog } from "./upload-document-dialog";

export function DocumentsShell() {
  const [uploadOpen, setUploadOpen] = React.useState(false);

  return (
    <DocumentsFiltersProvider>
      <DocumentsHeader onOpenUpload={() => setUploadOpen(true)} />
      <DocumentsFilters />
      <DocumentsTable />
      <UploadDocumentDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
      />
    </DocumentsFiltersProvider>
  );
}
